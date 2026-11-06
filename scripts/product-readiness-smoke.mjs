/**
 * Product-readiness live API scenarios (two users). Honest PASS/FAIL only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '', layer = 'api') {
  const status = ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL';
  results.push({ name, status, detail, layer });
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
  return { token: data.accessToken, refresh: data.refreshToken, id: data.user.id, username, deviceId };
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
  const completed = await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id }
  });
  return { mediaId: ticket.media.id, completed };
}

async function main() {
  let a;
  let b;
  try {
    a = await register(uniq('alice'));
    b = await register(uniq('bob'));
    record('auth.register-two-users', true, `${a.username}/${b.username}`);
  } catch (e) {
    record('auth.register-two-users', false, e.message);
    finish();
    return;
  }

  try {
    const login = await req('/auth/login', {
      method: 'POST',
      body: { identifier: a.username, password: 'password123', deviceId: a.deviceId }
    });
    record('auth.login', Boolean(login?.accessToken));
  } catch (e) {
    record('auth.login', false, e.message);
  }

  try {
    // Dedicated session so revoking refresh does not break later alice/bob scenarios.
    const logoutUser = await register(uniq('logout'));
    const deviceB = `web-${uniq('d2')}`;
    const loginOtherDevice = await req('/auth/login', {
      method: 'POST',
      body: { identifier: logoutUser.username, password: 'password123', deviceId: deviceB }
    });
    const { res } = await req('/auth/logout', {
      method: 'POST',
      token: logoutUser.token,
      body: { refreshToken: logoutUser.refresh },
      raw: true
    });
    const { res: refreshRes } = await req('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: logoutUser.refresh },
      raw: true
    });
    const { res: otherRefresh } = await req('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: loginOtherDevice.refreshToken },
      raw: true
    });
    record(
      'auth.logout-endpoint',
      res.ok && refreshRes.status >= 400 && otherRefresh.ok,
      `logout=${res.status} revokedReuse=${refreshRes.status} otherDeviceRefresh=${otherRefresh.status}`
    );
  } catch (e) {
    record('auth.logout-endpoint', false, e.message);
  }

  try {
    const profile = await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { displayName: 'Alice Product', bio: 'bio for readiness', isPrivate: false }
    });
    record(
      'profile.update-text',
      profile?.displayName === 'Alice Product' && profile?.bio === 'bio for readiness'
    );
  } catch (e) {
    record('profile.update-text', false, e.message);
  }

  try {
    const uploaded = await uploadPng(a.token, 'avatar');
    const before = await req('/users/me/profile', { token: a.token });
    // Avatar URL pipeline: patch string if API allows — check whether avatarUrl changes via media alone
    const patched = await req('/users/me/profile', {
      method: 'PATCH',
      token: a.token,
      body: { avatarUrl: `media:${uploaded.mediaId}` }
    });
    record(
      'profile.avatar-pipeline',
      Boolean(patched?.avatarUrl),
      `avatarUrl=${patched?.avatarUrl ? 'set' : 'empty'} mediaId=${uploaded.mediaId} (string URL only; no first-class media bind)`
    );
    void before;
  } catch (e) {
    record('profile.avatar-pipeline', false, e.message);
  }

  try {
    await req(`/users/${b.id}/follow`, { method: 'POST', token: a.token });
    await req(`/users/${b.id}/follow`, { method: 'DELETE', token: a.token });
    await req(`/users/${b.id}/follow`, { method: 'POST', token: a.token });
    record('social.follow-unfollow', true);
  } catch (e) {
    record('social.follow-unfollow', false, e.message);
  }

  let postId = '';
  let mediaId = '';
  try {
    const media = await uploadPng(a.token, 'post');
    mediaId = media.mediaId;
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: 'readiness post', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    postId = post.id;
    const feed = await req('/feed', { token: a.token });
    const exploreAfterStub = await req('/explore', { token: b.token });
    const feedPost = Array.isArray(feed) ? feed.find((p) => p.id === postId) : null;
    const stubHidden =
      Array.isArray(exploreAfterStub) && !exploreAfterStub.some((p) => p.id === postId);
    const feedSecure = Boolean(feedPost?.media?.[0]?.media?.secureUrl);

    // Real (non-fixture) author + non-stub media must appear on Explore.
    const real = await register(`qaexplorer${Date.now()}`);
    {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.user.update({ where: { id: real.id }, data: { isAutomatedTest: false } });
      await prisma.$disconnect();
    }
    await req('/users/me/profile', {
      method: 'PATCH',
      token: real.token,
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
      token: real.token,
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
      token: real.token,
      body: { mediaId: ticket.media.id }
    });
    const realPost = await req('/posts', {
      method: 'POST',
      token: real.token,
      body: { caption: 'real explore media', mediaIds: [ticket.media.id], hashtags: ['smoke'] }
    });
    const explore = await req('/explore', { token: b.token });
    const explorePost = Array.isArray(explore) ? explore.find((p) => p.id === realPost.id) : null;
    const exploreSecure = Boolean(explorePost?.media?.[0]?.media?.secureUrl);
    record(
      'posts.create-feed-explore',
      Boolean(feedPost && feedSecure && stubHidden && explorePost && exploreSecure),
      `feed=${Boolean(feedPost)} stubHidden=${stubHidden} explore=${Boolean(explorePost)} feedSecure=${feedSecure} exploreSecure=${exploreSecure}`
    );
    {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      await prisma.user.update({ where: { id: real.id }, data: { isAutomatedTest: true } });
      await prisma.$disconnect();
    }
  } catch (e) {
    record('posts.create-feed-explore', false, e.message);
  }

  try {
    if (!postId) throw new Error('no post');
    await req(`/posts/${postId}/like`, { method: 'POST', token: b.token });
    await req(`/posts/${postId}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'nice' }
    });
    await req(`/posts/${postId}/bookmark`, { method: 'POST', token: b.token });
    record('posts.like-comment-bookmark', true);
  } catch (e) {
    record('posts.like-comment-bookmark', false, e.message);
  }

  try {
    if (!postId) throw new Error('no post');
    const { res: delDenied } = await req(`/posts/${postId}`, {
      method: 'DELETE',
      token: b.token,
      raw: true
    });
    await req(`/posts/${postId}`, { method: 'DELETE', token: a.token });
    record(
      'posts.delete-authz',
      delDenied.status >= 400,
      `nonOwner=${delDenied.status} ownerDeleted=ok`
    );
  } catch (e) {
    record('posts.delete-authz', false, e.message);
  }

  // Recreate post for media persistence check
  try {
    const media = await uploadPng(a.token, 'post');
    mediaId = media.mediaId;
    const post = await req('/posts', {
      method: 'POST',
      token: a.token,
      body: { caption: 'persist media', mediaIds: [mediaId], hashtags: ['smoke'] }
    });
    const url1 = await req(`/media/${mediaId}/url`, { token: a.token });
    const login2 = await req('/auth/login', {
      method: 'POST',
      body: { identifier: a.username, password: 'password123', deviceId: a.deviceId }
    });
    const url2 = await req(`/media/${mediaId}/url`, { token: login2.accessToken });
    record(
      'media.persist-after-relogin',
      Boolean(url1?.secureUrl && url2?.secureUrl),
      `postId=${post.id}`
    );
  } catch (e) {
    record('media.persist-after-relogin', false, e.message);
  }

  try {
    const media = await uploadPng(a.token, 'story');
    const story = await req('/stories', {
      method: 'POST',
      token: a.token,
      body: { mediaId: media.mediaId }
    });
    // Policy: stories feed = self + accepted following only (not the whole network).
    const feedNoFollow = await req('/stories/feed', { token: b.token });
    const visibleNoFollow =
      Array.isArray(feedNoFollow) && feedNoFollow.some((s) => s.id === story.id);
    await req(`/users/${a.id}/follow`, { method: 'POST', token: b.token });
    const feed = await req('/stories/feed', { token: b.token });
    const visible = Array.isArray(feed) && feed.some((s) => s.id === story.id);
    const selfFeed = await req('/stories/feed', { token: a.token });
    const visibleSelf = Array.isArray(selfFeed) && selfFeed.some((s) => s.id === story.id);
    const expiresAt = story.expiresAt ? new Date(story.expiresAt).getTime() : 0;
    const approx24h = Math.abs(expiresAt - Date.now() - 24 * 3600 * 1000) < 5 * 60 * 1000;
    record(
      'stories.create-and-feed',
      !visibleNoFollow && visible && visibleSelf && approx24h,
      `noFollow=${visibleNoFollow} afterFollow=${visible} self=${visibleSelf} expiresAt=${story.expiresAt || 'none'}`
    );

    // Expiry without waiting 24h / changing OS clock: backdate expiresAt via Prisma.
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const past = new Date(Date.now() - 60_000);
      await prisma.story.update({
        where: { id: story.id },
        data: { expiresAt: past }
      });
      await prisma.$disconnect();
      const feedAfter = await req('/stories/feed', { token: b.token });
      const stillVisible =
        Array.isArray(feedAfter) && feedAfter.some((s) => s.id === story.id);
      const selfAfter = await req('/stories/feed', { token: a.token });
      const selfStill =
        Array.isArray(selfAfter) && selfAfter.some((s) => s.id === story.id);
      const { res: viewRes } = await req(`/stories/${story.id}/view`, {
        method: 'POST',
        token: b.token,
        raw: true
      });
      const viewDenied = viewRes.status === 404 || viewRes.status === 403;
      record(
        'stories.expiry-enforced-live',
        !stillVisible && !selfStill && viewDenied,
        `feedGone=${!stillVisible} selfGone=${!selfStill} viewStatus=${viewRes.status}`
      );
    } catch (expiryErr) {
      record('stories.expiry-enforced-live', false, expiryErr.message);
    }
  } catch (e) {
    record('stories.create-and-feed', false, e.message);
    record('stories.expiry-enforced-live', null, 'skipped — create/feed failed first');
  }

  try {
    const { io } = await import('socket.io-client');
    const WS = process.env.WS_URL || 'http://127.0.0.1:3000/realtime';
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
      let fanout = null;
      const sockA = io(WS, {
        transports: ['websocket'],
        auth: { token: a.token },
        extraHeaders: { origin: 'http://localhost:5173' }
      });
      sockA.on('message:new', (msg) => {
        fanout = msg;
      });
      sock.on('connect', () => {
        sock.timeout(5000).emit(
          'message:send',
          { receiverId: a.id, encryptedContent: `dm-${Date.now()}` },
          (err, ack) => {
            setTimeout(() => {
              clearTimeout(timer);
              sock.close();
              sockA.close();
              if (err) reject(err);
              else resolve({ ack, fanout });
            }, 400);
          }
        );
      });
    });
    record(
      'dm.realtime-send-receive',
      Boolean(got?.ack?.success && got?.fanout?.id),
      `fanout=${Boolean(got?.fanout?.id)}`
    );
  } catch (e) {
    record('dm.realtime-send-receive', false, e.message);
  }

  try {
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.[0];
    await req('/business/switch', {
      method: 'POST',
      token: a.token,
      body: {
        businessName: `Ready Biz ${Date.now()}`,
        categoryKey: cat?.key || 'retail_store',
        description: 'product-readiness'
      }
    });
    const g = await req('/groups', { method: 'POST', token: a.token, body: { name: uniq('g') } });
    await req(`/groups/${g.id}/members`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const msg = await req(`/groups/${g.id}/messages`, {
      method: 'POST',
      token: b.token,
      body: { encryptedContent: 'hi-group' }
    });
    const list = await req(`/groups/${g.id}/messages`, { token: a.token });
    record('groups.create-member-message', Boolean(msg?.id) && Array.isArray(list));
  } catch (e) {
    record('groups.create-member-message', false, e.message);
  }

  try {
    const ch = await req('/channels', {
      method: 'POST',
      token: a.token,
      body: { name: uniq('ch') }
    });
    await req(`/channels/${ch.id}/subscriptions`, {
      method: 'POST',
      token: a.token,
      body: { userId: b.id, role: 'member' }
    });
    const ownerPost = await req(`/channels/${ch.id}/messages`, {
      method: 'POST',
      token: a.token,
      body: { encryptedContent: 'channel-post' }
    });
    const { res: memberDenied } = await req(`/channels/${ch.id}/messages`, {
      method: 'POST',
      token: b.token,
      body: { encryptedContent: 'nope' },
      raw: true
    });
    record(
      'channels.owner-post-member-denied',
      Boolean(ownerPost?.id) && memberDenied.status === 403,
      `memberStatus=${memberDenied.status}`
    );
  } catch (e) {
    record('channels.owner-post-member-denied', false, e.message);
  }

  try {
    const notes = await req('/notifications', { token: a.token });
    record('notifications.list', Array.isArray(notes), `count=${Array.isArray(notes) ? notes.length : 0}`);
  } catch (e) {
    record('notifications.list', false, e.message);
  }

  try {
    await req(`/users/${b.id}/block`, { method: 'POST', token: a.token });
    await req('/reports', {
      method: 'POST',
      token: a.token,
      body: { targetType: 'user', targetId: b.id, reason: 'spam' }
    });
    const { res: dmBlocked } = await req('/messages', {
      method: 'POST',
      token: a.token,
      body: { receiverId: b.id, encryptedContent: 'x' },
      raw: true
    });
    const { res: dmBlockedPeer } = await req('/messages', {
      method: 'POST',
      token: b.token,
      body: { receiverId: a.id, encryptedContent: 'y' },
      raw: true
    });
    await req(`/users/${b.id}/block`, { method: 'DELETE', token: a.token });
    record(
      'moderation.block-report',
      dmBlocked.status >= 400 && dmBlockedPeer.status >= 400,
      `dmFromBlocker=${dmBlocked.status} dmFromBlocked=${dmBlockedPeer.status}`
    );
  } catch (e) {
    record('moderation.block-report', false, e.message);
  }

  // Private profile engagement gap probe (security)
  try {
    const priv = await register(uniq('priv'));
    await req('/users/me/profile', {
      method: 'PATCH',
      token: priv.token,
      body: { isPrivate: true }
    });
    const media = await uploadPng(priv.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: priv.token,
      body: { caption: 'secret', mediaIds: [media.mediaId], hashtags: ['smoke'] }
    });
    const { res } = await req(`/posts/${post.id}/like`, {
      method: 'POST',
      token: b.token,
      raw: true
    });
    record(
      'security.private-post-like-authz',
      res.status === 403 || res.status === 404,
      `status=${res.status} (403/404 expected; 2xx means privacy gap)`
    );
  } catch (e) {
    record('security.private-post-like-authz', false, e.message);
  }

  try {
    const st = await req('/video/stream/status');
    record(
      'stream.setup-status',
      Boolean(st?.enabled),
      `enabled=${st?.enabled} webhookConfigured=${st?.webhookConfigured}`
    );
  } catch (e) {
    record('stream.setup-status', false, e.message);
  }

  // FE presence checks via HTTP only (pages), not full browser interaction
  try {
    const fe = await fetch('http://localhost:5173/');
    record('frontend.dev-server', fe.ok, `status=${fe.status}`);
  } catch (e) {
    record('frontend.dev-server', false, e.message);
  }

  finish();
}

function finish() {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notRun = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nPRODUCT READINESS SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`);
  const out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs/social-platform/_product-readiness-results.json'
  );
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
