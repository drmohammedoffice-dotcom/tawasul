/**
 * Probe: Focus media path → Cloudflare R2 + SHA-256 instant dedup.
 * Usage: node scripts/r2-upload-probe.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.API_BASE || 'http://127.0.0.1:3000/api';
const user = process.env.SMOKE_USER || 'mohammed';
const pass = process.env.SMOKE_PASS || 'Password123!';

function loadEnv() {
  const envPath = path.join(root, 'backend', '.env');
  if (!existsSync(envPath)) throw new Error(`Missing ${envPath}`);
  const map = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) map[t.slice(0, i)] = t.slice(i + 1);
  }
  return map;
}

async function req(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return json?.data ?? json;
}

async function main() {
  const env = loadEnv();
  if ((env.MEDIA_STORAGE_DRIVER || '').toLowerCase() !== 'r2') {
    throw new Error(`MEDIA_STORAGE_DRIVER is "${env.MEDIA_STORAGE_DRIVER}" (expected r2)`);
  }

  const bytes = Buffer.from(`securechat-r2-focus-probe-${Date.now()}-${randomUUID()}`, 'utf8');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const fileName = 'focus-r2-probe.txt';
  const mimeType = 'text/plain';

  console.log('1) auth…');
  let login;
  try {
    login = await req('/auth/login', {
      method: 'POST',
      body: { identifier: user, password: pass, deviceId: 'r2-probe-device' }
    });
  } catch {
    const probeUser = `r2probe_${Date.now().toString(36).slice(-6)}`;
    console.log(`   login failed for ${user}; registering ${probeUser}…`);
    login = await req('/auth/register', {
      method: 'POST',
      body: {
        username: probeUser,
        password: pass,
        deviceId: 'r2-probe-device'
      }
    });
  }
  const token = login.accessToken || login.tokens?.accessToken;
  if (!token) throw new Error('no access token');
  console.log(`   ok as ${login.user?.username || user}`);

  console.log('2) upload-ticket (first)…');
  const ticket = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName,
      mimeType,
      mediaType: 'file',
      sizeBytes: bytes.length,
      contentHash,
      purpose: 'chat',
      encryptedFileKey: 'public-unencrypted'
    }
  });
  console.log(`   instant=${ticket.instant} mediaId=${ticket.media?.id}`);
  if (ticket.instant || !ticket.upload?.url) {
    throw new Error('expected a real upload ticket for a new unique hash');
  }
  if (!String(ticket.upload.url).includes('r2.cloudflarestorage.com')) {
    throw new Error(`presigned URL is not R2: ${String(ticket.upload.url).slice(0, 80)}`);
  }
  console.log('   presigned host looks like R2');

  console.log('3) PUT bytes directly to R2…');
  const putRes = await fetch(ticket.upload.url, {
    method: ticket.upload.method || 'PUT',
    headers: ticket.upload.headers || { 'Content-Type': mimeType },
    body: bytes
  });
  if (!putRes.ok) {
    throw new Error(`R2 PUT failed ${putRes.status} ${(await putRes.text()).slice(0, 200)}`);
  }
  console.log(`   PUT ${putRes.status}`);

  console.log('4) complete…');
  const completed = await req('/media/complete', {
    method: 'POST',
    token,
    body: { mediaId: ticket.media.id, contentHash }
  });
  console.log(`   processingStatus=${completed.processingStatus} contentHash=${completed.contentHash}`);

  console.log('5) signed read + roundtrip…');
  const read = await req(`/media/${ticket.media.id}/url`, { token });
  const getRes = await fetch(read.secureUrl);
  const got = Buffer.from(await getRes.arrayBuffer());
  if (!getRes.ok) throw new Error(`signed GET failed ${getRes.status}`);
  if (!got.equals(bytes)) throw new Error('roundtrip content mismatch');
  console.log(`   roundtrip OK (${got.length} bytes)`);

  console.log('6) upload-ticket same hash (instant dedup)…');
  const ticket2 = await req('/media/upload-ticket', {
    method: 'POST',
    token,
    body: {
      fileName,
      mimeType,
      mediaType: 'file',
      sizeBytes: bytes.length,
      contentHash,
      purpose: 'chat',
      encryptedFileKey: 'public-unencrypted'
    }
  });
  console.log(`   instant=${ticket2.instant} mediaId=${ticket2.media?.id}`);
  if (!ticket2.instant) throw new Error('expected instant=true on duplicate hash');

  console.log('\nPASS: Focus media path stores on Cloudflare R2; dedup works.');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message || err);
  process.exit(1);
});
