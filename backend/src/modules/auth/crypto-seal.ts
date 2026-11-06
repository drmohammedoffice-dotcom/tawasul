import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM seal for small secrets (TOTP seeds). Key derived from env material. */
export function sealSecret(plaintext: string, keyMaterial: string): string {
  const key = createHash('sha256').update(`seal:v1:${keyMaterial}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function openSecret(blob: string, keyMaterial: string): string {
  const raw = Buffer.from(blob, 'base64url');
  if (raw.length < 12 + 16 + 1) throw new Error('invalid sealed secret');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const key = createHash('sha256').update(`seal:v1:${keyMaterial}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
