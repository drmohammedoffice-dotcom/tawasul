import { hash as argon2Hash, verify as argon2Verify, needsRehash } from 'argon2';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

const ARGON2_OPTS = {
  type: 2 as const, // argon2id
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1
};

export function looksLikeArgon2(hash: string): boolean {
  return typeof hash === 'string' && hash.startsWith('$argon2');
}

export function looksLikeBcrypt(hash: string): boolean {
  return typeof hash === 'string' && /^\$2[aby]\$/.test(hash);
}

/** New passwords always use Argon2id. */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTS);
}

/**
 * Verify password against stored hash.
 * Supports Argon2id and legacy bcrypt. Returns whether a transparent upgrade is needed.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!storedHash) return { ok: false, needsRehash: false };

  if (looksLikeArgon2(storedHash)) {
    try {
      const ok = await argon2Verify(storedHash, password);
      const upgrade = ok && needsRehash(storedHash, ARGON2_OPTS);
      return { ok, needsRehash: Boolean(upgrade) };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }

  if (looksLikeBcrypt(storedHash)) {
    const ok = await bcryptCompare(password, storedHash);
    return { ok, needsRehash: ok };
  }

  return { ok: false, needsRehash: false };
}

/** Refresh-token digests stay bcrypt (short-lived secrets; no Argon2 cost needed). */
export async function hashOpaqueToken(token: string): Promise<string> {
  return bcryptHash(token, 12);
}

export async function verifyOpaqueToken(token: string, storedHash: string): Promise<boolean> {
  return bcryptCompare(token, storedHash);
}
