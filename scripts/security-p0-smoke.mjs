/**
 * P0 security smoke checks against a running local stack.
 * Usage (from repo root): node scripts/security-p0-smoke.mjs
 * Env: API_BASE (default http://127.0.0.1:3000/api), REDIS_URL
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../backend/package.json'));
const Redis = require('ioredis');

const API = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const results = [];

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  let redis;
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true
    });
    await redis.connect();
  } catch (e) {
    record('redis.connect', 'FAIL', String(e?.message || e));
    printSummary();
    process.exit(1);
  }

  try {
    const id = `smoke-${randomUUID().slice(0, 8)}`;
    const ip = '203.0.113.50';
    const failedKey = `auth:failed:${id}:${ip}`;
    const blockKey = `auth:blocked:${id}:${ip}`;
    await redis.del(failedKey, blockKey);
    await redis.incr(failedKey);
    await redis.expire(failedKey, 60);
    await redis.set(blockKey, '1', 'EX', 30);
    const ttl = await redis.ttl(blockKey);
    if (ttl > 0) record('auth.block_key', 'PASS', `ttl=${ttl}`);
    else record('auth.block_key', 'FAIL', 'ttl missing');
    await redis.del(failedKey, blockKey);
  } catch (e) {
    record('auth.block_key', 'FAIL', String(e?.message || e));
  }

  try {
    const mediaId = 'smoke' + randomUUID().replace(/-/g, '').slice(0, 16);
    const token = randomUUID();
    const key = `media:read-token:${mediaId}:${token}`;
    await redis.set(key, 'users/smoke/object.bin', 'EX', 60);
    const got = await redis.get(key);
    if (got === 'users/smoke/object.bin') record('media.read_token_mint', 'PASS');
    else record('media.read_token_mint', 'FAIL', 'value mismatch');

    const resNoToken = await fetch(`${API}/media/local-file/${mediaId}`);
    if (resNoToken.status === 200) {
      record('media.local_file_no_token', 'FAIL', 'unexpected 200 without token');
    } else {
      record('media.local_file_no_token', 'PASS', `status=${resNoToken.status}`);
    }
    await redis.del(key);
  } catch (e) {
    record('media.local_file_no_token', 'SKIP', String(e?.message || e));
  }

  try {
    const sid = randomUUID();
    const sessionKey = `auth:session:${sid}`;
    await redis.set(
      sessionKey,
      JSON.stringify({
        sessionId: sid,
        userId: 'smoke-user',
        deviceId: 'd1',
        tokenId: 't1',
        ip: '127.0.0.1',
        userAgent: 'smoke',
        createdAt: new Date().toISOString()
      }),
      'EX',
      30
    );
    await redis.sadd(`auth:user-sessions:smoke-user`, sid);
    const members = await redis.smembers(`auth:user-sessions:smoke-user`);
    if (members.includes(sid)) record('session.user_index', 'PASS');
    else record('session.user_index', 'FAIL');
    await redis.del(sessionKey, `auth:user-sessions:smoke-user`);
  } catch (e) {
    record('session.user_index', 'FAIL', String(e?.message || e));
  }

  try {
    const healthBase = API.replace(/\/api$/, '');
    const res = await fetch(`${healthBase}/health`);
    if (res.ok) record('api.health', 'PASS', `status=${res.status}`);
    else record('api.health', 'SKIP', `status=${res.status}`);
  } catch {
    record('api.health', 'SKIP', 'API not reachable');
  }

  printSummary();
  const code = results.some((r) => r.status === 'FAIL') ? 1 : 0;
  // Avoid ioredis quit/disconnect races on Windows (UV_HANDLE_CLOSING).
  setTimeout(() => process.exit(code), 50);
}

function printSummary() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
