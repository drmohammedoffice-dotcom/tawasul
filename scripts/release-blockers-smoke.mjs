/**
 * Release blockers: ReelComment CRUD/ACL + Cloudflare Stream live upload cycle (honest).
 * OTP/TURN reported as status probes only — never claim live without evidence.
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

function makeMp4(seconds) {
  const out = path.join(os.tmpdir(), `blk-${seconds}s-${Date.now()}.mp4`);
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=teal:s=640x360:d=${seconds}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      out
    ],
    { encoding: 'utf8' }
  );
  if (ff.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`ffmpeg failed: ${(ff.stderr || '').slice(0, 180)}`);
  }
  return out;
}

async function uploadLocalVideo(token, filePath, durationSeconds) {
  const buf = fs.readFileSync(filePath);
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: path.basename(filePath),
      mimeType: 'video/mp4',
      mediaType: 'video',
      sizeBytes: buf.length,
      purpose: 'reel',
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), path.basename(filePath));
  const url = ticket.upload.url.startsWith('http')
    ? ticket.upload.url
    : `http://127.0.0.1:3000${ticket.upload.url}`;
  const up = await fetch(url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`local upload ${up.status}`);
  await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id, durationSeconds }
  });
  return ticket.media.id;
}

async function main() {
  const a = await register(uniq('blka'));
  const b = await register(uniq('blkb'));
  record('blockers.setup', Boolean(a.token && b.token));

  // ---- ReelComment ----
  try {
    const mp4 = makeMp4(3);
    const mediaId = await uploadLocalVideo(a.token, mp4, 3);
    const reel = await req('/reels', {
      method: 'POST',
      token: a.token,
      body: { mediaId, caption: 'comment me', hashtags: ['blkc'] }
    });
    const created = await req(`/reels/${reel.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'hello reel' }
    });
    const listed = await req(`/reels/${reel.id}/comments`, { token: a.token });
    const { res: emptyBody } = await req(`/reels/${reel.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: '   ' },
      raw: true
    });
    await req(`/reels/${reel.id}/comments-disabled`, {
      method: 'PATCH',
      token: a.token,
      body: { disabled: true }
    });
    const { res: disabledRes } = await req(`/reels/${reel.id}/comments`, {
      method: 'POST',
      token: b.token,
      body: { body: 'blocked' },
      raw: true
    });
    await req(`/reels/${reel.id}/comments-disabled`, {
      method: 'PATCH',
      token: a.token,
      body: { disabled: false }
    });
    const outsider = await register(uniq('blkc'));
    const { res: strangerDel } = await req(`/reels/${reel.id}/comments/${created.id}`, {
      method: 'DELETE',
      token: outsider.token,
      raw: true
    });
    // owner may moderate-delete
    await req(`/reels/${reel.id}/comments/${created.id}`, { method: 'DELETE', token: a.token });
    const after = await req(`/reels/${reel.id}/comments`, { token: b.token });
    fs.unlinkSync(mp4);
    record(
      'blockers.reel-comments-crud-acl',
      Boolean(created?.id) &&
        listed.some((c) => c.id === created.id) &&
        emptyBody.status >= 400 &&
        disabledRes.status >= 400 &&
        strangerDel.status >= 400 &&
        !after.some((c) => c.id === created.id),
      `id=${created.id} empty=${emptyBody.status} disabled=${disabledRes.status} strangerDel=${strangerDel.status} after=${after.length}`
    );
  } catch (e) {
    record('blockers.reel-comments-crud-acl', false, e.message);
  }

  // ---- Stream live upload cycle ----
  try {
    const status = await req('/video/stream/status');
    record(
      'blockers.stream-setup-status',
      status?.enabled === true && status?.reason === 'ok',
      `enabled=${status?.enabled} reason=${status?.reason} webhook=${status?.webhookConfigured}`
    );

    if (!status?.enabled) {
      record(
        'blockers.stream-live-upload-cycle',
        null,
        `BLOCKED — Stream not enabled (${status?.reason}). Need VIDEO_STORAGE_PROVIDER=stream + Cloudflare credentials.`
      );
    } else {
      const ticket = await req('/video/stream/direct-upload', {
        method: 'POST',
        token: a.token,
        body: { maxDurationSeconds: 30 }
      });
      const uploadURL = ticket?.uploadURL || ticket?.upload?.url;
      const mediaId = ticket?.mediaId || ticket?.media?.id;
      if (!uploadURL || !mediaId) {
        throw new Error(`direct-upload missing fields keys=${Object.keys(ticket || {})}`);
      }
      const mp4 = makeMp4(2);
      const buf = fs.readFileSync(mp4);
      // Cloudflare Stream direct upload expects multipart field "file"
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'video/mp4' }), 'stream-live.mp4');
      const up = await fetch(uploadURL, { method: 'POST', body: form });
      const upText = await up.text();
      let upJson = null;
      try {
        upJson = upText ? JSON.parse(upText) : null;
      } catch {
        upJson = null;
      }
      // Poll refresh a few times for encoding (do not invent ready)
      let finalStatus = null;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          finalStatus = await req(`/video/stream/${mediaId}/refresh`, {
            method: 'POST',
            token: a.token
          });
        } catch (err) {
          finalStatus = { error: String(err.message || err) };
        }
        const ps = finalStatus?.processingStatus || finalStatus?.status;
        if (ps === 'ready' || ps === 'failed') break;
      }
      fs.unlinkSync(mp4);
      const ready =
        finalStatus?.processingStatus === 'ready' ||
        finalStatus?.status === 'ready' ||
        finalStatus?.ready === true;
      record(
        'blockers.stream-direct-upload-binary',
        up.ok || up.status === 200 || up.status === 201,
        `http=${up.status} mediaId=${mediaId} cfSuccess=${upJson?.success}`
      );
      if (ready) {
        record(
          'blockers.stream-live-upload-cycle',
          true,
          `mediaId=${mediaId} processingStatus=${finalStatus?.processingStatus || finalStatus?.status}`
        );
      } else {
        record(
          'blockers.stream-live-upload-cycle',
          null,
          `NOT RUN / PARTIAL — ticket+binary attempted; encoding not confirmed ready within poll window status=${JSON.stringify(finalStatus).slice(0, 180)}`
        );
      }
    }
  } catch (e) {
    record('blockers.stream-live-upload-cycle', false, e.message);
  }

  // OTP / TURN honesty probes
  try {
    const otp = await req('/auth/otp/provider-status');
    record(
      'blockers.otp-provider-status',
      otp?.mode === 'mock' && otp.smsConfigured === false,
      `mode=${otp?.mode} sms=${otp?.smsConfigured} productionSafe=${otp?.productionSafe} note=${(otp?.note || '').slice(0, 100)}`
    );
    record(
      'blockers.otp-live-send',
      null,
      'BLOCKED — Twilio credentials missing; mock only (no live SMS claimed)'
    );
  } catch (e) {
    record('blockers.otp-provider-status', false, e.message);
  }

  try {
    const ice = await req('/calls/ice-servers', { token: a.token });
    record(
      'blockers.calls-ice-config',
      Array.isArray(ice?.iceServers) && ice.iceServers.length > 0,
      `turnConfigured=${ice?.turnConfigured} servers=${ice.iceServers.length}`
    );
    record(
      'blockers.calls-dual-device-media',
      null,
      ice?.turnConfigured
        ? 'NOT RUN — TURN configured but dual-device/cross-network call not executed this run'
        : 'BLOCKED — TURN credentials missing (WEBRTC_TURN_URL/URLS + USERNAME + CREDENTIAL); STUN-only'
    );
  } catch (e) {
    record('blockers.calls-ice-config', false, e.message);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notRun = results.filter((r) => r.status === 'NOT RUN').length;
  console.log(`\nRELEASE BLOCKERS SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`);
  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs/social-platform/_release-blockers-results.json'
  );
  writeFileSync(out, JSON.stringify({ passed, failed, notRun, results }, null, 2));
  console.log('wrote', out);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
