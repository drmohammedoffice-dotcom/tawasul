import type { AuthPayload } from '@/types/api';

const STORAGE_KEY = 'secure-messaging.session';

export function loadSession(): AuthPayload | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthPayload;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthPayload): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getOrCreateDeviceId(): string {
  const key = 'secure-messaging.device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `web-${crypto.randomUUID()}`;
  localStorage.setItem(key, generated);
  return generated;
}
