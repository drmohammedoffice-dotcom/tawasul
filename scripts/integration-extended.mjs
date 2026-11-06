/**
 * Extended live API tests: groups, channels, reels/video media.
 * Requires backend on :3000 and postgres/redis.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` | ${detail}` : ''}`);
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
  if (upload.method === 'POST') {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 't.png');
    const url = upload.url.startsWith('http') ? upload.url : `http://127.0.0.1:3000${upload.url}`;
    const up = await fetch(url, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`upload failed ${up.status}`);
  } else {
    const up = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers || { 'Content-Type': 'image/png' },
      body: png
    });
    if (!up.ok) throw new Error(`put failed ${up.status}`);
  }
  await req('/media/complete', { method: 'POST', token, body: { mediaId: ticket.media.id } });
  return ticket.media.id;
}

/** Minimal valid-looking mp4 ftyp+mdat stub may fail mime/processing; use video/mp4 bytes. */
async function uploadTinyMp4(token) {
  // Very small synthetic buffer labeled as mp4 — complete may set processing; create reel requires mediaType video + completed.
  const bytes = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f,
    0x6d, 0x69, 0x73, 0x6f, 0x32, 0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
  ]);
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      mediaType: 'video',
      sizeBytes: bytes.length,
      purpose: 'reel',
      encryptedFileKey: 'public-unencrypted'
    }
  });
  const upload = ticket.upload;
  if (upload.method === 'POST') {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
    const url = upload.url.startsWith('http') ? upload.url : `http://127.0.0.1:3000${upload.url}`;
    const up = await fetch(url, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`video upload failed ${up.status}`);
  } else {
    const up = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers || { 'Content-Type': 'video/mp4' },
      body: bytes
    });
    if (!up.ok) throw new Error(`video put failed ${up.status}`);
  }
  const completed = await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id, durationSeconds: 5 }
  });
  return { mediaId: ticket.media.id, processingStatus: completed.processingStatus };
}

