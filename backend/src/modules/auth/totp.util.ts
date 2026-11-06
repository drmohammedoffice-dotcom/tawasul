import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): { secret: Buffer; base32: string } {
  const secret = randomBytes(bytes);
  return { secret, base32: base32Encode(secret) };
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verify TOTP with ±1 step window (30s). */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): boolean {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = Math.floor(nowMs / 1000 / 30);
  const expected = Buffer.from(normalized);
  for (const delta of [-1, 0, 1]) {
    const candidate = Buffer.from(hotp(secret, step + delta));
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUrl(opts: {
  issuer: string;
  accountName: string;
  secretBase32: string;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const issuer = encodeURIComponent(opts.issuer);
  return `otpauth://totp/${label}?secret=${opts.secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(5).toString('hex')); // 10 hex chars
  }
  return codes;
}
