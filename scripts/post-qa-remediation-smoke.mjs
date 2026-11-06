/**
 * Post-QA remediation regression: admin verification ACL, OTP status,
 * hashtag search, archive restore, video trim status/API, explore ranking signal.
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
    throw new Error(`${method} ${pathname} -> ${res.status} ${JSON.stringify(json?.message || text.slice(0, 160))}`);
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
    body: { username, password: 'Password123!', deviceId: `pq-${username}` }
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
      fileName: 'pq.png',
      mimeType: 'image/png',
      mediaType: 'image',
      sizeBytes: png.length,
      purpose,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pq.png');
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `${ORIGIN}${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  await req('/media/complete', { method: 'POST', token, body: { mediaId: ticket.media.id } });
  return ticket.media.id;
}

async function main() {
  try {
    const hr = await fetch(`${ORIGIN}/health`);
    if (!hr.ok) throw new Error('health');
    record('api reachable', true);
  } catch (e) {
    record('api reachable', false, e.message);
    process.exit(1);
  }

  const alice = await register('pqa');
  const bob = await register('pqb');
  record('register', true);

  // OTP provider status (no secrets)
  try {
    const st = await req('/auth/otp/provider-status');
    record(
      'otp.provider-status',
      st.mode === 'mock' || st.mode === 'live',
      `mode=${st.mode} smsConfigured=${st.smsConfigured}`
    );
  } catch (e) {
    record('otp.provider-status', false, e.message);
  }

  // Non-admin cannot list verification queue
  try {
    const { res } = await req('/admin/verification', { token: alice.token, raw: true });
    record('admin.verification-denied-non-admin', res.status === 403, `status=${res.status}`);
  } catch (e) {
    record('admin.verification-denied-non-admin', false, e.message);
  }

  // Promote alice to admin via prisma SQL for test
  try {
    const { spawnSync } = await import('node:child_process');
    const cid = spawnSync('docker', ['ps', '-q', '--filter', 'name=postgres'], { encoding: 'utf8' })
      .stdout.trim()
      .split(/\s+/)[0];
    if (!cid) throw new Error('no postgres container');
    const sql = `UPDATE "User" SET role='admin' WHERE id='${alice.id}';`;
    const r = spawnSync('docker', ['exec', '-i', cid, 'psql', '-U', 'app', '-d', 'secure_messaging', '-c', sql], {
      encoding: 'utf8'
    });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    const list = await req('/admin/verification', { token: alice.token });
    record('admin.verification-list-as-admin', Array.isArray(list), `count=${list.length}`);
  } catch (e) {
    record('admin.verification-list-as-admin', false, e.message);
  }

  // Self-review forbidden: create biz + request then try self approve as same user who is also admin
  try {
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.[0];
    await req('/business/switch', {
      method: 'POST',
      token: bob.token,
      body: { businessName: `PQ Biz ${Date.now()}`, categoryKey: cat?.key || 'retail_store', description: 'pq' }
    });
    const mediaId = await uploadPng(bob.token, 'verification');
    const crypto = await import('node:crypto');
    const nonce = `${Date.now()}_${Math.random()}`;
    const contentHash = crypto.createHash('sha256').update(`pq-doc-${nonce}-bob`).digest('hex');
    const submitted = await req('/verification/submit', {
      method: 'POST',
      token: bob.token,
      body: {
        track: 'individual_seller',
        applicantName: 'Bob',
        nationalId: `ID${Date.now()}${Math.floor(Math.random() * 9999)}`,
        documents: [{ docType: 'national_id', mediaId, contentHash }],
        attested: true
      }
    });
    const carol = await register('pqc');
    await req('/business/switch', {
      method: 'POST',
      token: carol.token,
      body: { businessName: `PQ Biz2 ${Date.now()}`, categoryKey: cat?.key || 'retail_store', description: 'pq' }
    });
    const media2 = await uploadPng(carol.token, 'verification');
    const reg = `REG${Date.now()}${Math.floor(Math.random() * 9999)}`;
    const hashDoc = crypto.createHash('sha256').update(`pq-doc-${nonce}-carol`).digest('hex');
    await req('/verification/submit', {
      method: 'POST',
      token: carol.token,
      body: {
        track: 'licensed_business',
        businessName: 'Carol Co',
        registrationNumber: reg,
        documents: [{ docType: 'license', mediaId: media2, contentHash: hashDoc }],
        attested: true
      }
    });
    const dave = await register('pqd');
    await req('/business/switch', {
      method: 'POST',
      token: dave.token,
      body: { businessName: `PQ Biz3 ${Date.now()}`, categoryKey: cat?.key || 'retail_store', description: 'pq' }
    });
    const media3 = await uploadPng(dave.token, 'verification');
    const { res: clashRes } = await req('/verification/submit', {
      method: 'POST',
      token: dave.token,
      body: {
        track: 'licensed_business',
        businessName: 'Dave Co',
        registrationNumber: reg,
        documents: [
          {
            docType: 'license',
            mediaId: media3,
            contentHash: crypto.createHash('sha256').update(`pq-doc-${nonce}-dave`).digest('hex')
          }
        ],
        attested: true
      },
      raw: true
    });
    record('verification.concurrent-reg-clash', clashRes.status >= 400, `status=${clashRes.status}`);

    // Self-review: make bob admin and try review own request
    const { spawnSync } = await import('node:child_process');
    const cid = spawnSync('docker', ['ps', '-q', '--filter', 'name=postgres'], { encoding: 'utf8' })
      .stdout.trim()
      .split(/\s+/)[0];
    spawnSync(
      'docker',
      ['exec', '-i', cid, 'psql', '-U', 'app', '-d', 'secure_messaging', '-c', `UPDATE "User" SET role='admin' WHERE id='${bob.id}';`],
      { encoding: 'utf8' }
    );
    const { res: selfRes } = await req(`/admin/verification/${submitted.id}/review`, {
      method: 'POST',
      token: bob.token,
      body: { status: 'approved' },
      raw: true
    });
    record('verification.self-review-forbidden', selfRes.status === 403, `status=${selfRes.status}`);

    // Admin alice reviews bob
    const detail = await req(`/admin/verification/${submitted.id}`, { token: alice.token });
    const reviewed = await req(`/admin/verification/${submitted.id}/review`, {
      method: 'POST',
      token: alice.token,
      body: { status: 'approved', adminNote: 'ok' }
    });
    record(
      'verification.admin-approve-cycle',
      reviewed.status === 'approved' && Array.isArray(detail.documents),
      `status=${reviewed.status} docs=${detail.documents?.length}`
    );
  } catch (e) {
    record('verification.admin-approve-cycle', false, e.message);
  }

  // Hashtag search
  try {
    const m = await uploadPng(alice.token, 'post');
    await req('/posts', {
      method: 'POST',
      token: alice.token,
      body: { caption: 'tag search', mediaIds: [m], hashtags: ['رمضان', 'remediation'] }
    });
    const search = await req(`/search?q=${encodeURIComponent('رمضان')}`, { token: bob.token });
    const hit =
      (search.hashtags || []).some((h) => String(h.tag).toLowerCase().includes('رمضان')) ||
      (search.taggedPosts || []).length > 0;
    record('search.hashtags', hit, `tags=${(search.hashtags || []).length} tagged=${(search.taggedPosts || []).length}`);
  } catch (e) {
    record('search.hashtags', false, e.message);
  }

  // Archive restore
  try {
    const m = await uploadPng(alice.token, 'post');
    const post = await req('/posts', {
      method: 'POST',
      token: alice.token,
      body: { caption: 'to archive', mediaIds: [m], hashtags: ['archive'] }
    });
    await req(`/posts/${post.id}/archive`, { method: 'PATCH', token: alice.token, body: { archive: true } });
    const arch = await req('/content/archive', { token: alice.token });
    const listed = (arch.posts || []).some((p) => p.id === post.id);
    await req(`/posts/${post.id}/archive`, { method: 'PATCH', token: alice.token, body: { archive: false } });
    const feed = await req('/feed', { token: alice.token });
    const restored = feed.some((p) => p.id === post.id);
    record('archive.restore', listed && restored, `listed=${listed} restored=${restored}`);
  } catch (e) {
    record('archive.restore', false, e.message);
  }

  // Video trim status + reject over 60 without ffmpeg claim
  try {
    const st = await req('/media/trim/status');
    record('video.trim-status', typeof st.available === 'boolean', `available=${st.available}`);
    if (st.available) {
      // create tiny fake video bytes — may fail probe; that's OK to mark NOT RUN for trim exec
      try {
        const bytes = Buffer.alloc(256, 1);
        const ticket = await req('/media/upload-ticket', {
          method: 'POST',
          token: alice.token,
          body: {
            fileName: 'x.mp4',
            mimeType: 'video/mp4',
            mediaType: 'video',
            sizeBytes: bytes.length,
            purpose: 'reel',
            encryptedFileKey: 'public-unencrypted'
          }
        });
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'x.mp4');
        const url = ticket.upload.url.startsWith('http')
          ? ticket.upload.url
          : `${ORIGIN}${ticket.upload.url}`;
        await fetch(url, { method: 'POST', body: form });
        await req('/media/complete', {
          method: 'POST',
          token: alice.token,
          body: { mediaId: ticket.media.id, durationSeconds: 90 }
        });
        const { res } = await req('/media/trim', {
          method: 'POST',
          token: alice.token,
          body: { mediaId: ticket.media.id, startSeconds: 0, endSeconds: 90 },
          raw: true
        });
        record('video.trim-reject-over-60', res.status >= 400, `status=${res.status}`);
      } catch (e) {
        record('video.trim-reject-over-60', false, e.message);
      }
    } else {
      record('video.trim-exec', null, 'ffmpeg reported unavailable');
    }
  } catch (e) {
    record('video.trim-status', false, e.message);
  }

  // Explore ranking: not_interested demotes (soft check — still returns array)
  try {
    const explore = await req('/explore', { token: bob.token });
    record('explore.ranked-list', Array.isArray(explore), `count=${explore.length}`);
  } catch (e) {
    record('explore.ranked-list', false, e.message);
  }

  // Calls ICE / TURN honesty
  try {
    const ice = await req('/calls/ice-servers', { token: alice.token });
    const note = ice.note || ice.warning || '';
    record(
      'calls.ice-config',
      Array.isArray(ice.iceServers || ice.servers || ice),
      `turnHint=${String(note).slice(0, 80)}`
    );
  } catch (e) {
    record('calls.ice-config', false, e.message);
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const skipped = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nSummary: PASS=${passed} FAIL=${failed} NOT_RUN=${skipped}`);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(root, 'docs', 'social-platform', 'qa-artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'post-qa-remediation-smoke.json'),
    JSON.stringify({ at: new Date().toISOString(), results, summary: { passed, failed, skipped } }, null, 2)
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
