/**
 * Real Argon2id dual-verify + rehash test (no DB required).
 * Run: node scripts/security-argon2-migrate-test.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash as bcryptHash } from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../backend/package.json'));
const argon2 = require('argon2');

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const password = 'CorrectHorseBattery!9';

const bcryptStored = await bcryptHash(password, 12);
const argonStored = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1
});

async function verifyPassword(pw, stored) {
  if (stored.startsWith('$argon2')) {
    const ok = await argon2.verify(stored, pw);
    return { ok, needsRehash: ok && argon2.needsRehash(stored, { memoryCost: 65536, timeCost: 3, parallelism: 1, type: argon2.argon2id }) };
  }
  if (/^\$2[aby]\$/.test(stored)) {
    const { compare } = await import('bcryptjs');
    const ok = await compare(pw, stored);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

const vBcrypt = await verifyPassword(password, bcryptStored);
if (vBcrypt.ok && vBcrypt.needsRehash) record('legacy_bcrypt_verify', 'PASS');
else record('legacy_bcrypt_verify', 'FAIL', JSON.stringify(vBcrypt));

const upgraded = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1
});
if (upgraded.startsWith('$argon2id$')) record('rehash_to_argon2id', 'PASS', upgraded.slice(0, 24));
else record('rehash_to_argon2id', 'FAIL');

const vArgon = await verifyPassword(password, upgraded);
if (vArgon.ok && !vArgon.needsRehash) record('argon2_verify_stable', 'PASS');
else record('argon2_verify_stable', 'FAIL', JSON.stringify(vArgon));

const bad = await verifyPassword('wrong-password!!', upgraded);
if (!bad.ok) record('argon2_reject_wrong', 'PASS');
else record('argon2_reject_wrong', 'FAIL');

const direct = await argon2.verify(argonStored, password);
if (direct) record('argon2_native_roundtrip', 'PASS');
else record('argon2_native_roundtrip', 'FAIL');

const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nSummary: PASS=${results.length - fail} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
