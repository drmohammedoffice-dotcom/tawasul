import type { AuthPayload } from '@/types/api';
import { clearSession, loadSession, saveSession } from '@/lib/session';

type Listener = (session: AuthPayload | null) => void;

let current: AuthPayload | null = loadSession();
const listeners = new Set<Listener>();
let forceLogoutHandler: ((reason: string) => void) | null = null;

export function getSessionSnapshot(): AuthPayload | null {
  return current;
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setForceLogoutHandler(handler: ((reason: string) => void) | null): void {
  forceLogoutHandler = handler;
}

export function publishSession(session: AuthPayload | null): void {
  current = session;
  if (session) saveSession(session);
  else clearSession();
  listeners.forEach((listener) => listener(session));
}

export function forceLogout(reason = 'session_expired'): void {
  publishSession(null);
  forceLogoutHandler?.(reason);
}

/** Decode JWT exp without verifying signature (client scheduling only). */
export function readAccessTokenExpiry(accessToken: string): number | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isAccessTokenExpiringSoon(accessToken: string, skewSeconds = 60): boolean {
  const exp = readAccessTokenExpiry(accessToken);
  if (!exp) return false;
  return exp * 1000 <= Date.now() + skewSeconds * 1000;
}
