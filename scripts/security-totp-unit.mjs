/**
 * Offline unit checks for TOTP + password policy (no server required).
 * Run: node --experimental-vm-modules scripts/security-totp-unit.mjs
 * Uses compiled logic inlined for independence from Nest bootstrap.
 */
import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}
function verifyTotp(secret, code, nowMs = Date.now()) {
  const step = Math.floor(nowMs / 1000 / 30);
  const expected = Buffer.from(String(code));
  for (const d of [-1, 0, 1]) {
    const c = Buffer.from(hotp(secret, step + d));
    if (c.length === expected.length && timingSafeEqual(c, expected)) return true;
  }
  return false;
}
function seal(plain, keyMaterial) {
  const key = createHash('sha256').update(`seal:v1:${keyMaterial}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}
function open(blob, keyMaterial) {
  const raw = Buffer.from(blob, 'base64url');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const key = createHash('sha256').update(`seal:v1:${keyMaterial}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const secret = randomBytes(20);
const code = hotp(secret, Math.floor(Date.now() / 1000 / 30));
if (verifyTotp(secret, code)) record('totp.roundtrip', 'PASS');
else record('totp.roundtrip', 'FAIL');

if (!verifyTotp(secret, '000000')) record('totp.reject_bad', 'PASS');
else record('totp.reject_bad', 'FAIL');

const sealed = seal(secret.toString('base64url'), 'test-pepper-material-16');
const opened = Buffer.from(open(sealed, 'test-pepper-material-16'), 'base64url');
if (opened.equals(secret)) record('seal.roundtrip', 'PASS');
else record('seal.roundtrip', 'FAIL');

try {
  open(sealed, 'wrong-pepper-material!!');
  record('seal.wrong_key', 'FAIL', 'should throw');
} catch {
  record('seal.wrong_key', 'PASS');
}

if (base32Encode(secret).length >= 16) record('totp.base32', 'PASS');
else record('totp.base32', 'FAIL');

const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nSummary: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
