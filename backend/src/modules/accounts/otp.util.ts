import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export function normalizePhoneE164(raw: string, defaultCountry = 'IQ'): string | null {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  let e164 = digits.startsWith('+') ? digits : digits;
  if (!e164.startsWith('+')) {
    // Basic IQ default; callers should pass country dial code already.
    if (defaultCountry === 'IQ' && e164.startsWith('0')) e164 = `964${e164.slice(1)}`;
    e164 = `+${e164.replace(/^\+/, '')}`;
  }
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  return e164;
}

export function generateOtpCode(length = 6): string {
  const max = 10 ** length;
  const n = randomInt(0, max);
  return String(n).padStart(length, '0');
}

export function hashOtp(code: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${code}`).digest('hex');
}

export function safeEqualHash(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function sha256Normalized(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
