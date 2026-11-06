/** Resolve ISO country code from client IP (best-effort; localhost → IQ). */

const PRIVATE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc|fd|localhost)/i;

export async function countryFromIp(ip: string | undefined | null): Promise<string> {
  const first = String(ip || '').split(',')[0] ?? '';
  const raw = first.trim().replace(/^::ffff:/, '');
  if (!raw || PRIVATE.test(raw) || raw === 'unknown') {
    return 'IQ';
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(raw)}/country/`, {
      signal: ctrl.signal,
      headers: { Accept: 'text/plain' }
    });
    clearTimeout(timer);
    if (!res.ok) return 'IQ';
    const text = (await res.text()).trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(text)) return text;
  } catch {
    /* ignore */
  }
  return 'IQ';
}
