/**
 * Detects usernames created by local smoke/integration scripts (`uniq('prefix')`
 * → `prefix_<timestamp>_<rand>`), plus a few agent-session fixture prefixes.
 * Real alpha usernames are extremely unlikely to match.
 */
const AUTOMATED_USERNAME =
  /^(alice|bob|logout|priv|ga|gb|gs|rca|rcb|rcs|uxa|uxb|uxs|own|str|fol|blk1|blk2|lo|img|mem|out|chow|chmem|usera|userb|ux|uxfix|msgpeer|peer|gate|rcg|rcc|d|d2|n|g|ch|cr)_[0-9a-f]+(_\d+)?$/i;

/** Tiny PNG/JPEG stubs used by smoke upload helpers (~68B 1×1). */
export const STUB_IMAGE_MAX_BYTES = 256;

/** Near-empty MP4 stubs from early reel fixtures. */
export const STUB_VIDEO_MAX_BYTES = 2048;

export function looksLikeAutomatedTestUsername(username: string): boolean {
  const u = String(username || '').trim();
  if (!u) return false;
  if (AUTOMATED_USERNAME.test(u)) return true;
  // Generic smoke pattern: short prefix + unix-ms timestamp + short rand
  if (/^[a-z][a-z0-9]{0,20}_\d{12,15}_\d{1,6}$/i.test(u)) return true;
  // Regression helpers that avoid underscores but are still fixtures
  if (/^(alphaimg|alphaready|alphaqa|qaexplorer)\d{10,}$/i.test(u)) return true;
  return false;
}

/** Prisma fragment: author must not be an automated fixture account. */
export const authorNotAutomated = {
  isAutomatedTest: false
} as const;
