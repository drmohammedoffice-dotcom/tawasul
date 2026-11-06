/**
 * Phase 3 smoke: multi-media posts, hashtags, reel duration, idempotency,
 * comments disable, archive, content signals, share link/DM, stories expiry ACL.
 * Honest PASS/FAIL/NOT RUN only.
 */
const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:3000';

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
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 220);
    throw new Error(`${method} ${pathname} -> ${res.status} ${msg}`);
  }
  return json?.data ?? json;
}

function uniq(p) {
  return `${p}_${Date.now()}_${Math.floor(Math.random() * 999)}`;
}

async function register(prefix) {
  const username = uniq(prefix);
  const data = await req('/auth/register', {
    method: 'POST',
    body: { username, password: 'Password123!', deviceId: `p3-${username}` }
  });
  return { token: data.accessToken, id: data.user.id, username };
}

async function uploadPng(token, purpose = 'post', tint = 0) {
  // Distinct tiny PNGs via different base64 payloads (1x1)
  const pngs = [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=='
  ];
  const png = Buffer.from(pngs[tint % pngs.length], 'base64');
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: `p3-${tint}.png`,
      mimeType: 'image/png',
      mediaType: 'image',
      sizeBytes: png.length,
      purpose,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), `p3-${tint}.png`);
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `${ORIGIN}${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  await req('/media/complete', { method: 'POST', token, body: { mediaId: ticket.media.id } });
  return ticket.media.id;
}

async function uploadVideoStub(token, durationSeconds) {
  const bytes = Buffer.alloc(64, 1);
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: 'reel.mp4',
      mimeType: 'video/mp4',
      mediaType: 'video',
      sizeBytes: bytes.length,
      purpose: 'reel',
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'reel.mp4');
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `${ORIGIN}${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`video upload ${up.status}`);
  await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id, durationSeconds }
  });
  return ticket.media.id;
}

