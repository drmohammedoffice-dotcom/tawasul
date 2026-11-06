import { BadRequestException } from '@nestjs/common';

const TAG_RE = /^[\p{L}\p{N}_]{1,50}$/u;

/** Normalize raw hashtag inputs (with or without #). Enforce 1–5 unique tags. */
export function normalizeHashtags(input: string[] | undefined | null, required = true): string[] {
  const raw = Array.isArray(input) ? input : [];
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = String(item || '')
      .trim()
      .replace(/^#+/, '')
      .normalize('NFC');
    if (!tag) continue;
    if (!TAG_RE.test(tag)) {
      throw new BadRequestException(`invalid hashtag: ${tag}`);
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag.slice(0, 50));
    if (cleaned.length > 5) {
      throw new BadRequestException('at most 5 hashtags allowed');
    }
  }
  if (required && cleaned.length < 1) {
    throw new BadRequestException('at least 1 hashtag is required');
  }
  if (cleaned.length > 5) {
    throw new BadRequestException('at most 5 hashtags allowed');
  }
  return cleaned;
}
