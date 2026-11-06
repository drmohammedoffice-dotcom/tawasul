import { BadRequestException } from '@nestjs/common';

/** Local denylist — never send passwords to external breach APIs. */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'qwertyui',
    'iloveyou',
    'admin123',
    'welcome1',
    'letmein1',
    'monkey123',
    'dragon123',
    'master123',
    'login123',
    'abc12345',
    'passw0rd',
    'changeme',
    'changeme1',
    'securechat',
    'tawasul12',
    'tawasul123',
    '11111111',
    '00000000',
    'aaaaaaaa',
    'abcdefgh',
    'asdfasdf',
    'sunshine1',
    'princess1',
    'football1',
    'baseball1',
    'superman1',
    'trustno1',
    'whatever1'
  ].map((p) => p.toLowerCase())
);

/**
 * Enforce a practical password policy without hostile complexity theater.
 * - 8..128 chars
 * - not in local common list
 * - not equal to username/email local-part (case-insensitive)
 * - reject all-whitespace / all-same-char
 */
export function assertPasswordPolicy(
  password: string,
  context?: { username?: string | null; email?: string | null }
): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException('password must be 8–128 characters');
  }
  if (/^\s+$/.test(password)) {
    throw new BadRequestException('password cannot be only whitespace');
  }
  if (/^(.)\1+$/.test(password)) {
    throw new BadRequestException('password is too weak');
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    throw new BadRequestException('password is too common');
  }
  const username = context?.username?.trim().toLowerCase();
  if (username && username.length >= 3 && lower.includes(username)) {
    throw new BadRequestException('password must not contain your username');
  }
  const emailLocal = context?.email?.split('@')[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    throw new BadRequestException('password must not contain your email name');
  }
}
