/**
 * Final QA security regression: media ACL, block feed exclusion, unauthenticated 2FA.
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
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 200);
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
    body: { username, password: 'Password123!', deviceId: `qa-${username}` }
  });
  return { token: data.accessToken, id: data.user.id, username };
}

async function uploadPng(token, purpose = 'post', visibility = 'private') {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: 'qa.png',
      mimeType: 'image/png',
      mediaType: 'image',
      sizeBytes: png.length,
      purpose,
      visibility,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'qa.png');
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `${ORIGIN}${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  const completed = await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id }
  });
  return {
    mediaId: ticket.media.id,
    visibility: completed.visibility ?? ticket.media.visibility ?? null
  };
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

  const alice = await register('fqa');
  const bob = await register('fqb');
  const carol = await register('fqc');
  record('register trio', true);

  // 1) Client cannot force social media public (stranger still 403 despite requested public)
  try {
    const up = await uploadPng(alice.token, 'post', 'public');
    const { res } = await req(`/media/${up.mediaId}/url`, { token: bob.token, raw: true });
    record(
      'media.force-private-for-post-purpose',
      res.status >= 400,
      `strangerStatus=${res.status}`
    );
  } catch (e) {
    record('media.force-private-for-post-purpose', false, e.message);
  }

  // 2) Stranger cannot mint URL for unlinked uploaded media
  let orphanMediaId;
  try {
    orphanMediaId = (await uploadPng(alice.token, 'post')).mediaId;
    const { res } = await req(`/media/${orphanMediaId}/url`, { token: bob.token, raw: true });
    record('media.idor-unlinked-forbidden', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('media.idor-unlinked-forbidden', false, e.message);
  }

  // 3) After post publish, follower can access; blocked cannot
  try {
    const mediaId = orphanMediaId || (await uploadPng(alice.token, 'post')).mediaId;
    const post = await req('/posts', {
      method: 'POST',
      token: alice.token,
      body: { caption: 'acl', mediaIds: [mediaId], hashtags: ['qa'] }
    });
    await req(`/users/${alice.id}/follow`, { method: 'POST', token: bob.token });
    // accept if private not set — public accounts auto?
    // follow may be pending for private; alice is public by default
    const okBob = await req(`/media/${mediaId}/url`, { token: bob.token });
    await req(`/users/${bob.id}/block`, { method: 'POST', token: alice.token });
    const { res: blockedRes } = await req(`/media/${mediaId}/url`, { token: bob.token, raw: true });
    const feed = await req('/feed', { token: bob.token });
    const inFeed = Array.isArray(feed) && feed.some((p) => p.id === post.id);
    record(
      'media+feed.block-hides-content',
      Boolean(okBob?.secureUrl) && blockedRes.status >= 400 && !inFeed,
      `urlAfterBlock=${blockedRes.status} inFeed=${inFeed}`
    );
  } catch (e) {
    record('media+feed.block-hides-content', false, e.message);
  }

  // 4) Unauthenticated 2FA email with only userId must fail
  try {
    const { res } = await req('/auth/phone/2fa/email', {
      method: 'POST',
      body: { userId: alice.id },
      raw: true
    });
    record('auth.2fa-email-requires-phone-proof', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('auth.2fa-email-requires-phone-proof', false, e.message);
  }

  // 5) Carol (no relation) cannot read alice verification-purpose media
  try {
    const v = await uploadPng(alice.token, 'verification');
    const { res } = await req(`/media/${v.mediaId}/url`, { token: carol.token, raw: true });
    record('media.verification-idor-forbidden', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('media.verification-idor-forbidden', false, e.message);
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\nSummary: PASS=${passed} FAIL=${failed}`);
  const out = {
    generatedAt: new Date().toISOString(),
    results,
    summary: { passed, failed }
  };
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(root, 'docs', 'social-platform', 'qa-artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'final-qa-security-regression.json'), JSON.stringify(out, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
