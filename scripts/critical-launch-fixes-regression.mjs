/**
 * Regression suite for launch-blocker fixes:
 * - P0 private-post engagement authz
 * - P0 DM block enforcement
 * - P1 logout / refresh revoke (session-scoped)
 * - P1 feed/explore secure media URLs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
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
  const upload = ticket.upload;
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 't.png');
  const url = upload.url.startsWith('http') ? upload.url : `http://127.0.0.1:3000${upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id }
  });
  return ticket.media.id;
}

async function main() {
  const owner = await register(uniq('own'));
  const stranger = await register(uniq('str'));
  const follower = await register(uniq('fol'));

  // --- P0 private post ---
  try {
    await req('/users/me/profile', {
      method: 'PATCH',
      token: owner.token,
      body: { isPrivate: true }
    });
    const mediaId = await uploadPng(owner.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: owner.token,
      body: { caption: 'private-secret', mediaIds: [mediaId], hashtags: ['smoke'] }
    });

    const { res: likeDenied } = await req(`/posts/${post.id}/like`, {
      method: 'POST',
      token: stranger.token,
      raw: true
    });
    const { res: commentDenied } = await req(`/posts/${post.id}/comments`, {
      method: 'POST',
      token: stranger.token,
      body: { body: 'nope' },
      raw: true
    });
    const { res: mediaDenied } = await req(`/media/${mediaId}/url`, {
      token: stranger.token,
      raw: true
    });

    await req(`/users/${owner.id}/follow`, { method: 'POST', token: follower.token });
    // Private accounts may leave follow pending — accept if API exists; else try engage anyway.
    try {
      await req(`/users/${follower.id}/follow/accept`, {
        method: 'POST',
        token: owner.token
      });
    } catch {
      // Some builds auto-accept; ignore.
    }

    const { res: likeOwner } = await req(`/posts/${post.id}/like`, {
      method: 'POST',
      token: owner.token,
      raw: true
    });

    record(
      'p0.private-post-stranger-denied',
      likeDenied.status === 403 && commentDenied.status === 403 && mediaDenied.status >= 400,
      `like=${likeDenied.status} comment=${commentDenied.status} media=${mediaDenied.status}`
    );
    record(
      'p0.private-post-owner-allowed',
      likeOwner.ok || likeOwner.status === 201 || likeOwner.status === 200,
      `status=${likeOwner.status}`
    );
  } catch (e) {
    record('p0.private-post-stranger-denied', false, e.message);
    record('p0.private-post-owner-allowed', false, e.message);
  }

  // --- P0 DM block ---
  try {
    const u1 = await register(uniq('blk1'));
    const u2 = await register(uniq('blk2'));
    await req(`/users/${u2.id}/block`, { method: 'POST', token: u1.token });
    const { res: fromBlocker } = await req('/messages', {
      method: 'POST',
      token: u1.token,
      body: {
        receiverId: u2.id,
        encryptedContent: 'blocked-out'
      },
      raw: true
    });
    const { res: fromBlocked } = await req('/messages', {
      method: 'POST',
      token: u2.token,
      body: {
        receiverId: u1.id,
        encryptedContent: 'blocked-in'
      },
      raw: true
    });
    const { res: listDenied } = await req(`/messages/private/${u2.id}`, {
      token: u1.token,
      raw: true
    });
    record(
      'p0.dm-block-enforced',
      fromBlocker.status === 403 && fromBlocked.status === 403 && listDenied.status === 403,
      `send=${fromBlocker.status}/${fromBlocked.status} list=${listDenied.status}`
    );
  } catch (e) {
    record('p0.dm-block-enforced', false, e.message);
  }

  // --- P1 logout session scope ---
  try {
    const user = await register(uniq('lo'));
    const other = await req('/auth/login', {
      method: 'POST',
      body: { identifier: user.username, password: 'password123', deviceId: `web-${uniq('d2')}` }
    });
    const { res: logoutRes } = await req('/auth/logout', {
      method: 'POST',
      token: user.token,
      body: { refreshToken: user.refresh },
      raw: true
    });
    const { res: reuse } = await req('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: user.refresh },
      raw: true
    });
    const { res: otherOk } = await req('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: other.refreshToken },
      raw: true
    });
    record(
      'p1.logout-revokes-current-only',
      logoutRes.ok && reuse.status >= 400 && otherOk.ok,
      `logout=${logoutRes.status} reuse=${reuse.status} other=${otherOk.status}`
    );
  } catch (e) {
    record('p1.logout-revokes-current-only', false, e.message);
  }

  // --- P1 feed/explore media URLs ---
  // Use a non-smoke username + non-stub PNG so Explore's fixture filter does not hide it.
  try {
    // Register then clear fixture flag so Explore includes this controlled sample.
    const author = await register(`qaexplorer${Date.now()}`);
    {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.user.update({ where: { id: author.id }, data: { isAutomatedTest: false } });
      await prisma.$disconnect();
    }
    await req('/users/me/profile', {
      method: 'PATCH',
      token: author.token,
      body: { isPrivate: false }
    });
    const heroPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'alpha-hero.png'
    );
    const hero = readFileSync(heroPath);
    const ticket = await req('/media/upload-ticket', {
      method: 'POST',
      token: author.token,
      body: {
        fileName: 'alpha-hero.png',
        mimeType: 'image/png',
        mediaType: 'image',
        sizeBytes: hero.length,
        purpose: 'post',
        encryptedFileKey: 'public-unencrypted'
      }
    });
    const form = new FormData();
    form.append('file', new Blob([hero], { type: 'image/png' }), 'alpha-hero.png');
    const upUrl = ticket.upload.url.startsWith('http')
      ? ticket.upload.url
      : `http://127.0.0.1:3000${ticket.upload.url}`;
    const up = await fetch(upUrl, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`hero upload ${up.status}`);
    await req('/media/complete', {
      method: 'POST',
      token: author.token,
      body: { mediaId: ticket.media.id }
    });
    const post = await req('/posts', {
      method: 'POST',
      token: author.token,
      body: { caption: 'with-image', mediaIds: [ticket.media.id], hashtags: ['smoke'] }
    });
    const feed = await req('/feed', { token: author.token });
    const explore = await req('/explore', { token: stranger.token });
    const feedPost = feed.find((p) => p.id === post.id);
    const explorePost = explore.find((p) => p.id === post.id);
    const feedUrl = feedPost?.media?.[0]?.media?.secureUrl;
    const exploreUrl = explorePost?.media?.[0]?.media?.secureUrl;
    let feedFetchOk = false;
    if (feedUrl) {
      const abs = feedUrl.startsWith('http') ? feedUrl : `http://127.0.0.1:3000${feedUrl}`;
      const imgRes = await fetch(abs);
      feedFetchOk = imgRes.ok;
    }
    record(
      'p1.feed-explore-secure-media',
      Boolean(feedUrl && exploreUrl && feedFetchOk),
      `feedUrl=${Boolean(feedUrl)} exploreUrl=${Boolean(exploreUrl)} fetchOk=${feedFetchOk}`
    );
    {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.user.update({ where: { id: author.id }, data: { isAutomatedTest: true } });
      await prisma.$disconnect();
    }
  } catch (e) {
    record('p1.feed-explore-secure-media', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nCRITICAL FIXES SUMMARY passed=${passed} failed=${failed} total=${results.length}`);
  const out = {
    at: new Date().toISOString(),
    results
  };
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const dest = path.join(dir, '..', 'docs', 'social-platform', '_critical-launch-fixes-results.json');
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`wrote ${dest}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