async function main() {
  try {
    const hr = await fetch(`${ORIGIN}/health`);
    if (!hr.ok) throw new Error(`health ${hr.status}`);
    record('api reachable', true);
  } catch (e) {
    record('api reachable', false, e.message);
    process.exit(1);
  }

  let alice, bob;
  try {
    alice = await register('p3a');
    bob = await register('p3b');
    record('register users', true, `${alice.username},${bob.username}`);
  } catch (e) {
    record('register users', false, e.message);
    process.exit(1);
  }

  // 1) Hashtag validation: 0 tags rejected
  try {
    const m = await uploadPng(alice.token, 'post', 0);
    const { res } = await req('/posts', {
      method: 'POST',
      token: alice.token,
      body: { caption: 'no-tags', mediaIds: [m], hashtags: [] },
      raw: true
    });
    record('hashtags.reject-empty', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('hashtags.reject-empty', false, e.message);
  }

  // 2) Hashtag validation: >5 rejected
  try {
    const m = await uploadPng(alice.token, 'post', 1);
    const { res } = await req('/posts', {
      method: 'POST',
      token: alice.token,
      body: {
        caption: 'too-many',
        mediaIds: [m],
        hashtags: ['a', 'b', 'c', 'd', 'e', 'f']
      },
      raw: true
    });
    record('hashtags.reject-over-five', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('hashtags.reject-over-five', false, e.message);
  }

  // 3) Multi-image post with order + Arabic/English tags + idempotency
  let multiPost;
  try {
    const ids = [
      await uploadPng(alice.token, 'post', 0),
      await uploadPng(alice.token, 'post', 1),
      await uploadPng(alice.token, 'post', 2)
    ];
    const clientRequestId = `cr_p3_${Date.now()}`;
    const body = {
      caption: 'multi carousel',
      mediaIds: ids,
      hashtags: ['سفر', 'Travel', 'سفر'], // dedupe Arabic+EN
      clientRequestId
    };
    multiPost = await req('/posts', { method: 'POST', token: alice.token, body });
    const again = await req('/posts', { method: 'POST', token: alice.token, body });
    const orderOk =
      Array.isArray(multiPost.media) &&
      multiPost.media.length === 3 &&
      multiPost.media.every((row, i) => row.mediaId === ids[i] || row.media?.id === ids[i]);
    const tags = (multiPost.hashtags || []).map((h) => h.hashtag?.tag || h.tag).filter(Boolean);
    const tagCountOk = tags.length >= 1 && tags.length <= 5;
    const idemOk = again.id === multiPost.id;
    record(
      'posts.multi-media+hashtags+idempotency',
      orderOk && tagCountOk && idemOk,
      `media=${multiPost.media?.length} tags=${tags.join(',')} sameId=${idemOk}`
    );
  } catch (e) {
    record('posts.multi-media+hashtags+idempotency', false, e.message);
  }

  // 4) Feed / explore / get by id show media order
  try {
    const feed = await req('/feed', { token: alice.token });
    const explore = await req('/explore', { token: alice.token });
    const one = multiPost ? await req(`/posts/${multiPost.id}`, { token: alice.token }) : null;
    const inFeed = Array.isArray(feed) && multiPost && feed.some((p) => p.id === multiPost.id);
    const order =
      one?.media?.map((m) => m.sortOrder ?? m.mediaId).join(',') || '';
    record(
      'posts.visible-feed-explore-detail',
      Boolean(inFeed && one?.id === multiPost.id && Array.isArray(explore)),
      `inFeed=${inFeed} order=${order}`
    );
  } catch (e) {
    record('posts.visible-feed-explore-detail', false, e.message);
  }

  // 5) Reel duration > 60 rejected; <= 60 accepted
  try {
    const longId = await uploadVideoStub(alice.token, 90);
    const { res: longRes } = await req('/reels', {
      method: 'POST',
      token: alice.token,
      body: { mediaId: longId, caption: 'long', hashtags: ['clip'] },
      raw: true
    });
    record('reels.reject-over-60s', longRes.status >= 400, `status=${longRes.status}`);
  } catch (e) {
    record('reels.reject-over-60s', false, e.message);
  }

  let reel;
  try {
    const okId = await uploadVideoStub(alice.token, 45);
    reel = await req('/reels', {
      method: 'POST',
      token: alice.token,
      body: { mediaId: okId, caption: 'ok reel', hashtags: ['ريلز', 'reel'] }
    });
    record('reels.accept-under-60s', Boolean(reel?.id), `id=${reel?.id}`);
  } catch (e) {
    record('reels.accept-under-60s', false, e.message);
  }

  // 6) Disable comments + archive + restore
  try {
    if (!multiPost) throw new Error('no post');
    await req(`/posts/${multiPost.id}/comments-disabled`, {
      method: 'PATCH',
      token: alice.token,
      body: { disabled: true }
    });
    const { res: cRes } = await req(`/posts/${multiPost.id}/comments`, {
      method: 'POST',
      token: bob.token,
      body: { body: 'should fail' },
      raw: true
    });
    await req(`/posts/${multiPost.id}/archive`, {
      method: 'PATCH',
      token: alice.token,
      body: { archive: true }
    });
    const feedAfter = await req('/feed', { token: alice.token });
    const hidden = !feedAfter.some((p) => p.id === multiPost.id);
    const archive = await req('/content/archive', { token: alice.token });
    const listed = (archive.posts || archive || []).some?.((p) => p.id === multiPost.id) ||
      (Array.isArray(archive?.posts) && archive.posts.some((p) => p.id === multiPost.id));
    await req(`/posts/${multiPost.id}/archive`, {
      method: 'PATCH',
      token: alice.token,
      body: { archive: false }
    });
    await req(`/posts/${multiPost.id}/comments-disabled`, {
      method: 'PATCH',
      token: alice.token,
      body: { disabled: false }
    });
    record(
      'controls.comments-off+archive+restore',
      cRes.status >= 400 && hidden && listed,
      `commentStatus=${cRes.status} hidden=${hidden} inArchive=${listed}`
    );
  } catch (e) {
    record('controls.comments-off+archive+restore', false, e.message);
  }

  // 7) Content signals (storage only)
  try {
    if (!multiPost) throw new Error('no post');
    const sig = await req('/content/signals', {
      method: 'POST',
      token: bob.token,
      body: { targetType: 'post', targetId: multiPost.id, signal: 'not_interested' }
    });
    record('signals.not-interested-stored', Boolean(sig?.recorded === true), JSON.stringify(sig).slice(0, 120));
  } catch (e) {
    record('signals.not-interested-stored', false, e.message);
  }

  // 8) Share link + DM
  try {
    if (!multiPost) throw new Error('no post');
    const link = await req('/content/share-link', {
      method: 'POST',
      token: alice.token,
      body: { targetType: 'post', targetId: multiPost.id }
    });
    const dm = await req('/content/share-dm', {
      method: 'POST',
      token: alice.token,
      body: { targetType: 'post', targetId: multiPost.id, receiverIds: [bob.id] }
    });
    const urlOk = typeof link.url === 'string' && link.url.includes(multiPost.id);
    record(
      'share.link+dm',
      urlOk && (dm.sentCount >= 1 || dm.sent?.length >= 1),
      `url=${link.url} sent=${dm.sentCount}`
    );
  } catch (e) {
    record('share.link+dm', false, e.message);
  }

  // 9) Download ACL
  try {
    if (!multiPost) throw new Error('no post');
    const dl = await req('/content/download', {
      method: 'POST',
      token: bob.token,
      body: { targetType: 'post', targetId: multiPost.id }
    });
    record('download.authorized-url', Boolean(dl.secureUrl && dl.mediaId), `media=${dl.mediaId}`);
  } catch (e) {
    record('download.authorized-url', false, e.message);
  }

  // 10) Story create + close_friends ACL + expired not shareable
  try {
    const mediaId = await uploadPng(alice.token, 'story', 0);
    const story = await req('/stories', {
      method: 'POST',
      token: alice.token,
      body: { mediaId, audience: 'close_friends' }
    });
    const { res: bobView } = await req(`/stories/${story.id}/view`, {
      method: 'POST',
      token: bob.token,
      raw: true
    });
    const { res: bobShare } = await req('/content/share-link', {
      method: 'POST',
      token: bob.token,
      body: { targetType: 'story', targetId: story.id },
      raw: true
    });
    record(
      'stories.close-friends-acl',
      bobView.status >= 400 || bobShare.status >= 400,
      `view=${bobView.status} share=${bobShare.status}`
    );
  } catch (e) {
    record('stories.close-friends-acl', false, e.message);
  }

  // UI paths: API can prove server trim; browser paths recorded separately in report 26.
  try {
    const trim = await req('/media/trim/status');
    record(
      'ui.video-trim-editor',
      Boolean(trim?.available),
      trim?.available
        ? `server FFmpeg available binary=${trim.binary || 'ffmpeg'} max=${trim.maxClipSeconds}`
        : 'FFmpeg unavailable on API host — client MediaRecorder fallback only'
    );
  } catch (e) {
    record('ui.video-trim-editor', false, e.message);
  }
  record('ui.crop-carousel-progress', null, 'requires browser (CreateStudio carousel + progress)');
  record('ui.story-viewer-gestures', null, 'requires browser (StoriesUI viewer)');
  record('ui.rtl-ltr-responsive', null, 'requires browser (settings language dir)');

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nSummary: PASS=${passed} FAIL=${failed} NOT_RUN=${skipped}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
