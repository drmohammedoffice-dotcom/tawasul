/**
 * Closed-alpha launch gate: CORS, auth session, privacy, block, IDOR-ish probes.
 * Honest PASS/FAIL/NOT RUN only. Does not print secrets.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '') {
  const status = ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL';
  results.push({ name, status, detail });
  console.log(`${status} - ${name}${detail ? ` | ${detail}` : ''}`);
}

async function req(pathname, { method = 'GET', token, body, origin, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
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
  if (raw) return { res, text, json, headers: Object.fromEntries(res.headers.entries()) };
  if (!res.ok) {
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 180);
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
    body: { username, password: 'password123', deviceId },
    origin: 'http://localhost:5173'
  });
  return {
    token: data.accessToken,
    refresh: data.refreshToken,
    id: data.user.id,
    username,
    deviceId
  };
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
  // Health
  try {
    const health = await fetch('http://127.0.0.1:3000/health');
    const body = await health.json();
    record(
      'gate.health',
      health.ok && body?.dependencies?.postgres === 'up' && body?.dependencies?.redis === 'up',
      `pg=${body?.dependencies?.postgres} redis=${body?.dependencies?.redis}`
    );
  } catch (e) {
    record('gate.health', false, e.message);
  }

  // CORS allowlist
  try {
    const optsLocal = await fetch(`${API}/users/me/profile`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });
    const optsLoopback = await fetch(`${API}/users/me/profile`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization'
      }
    });
    const optsEvil = await fetch(`${API}/users/me/profile`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example',
        'Access-Control-Request-Method': 'GET'
      }
    });
    const acLocal = optsLocal.headers.get('access-control-allow-origin');
    const acLoop = optsLoopback.headers.get('access-control-allow-origin');
    const acEvil = optsEvil.headers.get('access-control-allow-origin');
    record(
      'gate.cors-allowlist',
      acLocal === 'http://localhost:5173' &&
        acLoop === 'http://127.0.0.1:5173' &&
        (acEvil === null || acEvil !== 'http://evil.example'),
      `local=${acLocal} loopback=${acLoop} evil=${acEvil}`
    );
  } catch (e) {
    record('gate.cors-allowlist', false, e.message);
  }

  const a = await register(uniq('ga'));
  const b = await register(uniq('gb'));
  const stranger = await register(uniq('gs'));

  // Login / logout / refresh revoke
  try {
    const login = await req('/auth/login', {
      method: 'POST',
      body: { identifier: a.username, password: 'password123', deviceId: a.deviceId },
      origin: 'http://127.0.0.1:5173'
    });
    await req('/auth/logout', {
      method: 'POST',
      token: login.accessToken,
      body: { refreshToken: login.refreshToken }
    });
    const { res: reuse } = await req('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: login.refreshToken },
      raw: true
    });
    record('gate.logout-refresh-revoke', reuse.status >= 400, `reuse=${reuse.status}`);
  } catch (e) {
    record('gate.logout-refresh-revoke', false, e.message);
  }

  // Private post + search + media IDOR
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { isPrivate: true, displayName: 'GatePrivate' }
    });
    const mediaId = await uploadPng(a.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: `gate-secret-${a.username}`, mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    const { res: like } = await req(`/posts/${post.id}/like`, {
      method: 'POST',
      token: stranger.token,
      raw: true
    });
    const { res: media } = await req(`/media/${mediaId}/url`, { token: stranger.token, raw: true });
    const search = await req(`/search?q=${encodeURIComponent('gate-secret-' + a.username)}`, {
      token: stranger.token
    });
    record(
      'gate.privacy-post-search-media',
      like.status === 403 &&
        media.status >= 400 &&
        !(search.posts || []).some((p) => p.id === post.id),
      `like=${like.status} media=${media.status} searchHits=${search.posts?.length ?? 0}`
    );
  } catch (e) {
    record('gate.privacy-post-search-media', false, e.message);
  }

  // Block DM
  try {
    await req(`/users/${b.id}/block`, { method: 'POST', token: a.token });
    const { res: dm } = await req('/messages', {
      method: 'POST',
      token: b.token,
      body: { receiverId: a.id, encryptedContent: 'blocked' },
      raw: true
    });
    await req(`/users/${b.id}/block`, { method: 'DELETE', token: a.token });
    record('gate.block-dm', dm.status === 403, `status=${dm.status}`);
  } catch (e) {
    record('gate.block-dm', false, e.message);
  }

  // Group non-member IDOR (creator must be business)
  try {
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.[0];
    await req('/business/switch', {
      method: 'POST',
      token: a.token,
      body: {
        businessName: `Gate Biz ${Date.now()}`,
        categoryKey: cat?.key || 'retail_store',
        description: 'gate'
      }
    });
    const group = await req('/groups', {
      method: 'POST',
      token: a.token,
      body: { name: `gate-g-${uniq('n')}` }
    });
    const { res: msgs } = await req(`/groups/${group.id}/messages`, {
      token: stranger.token,
      raw: true
    });
    const { res: members } = await req(`/groups/${group.id}/members`, {
      token: stranger.token,
      raw: true
    });
    record(
      'gate.group-idor',
      msgs.status === 403 && members.status === 403,
      `msgs=${msgs.status} members=${members.status}`
    );
  } catch (e) {
    record('gate.group-idor', false, e.message);
  }

  // Bookmark ownership
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
      body: { caption: 'gate-bm', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    await req(`/posts/${post.id}/bookmark`, { method: 'POST', token: b.token });
    const bList = await req('/bookmarks', { token: b.token });
    const aList = await req('/bookmarks', { token: a.token });
    record(
      'gate.bookmarks-isolation',
      bList.some((p) => p.id === post.id) && !aList.some((p) => p.id === post.id),
      `b=${bList.length} a=${aList.length}`
    );
  } catch (e) {
    record('gate.bookmarks-isolation', false, e.message);
  }

  // Bad mime reject
  try {
    const { res } = await req('/media/upload-ticket', {
      method: 'POST',
      token: a.token,
      body: {
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        mediaType: 'file',
        sizeBytes: 10,
        purpose: 'post',
        encryptedFileKey: 'public-unencrypted'
      },
      raw: true
    });
    record('gate.media-bad-mime', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('gate.media-bad-mime', false, e.message);
  }

  // WS from allowed + denied origin
  try {
    const { io } = await import('socket.io-client');
    const okSock = await new Promise((resolve) => {
      const s = io(process.env.WS_URL || 'http://127.0.0.1:3000/realtime', {
        transports: ['websocket'],
        auth: { token: a.token },
        extraHeaders: { origin: 'http://127.0.0.1:5173' }
      });
      const t = setTimeout(() => {
        s.close();
        resolve(false);
      }, 5000);
      s.on('connect', () => {
        clearTimeout(t);
        s.close();
        resolve(true);
      });
      s.on('connect_error', () => {
        clearTimeout(t);
        s.close();
        resolve(false);
      });
    });
    // Node websocket cannot always spoof Origin; use polling so extraHeaders apply.
    const evilSock = await new Promise((resolve) => {
      const s = io(process.env.WS_URL || 'http://127.0.0.1:3000/realtime', {
        transports: ['polling'],
        upgrade: false,
        auth: { token: a.token },
        extraHeaders: { Origin: 'http://evil.example', origin: 'http://evil.example' }
      });
      const t = setTimeout(() => {
        s.close();
        resolve('timeout');
      }, 5000);
      s.on('connect', () => {
        clearTimeout(t);
        // If engine accepted then gateway should disconnect unauthorized origins.
        setTimeout(() => {
          const state = s.connected ? 'connected' : 'disconnected';
          s.close();
          resolve(state);
        }, 400);
      });
      s.on('connect_error', () => {
        clearTimeout(t);
        s.close();
        resolve('error');
      });
    });
    record(
      'gate.ws-origin',
      okSock === true && evilSock !== 'connected',
      `allowed=${okSock} evil=${evilSock}`
    );
  } catch (e) {
    record('gate.ws-origin', false, e.message);
  }

  // Frontend presence
  try {
    const fe = await fetch('http://localhost:5173/');
    record('gate.frontend-localhost', fe.ok, `status=${fe.status}`);
  } catch (e) {
    record('gate.frontend-localhost', false, e.message);
  }
  try {
    const fe = await fetch('http://127.0.0.1:5173/');
    record('gate.frontend-127', fe.ok, `status=${fe.status}`);
  } catch (e) {
    record('gate.frontend-127', false, e.message);
  }

  // Reel comments (ReelComment model)
  try {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const mp4Path = pathMod.join(os.tmpdir(), `gate-reel-${Date.now()}.mp4`);
    const ff = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=purple:s=320x240:d=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-an',
        mp4Path
      ],
      { encoding: 'utf8' }
    );
    if (ff.status !== 0 || !fs.existsSync(mp4Path)) throw new Error('ffmpeg seed failed');
    const buf = fs.readFileSync(mp4Path);
    const ticket = await req('/media/upload-ticket', {
      method: 'POST',
      token: a.token,
      body: {
        fileName: 'gate-reel.mp4',
        mimeType: 'video/mp4',
        mediaType: 'video',
        sizeBytes: buf.length,
        purpose: 'reel',
        encryptedFileKey: 'public-unencrypted'
      }
    });
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'video/mp4' }), 'gate-reel.mp4');
    const upUrl = ticket.upload.url.startsWith('http')
      ? ticket.upload.url
      : `http://127.0.0.1:3000${ticket.upload.url}`;
    const up = await fetch(upUrl, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`upload ${up.status}`);
    await req('/media/complete', {
      method: 'POST',
      token: a.token,
      body: { mediaId: ticket.media.id, durationSeconds: 2 }
    });
    const reel = await req('/reels', {
      method: 'POST',
      token: a.token,
      body: { mediaId: ticket.media.id, caption: 'gate comments', hashtags: ['gatec'] }
    });
    const c1 = await req(`/reels/${reel.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'nice reel' }
    });
    const listed = await req(`/reels/${reel.id}/comments`, { token: a.token });
    await req(`/reels/${reel.id}/comments-disabled`, {
      method: 'PATCH',
      token: a.token,
      body: { disabled: true }
    });
    const { res: disabledRes } = await req(`/reels/${reel.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'should fail' },
      raw: true
    });
    await req(`/reels/${reel.id}/comments-disabled`, {
      method: 'PATCH',
      token: a.token,
      body: { disabled: false }
    });
    await req(`/reels/${reel.id}/comments/${c1.id}`, { method: 'DELETE', token: a.token });
    const after = await req(`/reels/${reel.id}/comments`, { token: a.token });
    fs.unlinkSync(mp4Path);
    record(
      'gate.reels-comments-schema',
      Boolean(c1?.id) &&
        Array.isArray(listed) &&
        listed.some((c) => c.id === c1.id) &&
        disabledRes.status >= 400 &&
        Array.isArray(after) &&
        !after.some((c) => c.id === c1.id),
      `created=${c1.id} listed=${listed.length} disabledStatus=${disabledRes.status} afterDel=${after.length}`
    );
  } catch (e) {
    record('gate.reels-comments-schema', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notRun = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nCLOSED ALPHA GATE SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`);
  const dest = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'docs',
    'social-platform',
    '_closed-alpha-gate-results.json'
  );
  writeFileSync(dest, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`wrote ${dest}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
