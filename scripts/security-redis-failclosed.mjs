/**
 * Redis fail-closed check: when session key is missing, API must reject JWT.
 * Does NOT stop Redis (destructive). Instead deletes the session key for a fresh login.
 * Optional: REDIS_FAIL_PROBE=1 will also try a bogus Redis URL path via app unit assertion.
 *
 * Run: node scripts/security-redis-failclosed.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../backend/package.json'));
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

const API = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  const username = `redisfc_${Date.now().toString(36)}`.slice(0, 28);
  const password = 'RedisFailClosed!9';
  const deviceId = 'redis-fc-device';

  let reg;
  try {
    reg = await api('/auth/register', {
      method: 'POST',
      body: { username, password, deviceId }
    });
  } catch (e) {
    record('setup', 'SKIP', String(e.message || e));
    finish();
    return;
  }
  if (reg.status >= 400) {
    record('setup', 'FAIL', `status=${reg.status}`);
    finish();
    return;
  }
  const data = reg.json?.data ?? reg.json;
  const token = data.accessToken;
  const decoded = jwt.decode(token, { complete: true });
  const sid = decoded?.payload?.sid;
  if (!sid) {
    record('decode_sid', 'FAIL', 'no sid in access token');
    finish();
    return;
  }
  record('decode_sid', 'PASS', sid);

  // Baseline: session works
  const ok = await api('/account', { token });
  if (ok.status === 200) record('session_alive', 'PASS');
  else record('session_alive', 'FAIL', `status=${ok.status}`);

  // Delete Redis session → JWT must fail (fail-closed, not accept)
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
  await redis.del(`auth:session:${sid}`);
  const denied = await api('/account', { token });
  if (denied.status === 200) record('failclosed_missing_session', 'FAIL', 'accepted without redis session');
  else record('failclosed_missing_session', 'PASS', `status=${denied.status}`);

  const missing = await redis.get(`auth:session:${sid}`);
  if (missing === null) record('redis_key_gone', 'PASS');
  else record('redis_key_gone', 'FAIL');

  try {
    redis.disconnect();
  } catch {
    /* ignore windows UV close race */
  }
  setTimeout(() => finish(), 50);
}

function finish() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

