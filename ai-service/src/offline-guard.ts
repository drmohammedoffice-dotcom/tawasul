import { aiConfig } from './config';

/** Hosts that must never be contacted while OFFLINE_AI_MODE is on. */
const BLOCKED_HOST_PARTS = [
  'googleapis.com',
  'generativelanguage.googleapis.com',
  'openai.com',
  'api.openai.com',
  'anthropic.com',
  'api.anthropic.com',
  'api.groq.com',
  'openrouter.ai',
  'huggingface.co',
  'hf.co',
  'ollama.com'
];

let installed = false;
let blockedAttempts = 0;

export function getBlockedAttempts(): number {
  return blockedAttempts;
}

export function installOfflineGuard(): void {
  if (installed || !aiConfig.offlineMode) return;
  installed = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request).url);
    if (isBlockedUrl(url)) {
      blockedAttempts += 1;
      throw new Error(`OFFLINE_AI_MODE blocked external AI request: ${safeHost(url)}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

export function isBlockedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return false;
    return BLOCKED_HOST_PARTS.some((part) => host === part || host.endsWith(`.${part}`));
  } catch {
    return true;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

export function assertNoExternalAiPlan(): { offline: boolean; blockedHosts: string[] } {
  return { offline: aiConfig.offlineMode, blockedHosts: [...BLOCKED_HOST_PARTS] };
}