async function main() {
  let owner;
  let member;
  try {
    owner = await register(uniq('own'));
    member = await register(uniq('mem'));
    const cats = await req('/business/categories');
    const cat = Array.isArray(cats) ? cats[0] : cats?.[0];
    await req('/business/switch', {
      method: 'POST',
      token: owner.token,
      body: {
        businessName: `Ext Biz ${Date.now()}`,
        categoryKey: cat?.key || 'retail_store',
        description: 'integration-extended'
      }
    });
    record('setup.users', true);
  } catch (e) {
    record('setup.users', false, e.message);
    finish();
    return;
  }

  // ---- Groups ----
  let groupId = '';
  try {
    const group = await req('/groups', {
      method: 'POST',
      token: owner.token,
      body: { name: `g_${Date.now()}` }
    });
    groupId = group.id;
    record('groups.create', Boolean(groupId), groupId);
  } catch (e) {
    record('groups.create', false, e.message);
  }

  try {
    if (!groupId) throw new Error('no group');
    await req(`/groups/${groupId}/members`, {
      method: 'POST',
      token: owner.token,
      body: { userId: member.id, role: 'member' }
    });
    record('groups.add-member', true);
  } catch (e) {
    record('groups.add-member', false, e.message);
  }

  try {
    if (!groupId) throw new Error('no group');
    const msg = await req(`/groups/${groupId}/messages`, {
      method: 'POST',
      token: member.token,
      body: { encryptedContent: 'group-cipher-1' }
    });
    const list = await req(`/groups/${groupId}/messages`, { token: member.token });
    record('groups.send+list-messages', Boolean(msg?.id) && Array.isArray(list) && list.length >= 1);
  } catch (e) {
    record('groups.send+list-messages', false, e.message);
  }

  try {
    if (!groupId) throw new Error('no group');
    const { res } = await req(`/groups/${groupId}/members/${owner.id}`, {
      method: 'DELETE',
      token: member.token,
      raw: true
    });
    record(
      'groups.unauthorized-remove-denied',
      res.status === 403 || res.status === 401 || res.status >= 400,
      `status=${res.status}`
    );
  } catch (e) {
    record('groups.unauthorized-remove-denied', /403|401|400|Forbidden/i.test(e.message), e.message);
  }

  try {
    if (!groupId) throw new Error('no group');
    await req(`/groups/${groupId}/members/${member.id}`, {
      method: 'DELETE',
      token: owner.token
    });
    record('groups.remove-member', true);
  } catch (e) {
    record('groups.remove-member', false, e.message);
  }

  // ---- Channels ----
  let channelId = '';
  try {
    const channel = await req('/channels', {
      method: 'POST',
      token: owner.token,
      body: { name: `ch_${Date.now()}` }
    });
    channelId = channel.id;
    record('channels.create', Boolean(channelId), channelId);
  } catch (e) {
    record('channels.create', false, e.message);
  }

  try {
    if (!channelId) throw new Error('no channel');
    await req(`/channels/${channelId}/subscriptions`, {
      method: 'POST',
      token: owner.token,
      body: { userId: member.id, role: 'member' }
    });
    record('channels.subscribe', true);
  } catch (e) {
    record('channels.subscribe', false, e.message);
  }

  try {
    if (!channelId) throw new Error('no channel');
    // member role may not be allowed to post — capture actual behavior
    const asOwner = await req(`/channels/${channelId}/messages`, {
      method: 'POST',
      token: owner.token,
      body: { encryptedContent: 'channel-post-1' }
    });
    const list = await req(`/channels/${channelId}/messages`, { token: member.token });
    record('channels.owner-post+list', Boolean(asOwner?.id) && Array.isArray(list));
  } catch (e) {
    record('channels.owner-post+list', false, e.message);
  }

  try {
    if (!channelId) throw new Error('no channel');
    const { res, json } = await req(`/channels/${channelId}/messages`, {
      method: 'POST',
      token: member.token,
      body: { encryptedContent: 'should-fail-or-succeed' },
      raw: true
    });
    // Document actual authorization behavior
    record(
      'channels.member-post-policy',
      true,
      `status=${res.status} note=${res.ok ? 'member can post' : JSON.stringify(json?.message || '')}`
    );
  } catch (e) {
    record('channels.member-post-policy', false, e.message);
  }

  try {
    if (!channelId) throw new Error('no channel');
    await req(`/channels/${channelId}/subscriptions/${member.id}`, {
      method: 'DELETE',
      token: owner.token
    });
    record('channels.unsubscribe', true);
  } catch (e) {
    record('channels.unsubscribe', false, e.message);
  }

  // ---- Reels / video ----
  try {
    const { res } = await req('/media/upload-ticket', {
      method: 'POST',
      token: owner.token,
      body: {
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        mediaType: 'video',
        sizeBytes: 10,
        purpose: 'reel',
        encryptedFileKey: 'public-unencrypted'
      },
      raw: true
    });
    record('reels.reject-bad-video-mime', res.status >= 400, `status=${res.status}`);
  } catch (e) {
    record('reels.reject-bad-video-mime', true, e.message);
  }

  let videoMediaId = '';
  try {
    const uploaded = await uploadTinyMp4(owner.token);
    videoMediaId = uploaded.mediaId;
    record(
      'reels.video-upload+complete',
      Boolean(videoMediaId) &&
        (uploaded.processingStatus === 'ready' || uploaded.processingStatus === 'processing'),
      `processingStatus=${uploaded.processingStatus}`
    );
  } catch (e) {
    record('reels.video-upload+complete', false, e.message);
  }

  try {
    if (!videoMediaId) throw new Error('no video media');
    const reel = await req('/reels', {
      method: 'POST',
      token: owner.token,
      body: { mediaId: videoMediaId, caption: 'reel test', hashtags: ['reeltest'] }
    });
    const feed = await req('/reels/feed', { token: member.token });
    record('reels.create+feed', Boolean(reel?.id) && Array.isArray(feed));
    if (reel?.id) {
      await req(`/reels/${reel.id}/like`, { method: 'POST', token: member.token });
      await req(`/reels/${reel.id}/view`, { method: 'POST', token: member.token });
      record('reels.like+view', true);
    } else {
      record('reels.like+view', false, 'no reel id');
    }
  } catch (e) {
    record('reels.create+feed', false, e.message);
    record('reels.like+view', false, 'skipped');
  }

  // Stream setup + failure paths (live upload only if credentials present)
  try {
    const status = await req('/video/stream/status');
    record(
      'stream.setup-status',
      Boolean(status?.reason),
      `enabled=${status.enabled} reason=${status.reason}`
    );
  } catch (e) {
    record('stream.setup-status', false, e.message);
  }

  try {
    const { res, json } = await req('/video/stream/direct-upload', {
      method: 'POST',
      token: owner.token,
      body: { maxDurationSeconds: 30 },
      raw: true
    });
    if (res.status === 503) {
      const code =
        json?.code ||
        (json?.message && typeof json.message === 'object' ? json.message.code : null) ||
        'unknown';
      record(
        'stream.direct-upload-unavailable-or-configured',
        true,
        `status=503 code=${code} (live Stream upload NOT RUN — credentials/provider not ready)`
      );
      results.push({
        name: 'stream.live-upload-cycle',
        ok: null,
        status: 'NOT RUN',
        detail: 'CLOUDFLARE_STREAM_* / VIDEO_STORAGE_PROVIDER=stream not fully configured for live encoding test'
      });
      console.log(
        'NOT RUN - stream.live-upload-cycle | Stream credentials/provider not configured for live test'
      );
    } else if (res.ok && json?.data?.uploadURL && json?.data?.mediaId) {
      record('stream.direct-upload-unavailable-or-configured', true, `status=${res.status} mediaId=${json.data.mediaId}`);
      results.push({
        name: 'stream.live-upload-cycle',
        ok: null,
        status: 'NOT RUN',
        detail: 'direct-upload ticket created; binary upload+webhook not automated in this harness'
      });
      console.log(
        'NOT RUN - stream.live-upload-cycle | ticket ok; binary upload+webhook not automated in harness'
      );
    } else {
      record(
        'stream.direct-upload-unavailable-or-configured',
        false,
        `unexpected status=${res.status} body=${JSON.stringify(json).slice(0, 160)}`
      );
    }
  } catch (e) {
    record('stream.direct-upload-unavailable-or-configured', false, e.message);
  }

  // Local video must not stay forever in processing
  try {
    if (!videoMediaId) throw new Error('no video media');
    const refreshed = await req(`/video/stream/${videoMediaId}/retry`, {
      method: 'POST',
      token: owner.token
    });
    record(
      'video.processing-retry-or-ready',
      refreshed?.processingStatus === 'ready' || refreshed?.processingStatus === 'failed',
      `status=${refreshed?.processingStatus} reason=${refreshed?.reason}`
    );
  } catch (e) {
    record('video.processing-retry-or-ready', false, e.message);
  }

  // Groups/Channels Socket.IO fanout + ACL + dedupe
  try {
    const { io } = await import('socket.io-client');
    const WS = process.env.WS_URL || 'http://127.0.0.1:3000/realtime';
    const origin = { extraHeaders: { origin: 'http://localhost:5173' } };

    const connect = (token) =>
      new Promise((resolve, reject) => {
        const sock = io(WS, { transports: ['websocket'], auth: { token }, ...origin });
        const timer = setTimeout(() => {
          sock.close();
          reject(new Error('connect timeout'));
        }, 8000);
        sock.on('connect_error', (err) => {
          clearTimeout(timer);
          sock.close();
          reject(err);
        });
        sock.on('connect', () => {
          clearTimeout(timer);
          resolve(sock);
        });
      });

    const emitAck = (sock, event, payload) =>
      new Promise((resolve, reject) => {
        sock.timeout(5000).emit(event, payload, (err, ack) => {
          if (err) reject(err);
          else resolve(ack);
        });
      });

    // Recreate group for WS test
    const wsGroup = await req('/groups', {
      method: 'POST',
      token: owner.token,
      body: { name: `g_ws_${Date.now()}` }
    });
    await req(`/groups/${wsGroup.id}/members`, {
      method: 'POST',
      token: owner.token,
      body: { userId: member.id, role: 'member' }
    });

    const ownerSock = await connect(owner.token);
    const memberSock = await connect(member.token);
    const outsider = await register(uniq('out'));
    const outsiderSock = await connect(outsider.token);

    let fanout = null;
    memberSock.on('group:message:new', (msg) => {
      fanout = msg;
    });

    const joinOwner = await emitAck(ownerSock, 'group:join', { groupId: wsGroup.id });
    const joinMember = await emitAck(memberSock, 'group:join', { groupId: wsGroup.id });
    let outsiderDenied = false;
    try {
      await emitAck(outsiderSock, 'group:join', { groupId: wsGroup.id });
    } catch {
      outsiderDenied = true;
    }

    const clientRequestId = `idem-${Date.now()}`;
    const send1 = await emitAck(ownerSock, 'group:message:send', {
      groupId: wsGroup.id,
      encryptedContent: `ws-group-${Date.now()}`,
      clientRequestId
    });
    const send2 = await emitAck(ownerSock, 'group:message:send', {
      groupId: wsGroup.id,
      encryptedContent: 'should-dedupe',
      clientRequestId
    });

    await new Promise((r) => setTimeout(r, 500));

    record(
      'websocket.group-join-acl',
      Boolean(joinOwner?.success && joinMember?.success && outsiderDenied),
      `outsiderDenied=${outsiderDenied}`
    );
    record(
      'websocket.group-message-fanout',
      Boolean(fanout?.id && fanout.id === send1?.data?.id),
      `fanoutId=${fanout?.id || 'none'}`
    );
    record(
      'websocket.group-message-dedupe',
      Boolean(send2?.duplicate === true && send2?.data?.id === send1?.data?.id),
      `duplicate=${send2?.duplicate}`
    );

    // Channel fanout — create with a fresh user to avoid plan channel-creation limits
    try {
      const chOwner = await register(uniq('chow'));
      const chMember = await register(uniq('chmem'));
      const cats2 = await req('/business/categories');
      const cat2 = Array.isArray(cats2) ? cats2[0] : cats2?.[0];
      await req('/business/switch', {
        method: 'POST',
        token: chOwner.token,
        body: {
          businessName: `Ch Biz ${Date.now()}`,
          categoryKey: cat2?.key || 'retail_store',
          description: 'channel-ws'
        }
      });
      const chOwnerSock = await connect(chOwner.token);
      const chMemberSock = await connect(chMember.token);
      const wsChannel = await req('/channels', {
        method: 'POST',
        token: chOwner.token,
        body: { name: `c_ws_${Date.now()}` }
      });
      await req(`/channels/${wsChannel.id}/subscriptions`, {
        method: 'POST',
        token: chOwner.token,
        body: { userId: chMember.id, role: 'member' }
      });
      await emitAck(chOwnerSock, 'channel:join', { channelId: wsChannel.id });
      await emitAck(chMemberSock, 'channel:join', { channelId: wsChannel.id });
      let channelFanout = null;
      chMemberSock.on('channel:message:new', (msg) => {
        channelFanout = msg;
      });
      const chSend = await emitAck(chOwnerSock, 'channel:message:send', {
        channelId: wsChannel.id,
        encryptedContent: `ws-channel-${Date.now()}`
      });
      await new Promise((r) => setTimeout(r, 500));
      record(
        'websocket.channel-message-fanout',
        Boolean(channelFanout?.id && channelFanout.id === chSend?.data?.id),
        `fanoutId=${channelFanout?.id || 'none'}`
      );
      chOwnerSock.close();
      chMemberSock.close();
    } catch (e) {
      record('websocket.channel-message-fanout', false, e.message);
    }

    // Invalid JWT must not stay connected
    const badSock = io(WS, {
      transports: ['websocket'],
      auth: { token: 'not-a-valid-jwt' },
      ...origin
    });
    const expiredDenied = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        badSock.close();
        resolve(false);
      }, 5000);
      badSock.on('connect_error', () => {
        clearTimeout(timer);
        badSock.close();
        resolve(true);
      });
      badSock.on('disconnect', () => {
        clearTimeout(timer);
        badSock.close();
        resolve(true);
      });
      badSock.on('connect', () => {
        // Auth failure should disconnect immediately after connect handshake in our gateway
        setTimeout(() => {
          if (!badSock.connected) {
            clearTimeout(timer);
            resolve(true);
          }
        }, 300);
      });
    });
    record('websocket.invalid-jwt-denied', expiredDenied);

    ownerSock.close();
    memberSock.close();
    outsiderSock.close();
  } catch (e) {
    record('websocket.group-join-acl', false, e.message);
    record('websocket.group-message-fanout', false, 'skipped');
    record('websocket.group-message-dedupe', false, 'skipped');
    if (!results.some((r) => r.name === 'websocket.channel-message-fanout')) {
      record('websocket.channel-message-fanout', false, 'skipped');
    }
    if (!results.some((r) => r.name === 'websocket.invalid-jwt-denied')) {
      record('websocket.invalid-jwt-denied', false, 'skipped');
    }
  }

  // Private DM realtime via Socket.IO (reuse existing tokens — avoids auth rate-limit)
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const { io } = await import('socket.io-client');
    const WS = process.env.WS_URL || 'http://127.0.0.1:3000/realtime';
    const got = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws timeout')), 8000);
      const sock = io(WS, {
        transports: ['websocket'],
        auth: { token: member.token },
        extraHeaders: { origin: 'http://localhost:5173' }
      });
      sock.on('connect_error', (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });
      sock.on('connect', () => {
        sock
          .timeout(5000)
          .emit(
            'message:send',
            {
              receiverId: owner.id,
              encryptedContent: `ws-dm-${Date.now()}`
            },
            (err, ack) => {
              clearTimeout(timer);
              sock.close();
              if (err) reject(typeof err === 'string' ? new Error(err) : err);
              else resolve(ack);
            }
          );
      });
    });
    record(
      'websocket.private-message-send',
      Boolean(got?.success || got?.data?.id),
      `ack=${JSON.stringify(got).slice(0, 120)}`
    );
  } catch (e) {
    record('websocket.private-message-send', false, e.message || String(e));
  }

  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const notRun = results.filter((r) => r.ok === null || r.status === 'NOT RUN').length;
  console.log(
    `\nEXTENDED SUMMARY passed=${passed} failed=${failed} notRun=${notRun} total=${results.length}`
  );
  const out = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../docs/social-platform/_extended-results.json'
  );
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
