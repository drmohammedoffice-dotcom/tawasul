/**
 * Integration smoke tests against a running API on localhost:3000.
 * Uses LOCAL media path expectations; fails clearly if API/DB unavailable.
 *
 * Usage:
 *   node scripts/set-media-driver.mjs local
 *   # restart backend
 *   node scripts/integration-smoke.mjs
 */
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` | ${detail}` : ''}`);
}

async function req(pathname, { method = 'GET', token, body, formData, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
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

function uniq(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

async function main() {
  // Health
  try {
    const healthRes = await fetch('http://127.0.0.1:3000/health');
    const health = await healthRes.json();
    record('health', healthRes.ok && health.status === 'ok', JSON.stringify(health.dependencies || {}));
  } catch (e) {
    record('health', false, e.message);
    console.error('API not reachable. Start backend + postgres + redis first.');
    printSummaryAndExit();
    return;
  }

  const userA = uniq('userA');
  const userB = uniq('userB');
  const password = 'password123';
  const deviceA = `web-${uniq('devA')}`;
  const deviceB = `web-${uniq('devB')}`;

  let tokenA = '';
  let tokenB = '';
  let idA = '';
  let idB = '';

  try {
    const regA = await req('/auth/register', {
      method: 'POST',
      body: { username: userA, password, deviceId: deviceA }
    });
    tokenA = regA.accessToken;
    idA = regA.user.id;
    record('auth.register A', Boolean(tokenA && idA));
  } catch (e) {
    record('auth.register A', false, e.message);
  }

  try {
    const regB = await req('/auth/register', {
      method: 'POST',
      body: { username: userB, password, deviceId: deviceB }
    });
    tokenB = regB.accessToken;
    idB = regB.user.id;
    record('auth.register B', Boolean(tokenB && idB));
  } catch (e) {
    record('auth.register B', false, e.message);
  }

  try {
    const login = await req('/auth/login', {
      method: 'POST',
      body: { identifier: userA, password, deviceId: deviceA }
    });
    record('auth.login A', Boolean(login.accessToken));
    tokenA = login.accessToken || tokenA;
  } catch (e) {
    record('auth.login A', false, e.message);
  }

  try {
    const profile = await req('/users/me/profile', { token: tokenA });
    await req('/users/me/profile', {
      method: 'PATCH',
      token: tokenA,
      body: { displayName: 'User A', bio: 'hello bio' }
    });
    record('profile.get+update', Boolean(profile?.username));
  } catch (e) {
    record('profile.get+update', false, e.message);
  }

  try {
    const follow = await req(`/users/${idB}/follow`, { method: 'POST', token: tokenA });
    await req(`/users/${idB}/follow`, { method: 'DELETE', token: tokenA });
    await req(`/users/${idB}/follow`, { method: 'POST', token: tokenA });
    record('follow/unfollow', Boolean(follow));
  } catch (e) {
    record('follow/unfollow', false, e.message);
  }

  // Media local ticket + upload + complete + post
  let mediaId = '';
  try {
    // minimal 1x1 PNG — declare the real byte length to satisfy completeUpload size check
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const ticket = await req('/media/upload-ticket', {
      method: 'POST',
      token: tokenA,
      body: {
        fileName: 'test.png',
        mimeType: 'image/png',
        mediaType: 'image',
        sizeBytes: png.length,
        purpose: 'post',
        encryptedFileKey: 'public-unencrypted'
      }
    });
    mediaId = ticket.media.id;
    const upload = ticket.upload;
    if (upload.method === 'POST') {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
      const url = upload.url.startsWith('http') ? upload.url : `http://127.0.0.1:3000${upload.url}`;
      const up = await fetch(url, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`local upload failed ${up.status}`);
    } else {
      const up = await fetch(upload.url, {
        method: 'PUT',
        headers: upload.headers || { 'Content-Type': 'image/png' },
        body: png
      });
      if (!up.ok) throw new Error(`direct upload failed ${up.status}`);
    }
    await req('/media/complete', { method: 'POST', token: tokenA, body: { mediaId } });
    record('media.ticket+upload+complete', true, `mediaId=${mediaId}`);
  } catch (e) {
    record('media.ticket+upload+complete', false, e.message);
  }

  try {
    const { res } = await req('/media/upload-ticket', {
      method: 'POST',
      token: tokenA,
      body: {
        fileName: 'bad.exe',
        mimeType: 'application/x-msdownload',
        mediaType: 'image',
        sizeBytes: 10,
        encryptedFileKey: 'public-unencrypted'
      },
      raw: true
    });
    record('media.reject-bad-mime', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('media.reject-bad-mime', true, e.message);
  }

  let postId = '';
  try {
    if (!mediaId) throw new Error('no mediaId');
    const post = await req('/posts', {
      method: 'POST',
      token: tokenA,
      body: { caption: 'hello post', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    postId = post.id;
    record('posts.create', Boolean(postId));
  } catch (e) {
    record('posts.create', false, e.message);
  }

  try {
    const feed = await req('/feed', { token: tokenA });
    const explore = await req('/explore', { token: tokenB });
    record(
      'feed+explore',
      Array.isArray(feed) && Array.isArray(explore),
      `feed=${feed?.length ?? 0}, explore=${explore?.length ?? 0}`
    );
  } catch (e) {
    record('feed+explore', false, e.message);
  }

  try {
    if (!postId) throw new Error('no postId');
    await req(`/posts/${postId}/like`, { method: 'POST', token: tokenB });
    await req(`/posts/${postId}/comments`, {
      method: 'POST',
      token: tokenB,
      body: { body: 'nice' }
    });
    await req(`/posts/${postId}/bookmark`, { method: 'POST', token: tokenB });
    record('like+comment+bookmark', true);
  } catch (e) {
    record('like+comment+bookmark', false, e.message);
  }

  try {
    if (!mediaId) throw new Error('no mediaId');
    const story = await req('/stories', { method: 'POST', token: tokenA, body: { mediaId } });
    const stories = await req('/stories/feed', { token: tokenA });
    record('stories.create+feed', Boolean(story?.id) && Array.isArray(stories));
  } catch (e) {
    record('stories.create+feed', false, e.message);
  }

  try {
    const notes = await req('/notifications', { token: tokenA });
    record('notifications.list', Array.isArray(notes), `count=${notes?.length ?? 0}`);
  } catch (e) {
    record('notifications.list', false, e.message);
  }

  try {
    await req(`/users/${idA}/block`, { method: 'POST', token: tokenB });
    await req('/reports', {
      method: 'POST',
      token: tokenB,
      body: { targetType: 'user', targetId: idA, reason: 'spam test' }
    });
    await req(`/users/${idA}/block`, { method: 'DELETE', token: tokenB });
    record('block+report', true);
  } catch (e) {
    record('block+report', false, e.message);
  }

  // Media IDOR: B should not delete A's media
  try {
    if (!mediaId) throw new Error('no mediaId');
    const { res } = await req(`/media/${mediaId}/delete`, {
      method: 'POST',
      token: tokenB,
      raw: true
    });
    record('media.idor-delete-denied', res.status === 403 || res.status === 401, `status=${res.status}`);
  } catch (e) {
    record('media.idor-delete-denied', /403|401|Forbidden/i.test(e.message), e.message);
  }

  // Existing messaging send via REST
  try {
    const msg = await req('/messages', {
      method: 'POST',
      token: tokenA,
      body: { receiverId: idB, encryptedContent: 'cipher-text-demo' }
    });
    record('messages.private-send', Boolean(msg?.id || msg));
  } catch (e) {
    record('messages.private-send', false, e.message);
  }

  printSummaryAndExit();
}

function printSummaryAndExit() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSUMMARY passed=${passed} failed=${failed} total=${results.length}`);
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/social-platform/_smoke-results.json');
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
