import { aiConfig } from '../config';

export function assertInternalToken(header: string | undefined): boolean {
  if (!header) return false;
  const value = header.startsWith('Bearer ') ? header.slice(7) : header;
  return value.length > 0 && value === aiConfig.internalToken;
}
