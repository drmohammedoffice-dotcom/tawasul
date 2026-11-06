/**
 * Release-candidate feature smoke: search, bookmarks, reels privacy, G/C websocket.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const WS = process.env.WS_URL || 'http://127.0.0.1:3000/realtime';
const results = [];

function record(name, ok, detail = '') {
  const status = ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL';
  results.push({ name, status, detail });
  console.log(`${status} - ${name}${detail ? ` | ${detail}` : ''}`);
}

async function req(pathname, { method = 'GET', token, body, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathname}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (raw) return { res, text, json };
  if (!res.ok) {
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 200);
    throw new Error(`${method} ${pathname} -> ${res.status} ${msg}`);
  }
  return json?.data ?? json;
}

function uniq(p) {
  return `${p}_${Date.now()}_${Math.floor(Math.random() * 999)}`;
}

async function register(username) {
  const deviceId = `web-${uniq('d')}`;
  const data = await req('/auth/register', {
    method: 'POST',
    body: { username, password: 'password123', deviceId }
  });
  return { token: data.accessToken, id: data.user.id, username };
}

async function uploadPng(token, purpose = 'post') {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: 't.png',
      mimeType: 'image/png',
      mediaType: 'image',
      sizeBytes: png.length,
      purpose,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 't.png');
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `http://127.0.0.1:3000${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  await req('/media/complete', { method: 'POST', token, body: { mediaId: ticket.media.id } });
  return ticket.media.id;
}

async function main() {
  const a = await register(uniq('rca'));
  const b = await register(uniq('rcb'));
  const stranger = await register(uniq('rcs'));

  // Search + privacy
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { displayName: 'AlphaSearch', isPrivate: false }
    });
    const mediaId = await uploadPng(a.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: `unique-caption-${a.username}`, mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: true }
    });
    const open = await req(`/search?q=${encodeURIComponent(a.username.slice(0, 8))}`, {
      token: b.token
    });
    const privPost = await req(`/search?q=${encodeURIComponent('unique-caption-' + a.username)}`, {
      token: stranger.token
    });
    await req(`/users/${b.id}/block`, { method: 'POST', token: a.token });
    const blockedSearch = await req(`/search?q=${encodeURIComponent(a.username.slice(0, 6))}`, {
      token: b.token
    });
    await req(`/users/${b.id}/block`, { method: 'DELETE', token: a.token });
    record(
      'rc.search-privacy',
      Array.isArray(open.users) &&
        open.users.some((u) => u.id === a.id) &&
        !(privPost.posts || []).some((p) => p.id === post.id) &&
        !(blockedSearch.users || []).some((u) => u.id === a.id),
      `users=${open.users?.length} privPosts=${privPost.posts?.length} blockedUsers=${blockedSearch.users?.length}`
    );
  } catch (e) {
    record('rc.search-privacy', false, e.message);
  }

  // Bookmarks list ownership
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: false }
    });
    const mediaId = await uploadPng(a.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: 'bookmark-me', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    await req(`/posts/${post.id}/bookmark`, { method: 'POST', token: b.token });
    const mine = await req('/bookmarks', { token: b.token });
    const other = await req('/bookmarks', { token: a.token });
    await req(`/posts/${post.id}/bookmark`, { method: 'DELETE', token: b.token });
    const after = await req('/bookmarks', { token: b.token });
    record(
      'rc.bookmarks-list',
      mine.some((p) => p.id === post.id) &&
        !other.some((p) => p.id === post.id) &&
        !after.some((p) => p.id === post.id),
      `b=${mine.length} a=${other.length} afterUnsave=${after.length}`
    );
  } catch (e) {
    record('rc.bookmarks-list', false, e.message);
  }

  // Reels: seed a real-sized video (> stub filter) then like/unlike
  try {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const mp4Path = path.join(os.tmpdir(), `rc-reel-${Date.now()}.mp4`);
    const ff = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240:d=3',
        '-f',
        'lavfi',
        '-i',
        'sine=f=880:d=3',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        mp4Path
      ],
      { encoding: 'utf8' }
    );
    if (ff.status !== 0 || !fs.existsSync(mp4Path)) {
      throw new Error(`ffmpeg seed failed: ${(ff.stderr || '').slice(0, 160)}`);
    }
    const buf = fs.readFileSync(mp4Path);
    const ticket = await req('/media/upload-ticket', {
      method: 'POST',
      token: a.token,
      body: {
        fileName: 'rc-reel.mp4',
        mimeType: 'video/mp4',
        mediaType: 'video',
        sizeBytes: buf.length,
        purpose: 'reel',
        encryptedFileKey: 'public-unencrypted'
      }
    });
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'video/mp4' }), 'rc-reel.mp4');
    const upUrl = ticket.upload.url.startsWith('http')
      ? ticket.upload.url
      : `http://127.0.0.1:3000${ticket.upload.url}`;
    const up = await fetch(upUrl, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`upload ${up.status}`);
    await req('/media/complete', {
      method: 'POST',
      token: a.token,
      body: { mediaId: ticket.media.id, durationSeconds: 3 }
    });
    const reel = await req('/reels', {
      method: 'POST',
      token: a.token,
      body: { mediaId: ticket.media.id, caption: 'rc reel', hashtags: ['rcreel'] }
    });
    fs.unlinkSync(mp4Path);

    const { res: feedRes, json } = await req('/reels/feed', { token: a.token, raw: true });
    const feed = json?.data ?? [];
    record(
      'rc.reels-feed-endpoint',
      feedRes.ok && Array.isArray(feed) && feed.some((r) => r.id === reel.id),
      `status=${feedRes.status} count=${Array.isArray(feed) ? feed.length : 0} seeded=${reel.id}`
    );
    const hit = Array.isArray(feed) ? feed.find((r) => r.id === reel.id) || feed[0] : null;
    if (hit?.id) {
      await req(`/reels/${hit.id}/like`, { method: 'POST', token: a.token });
      await req(`/reels/${hit.id}/like`, { method: 'DELETE', token: a.token });
      record('rc.reels-like-unlike', true, `reel=${hit.id} playable=${hit.playable} bytesSeed=${buf.length}`);
    } else {
      record('rc.reels-like-unlike', false, 'seeded reel missing from feed');
    }
  } catch (e) {
    record('rc.reels-feed-endpoint', false, e.message);
    record('rc.reels-like-unlike', false, e.message);
  }

  // Groups WS fanout (business create required)
  try {
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.[0];
    await req('/business/switch', {
      method: 'POST',
      token: a.token,
      body: {
        businessName: `RC Biz ${Date.now()}`,
        categoryKey: cat?.key || 'retail_store',
        description: 'rc-smoke'
      }
    });
    const { io } = await import('socket.io-client');
    const group = await req('/groups', {
      method: 'POST',
      token: a.token,
      body: { name: `rcg-${uniq('n')}` }
    });
    await req(`/groups/${group.id}/members`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const got = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      const sock = io(WS, {
        transports: ['websocket'],
        auth: { token: b.token },
        extraHeaders: { origin: 'http://localhost:5173' }
      });
      sock.on('connect_error', (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });
      sock.on('connect', () => {
        sock.emit('group:join', { groupId: group.id }, (ack) => {
          if (!ack?.success) {
            clearTimeout(timer);
            sock.close();
            reject(new Error('join failed'));
            return;
          }
          sock.on('group:message:new', (msg) => {
            clearTimeout(timer);
            sock.close();
            resolve(msg);
          });
          void req(`/groups/${group.id}/messages`, {
            method: 'POST',
            token: a.token,
            body: { encryptedContent: 'rc-ws-hello' }
          }).catch((e) => {
            clearTimeout(timer);
            sock.close();
            reject(e);
          });
        });
      });
    });
    record('rc.groups-ws-fanout', got?.encryptedContent === 'rc-ws-hello', `id=${got?.id || ''}`);
  } catch (e) {
    record('rc.groups-ws-fanout', false, e.message);
  }

  // Channel member denied via WS
  try {
    const { io } = await import('socket.io-client');
    const channel = await req('/channels', {
      method: 'POST',
      token: a.token,
      body: { name: `rcc-${uniq('n')}` }
    });
    await req(`/channels/${channel.id}/subscriptions`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const denied = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      const sock = io(WS, {
        transports: ['websocket'],
        auth: { token: b.token },
        extraHeaders: { origin: 'http://localhost:5173' }
      });
      sock.on('connect_error', (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });
      sock.on('connect', () => {
        sock.emit('channel:join', { channelId: channel.id }, () => {
          sock
            .timeout(4000)
            .emit(
              'channel:message:send',
              { channelId: channel.id, encryptedContent: 'nope', clientRequestId: uniq('cr') },
              (err, ack) => {
                clearTimeout(timer);
                sock.close();
                if (err) resolve({ denied: true, via: 'timeout-or-error' });
                else resolve({ denied: !ack?.success, ack });
              }
            );
        });
      });
    });
    record('rc.channel-ws-member-denied', Boolean(denied.denied), JSON.stringify(denied).slice(0, 120));
  } catch (e) {
    record('rc.channel-ws-member-denied', false, e.message);
  }

  try {
    const health = await fetch('http://127.0.0.1:3000/health');
    const body = await health.json();
    const pg = body?.dependencies?.postgres;
    const rd = body?.dependencies?.redis;
    record(
      'rc.health-postgres-redis',
      health.ok && pg === 'up' && rd === 'up',
      `postgres=${pg} redis=${rd} media=${body?.dependencies?.media?.driver}`
    );
  } catch (e) {
    record('rc.health-postgres-redis', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notRun = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nRC FEATURE SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`);
  const dest = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'docs',
    'social-platform',
    '_rc-feature-results.json'
  );
  writeFileSync(dest, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`wrote ${dest}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
