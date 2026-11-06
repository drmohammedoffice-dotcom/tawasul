/**
 * Alpha feature completion regression: real MP4 reel (> stub filter), multi-image post,
 * server trim ≤60s, invalid mime rejection. Honest PASS/FAIL/NOT RUN.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '') {
  const status = ok === null ? 'NOT RUN' : ok ? 'PASS' : 'FAIL';
  results.push({ name, ok, status, detail });
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
    const msg = json?.message ? JSON.stringify(json.message) : text.slice(0, 240);
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
  return { token: data.accessToken, id: data.user.id, username, deviceId };
}

async function uploadBytes(token, purpose, fileName, mimeType, mediaType, buf, durationSeconds) {
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName,
      mimeType,
      mediaType,
      sizeBytes: buf.length,
      purpose,
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeType }), fileName);
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `http://127.0.0.1:3000${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload failed ${up.status}`);
  await req('/media/complete', {
    method: 'POST',
    token,
    body: {
      mediaId: ticket.media.id,
      ...(durationSeconds != null ? { durationSeconds } : {})
    }
  });
  return ticket.media.id;
}

function makeMp4(seconds) {
  const out = path.join(os.tmpdir(), `alpha-${seconds}s-${Date.now()}.mp4`);
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=640x360:d=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=f=440:d=${seconds}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      out
    ],
    { encoding: 'utf8' }
  );
  if (ff.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`ffmpeg failed: ${(ff.stderr || '').slice(0, 200)}`);
  }
  return out;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64'
);

async function main() {
  const user = await register(uniq('alpha'));
  record('alpha.setup-user', Boolean(user.token));

  // Multi-image post
  try {
    const m1 = await uploadBytes(user.token, 'post', 'a.png', 'image/png', 'image', PNG);
    const m2 = await uploadBytes(user.token, 'post', 'b.png', 'image/png', 'image', PNG);
    const post = await req('/posts', {
      method: 'POST',
      token: user.token,
      body: { caption: 'alpha multi', mediaIds: [m1, m2], hashtags: ['alphapost'], clientRequestId: uniq('cr') }
    });
    const again = await req(`/posts/${post.id}`, { token: user.token });
    const mediaCount = Array.isArray(again?.media)
      ? again.media.length
      : Array.isArray(again?.mediaIds)
        ? again.mediaIds.length
        : Array.isArray(post?.media)
          ? post.media.length
          : 0;
    record(
      'alpha.create-post-multi-image',
      Boolean(post?.id) && mediaCount >= 2,
      `postId=${post.id} mediaCount=${mediaCount}`
    );
  } catch (e) {
    record('alpha.create-post-multi-image', false, e.message);
  }

  // Invalid mime rejected
  try {
    const { res } = await req('/media/upload-ticket', {
      method: 'POST',
      token: user.token,
      body: {
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        mediaType: 'video',
        sizeBytes: 100,
        purpose: 'reel',
        encryptedFileKey: 'public-unencrypted'
      },
      raw: true
    });
    record('alpha.reject-bad-mime', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('alpha.reject-bad-mime', /400|415|Unsupported/i.test(e.message), e.message);
  }

  // Real reel + feed + like
  let reelId = '';
  try {
    const mp4 = makeMp4(4);
    const buf = fs.readFileSync(mp4);
    const mediaId = await uploadBytes(user.token, 'reel', 'alpha.mp4', 'video/mp4', 'video', buf, 4);
    const reel = await req('/reels', {
      method: 'POST',
      token: user.token,
      body: { mediaId, caption: 'alpha reel', hashtags: ['alphareel'], clientRequestId: uniq('rr') }
    });
    reelId = reel.id;
    const feed = await req('/reels/feed', { token: user.token });
    const hit = Array.isArray(feed) ? feed.find((r) => r.id === reel.id) : null;
    record(
      'alpha.reel-create-feed-playable',
      Boolean(hit?.id) && hit.playable === true && Boolean(hit.media?.secureUrl) && buf.length > 2048,
      `reel=${reel.id} playable=${hit?.playable} bytes=${buf.length} url=${Boolean(hit?.media?.secureUrl)}`
    );
    fs.unlinkSync(mp4);
  } catch (e) {
    record('alpha.reel-create-feed-playable', false, e.message);
  }

  try {
    if (!reelId) throw new Error('no reel');
    await req(`/reels/${reelId}/like`, { method: 'POST', token: user.token });
    await req(`/reels/${reelId}/like`, { method: 'DELETE', token: user.token });
    record('alpha.reel-like-unlike', true, `reel=${reelId}`);
  } catch (e) {
    record('alpha.reel-like-unlike', false, e.message);
  }

  // Server trim >60 reject + ok clip from long source
  try {
    const longPath = makeMp4(65);
    const buf = fs.readFileSync(longPath);
    const mediaId = await uploadBytes(user.token, 'reel', 'long.mp4', 'video/mp4', 'video', buf, 65);
    const status = await req('/media/trim/status');
    const over = await req('/media/trim', {
      method: 'POST',
      token: user.token,
      body: { mediaId, startSeconds: 0, endSeconds: 65 },
      raw: true
    });
    const ok = await req('/media/trim', {
      method: 'POST',
      token: user.token,
      body: { mediaId, startSeconds: 0, endSeconds: 12 }
    });
    record(
      'alpha.ffmpeg-trim-gate',
      Boolean(status?.available) && over.res.status >= 400 && Boolean(ok?.mediaId || ok?.id) && Number(ok.durationSeconds) <= 60.05,
      `available=${status?.available} over=${over.res.status} clip=${ok.durationSeconds}`
    );
    fs.unlinkSync(longPath);
  } catch (e) {
    record('alpha.ffmpeg-trim-gate', false, e.message);
  }

  // OTP / ICE honesty
  try {
    const otp = await req('/auth/otp/provider-status');
    record(
      'alpha.otp-provider-status',
      otp?.mode === 'mock' && otp.smsConfigured === false,
      `mode=${otp?.mode} sms=${otp?.smsConfigured} wa=${otp?.whatsappConfigured}`
    );
  } catch (e) {
    record('alpha.otp-provider-status', false, e.message);
  }

  try {
    const ice = await req('/calls/ice-servers', { token: user.token });
    record(
      'alpha.calls-ice-config',
      Array.isArray(ice?.iceServers) && ice.iceServers.length > 0,
      `turnConfigured=${ice?.turnConfigured} note=${(ice?.note || '').slice(0, 80)}`
    );
  } catch (e) {
    record('alpha.calls-ice-config', false, e.message);
  }

  record(
    'alpha.live-otp-send',
    null,
    'BLOCKED — Twilio credentials not configured (OTP_MESSAGING_DRIVER=mock)'
  );
  record(
    'alpha.live-webrtc-dual-device',
    null,
    'NOT RUN — requires two browsers/devices + TURN for cross-network; STUN-only lab'
  );
  record(
    'alpha.stream-live-upload-cycle',
    null,
    'NOT RUN — Cloudflare Stream binary upload + webhook not automated'
  );
  // Reel comments covered by release-blockers + closed-alpha gate; keep pointer for suite continuity
  try {
    const listed = await req('/reels/feed', { token: user.token });
    const hit = Array.isArray(listed) ? listed.find((r) => r.id === reelId) : null;
    if (!reelId || !hit) {
      record('alpha.reel-comments-schema', null, 'NOT RUN — no reel in feed for comment probe this suite');
    } else {
      const c = await req(`/reels/${reelId}/comments`, {
        method: 'POST',
        token: user.token,
        body: { body: 'alpha comment' }
      });
      const rows = await req(`/reels/${reelId}/comments`, { token: user.token });
      await req(`/reels/${reelId}/comments/${c.id}`, { method: 'DELETE', token: user.token });
      record(
        'alpha.reel-comments-schema',
        Boolean(c?.id) && Array.isArray(rows) && rows.some((x) => x.id === c.id),
        `commentId=${c.id}`
      );
    }
  } catch (e) {
    record('alpha.reel-comments-schema', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notRun = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nALPHA FEATURE SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`);
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../docs/social-platform/_alpha-feature-results.json');
  writeFileSync(out, JSON.stringify({ passed, failed, notRun, results }, null, 2));
  console.log('wrote', out);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
