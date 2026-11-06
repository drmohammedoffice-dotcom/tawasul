import { BadRequestException } from '@nestjs/common';

type Sig = { mime: string; test: (buf: Buffer) => boolean };

const SIGNATURES: Sig[] = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a
  },
  {
    mime: 'image/gif',
    test: (b) => b.length >= 6 && b.subarray(0, 6).toString('ascii').startsWith('GIF8')
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP'
  },
  {
    mime: 'video/webm',
    test: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
  },
  {
    mime: 'audio/ogg',
    test: (b) => b.length >= 4 && b.subarray(0, 4).toString('ascii') === 'OggS'
  },
  {
    mime: 'application/pdf',
    test: (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-'
  },
  {
    mime: 'application/zip',
    test: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
  }
];

/** ftyp-based containers (mp4/mov/m4a) — brand checked loosely. */
function isIsoBmff(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return true;
}

/**
 * Ensure uploaded bytes match the declared MIME allowlist entry.
 * Declared client MIME alone is never trusted.
 */
export function assertMagicMatchesMime(buffer: Buffer, declaredMime: string): void {
  if (!buffer?.length) {
    throw new BadRequestException('empty upload rejected');
  }
  const mime = declaredMime.toLowerCase().split(';')[0]?.trim() || '';
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    if (!SIGNATURES.find((s) => s.mime === 'image/jpeg')!.test(buffer)) {
      throw new BadRequestException('file signature does not match image/jpeg');
    }
    return;
  }
  const exact = SIGNATURES.find((s) => s.mime === mime);
  if (exact) {
    if (!exact.test(buffer)) {
      throw new BadRequestException(`file signature does not match ${mime}`);
    }
    return;
  }
  if (mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'audio/mp4' || mime === 'audio/mpeg') {
    // audio/mpeg may be MP3 without ftyp — accept ID3 or frame sync or ftyp
    if (mime === 'audio/mpeg') {
      const id3 = buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3';
      const frame = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0;
      if (id3 || frame || isIsoBmff(buffer)) return;
      throw new BadRequestException('file signature does not match audio/mpeg');
    }
    if (!isIsoBmff(buffer)) {
      throw new BadRequestException(`file signature does not match ${mime}`);
    }
    return;
  }
  if (mime === 'text/plain') {
    // Reject NUL-heavy binary pretending to be text
    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    let nul = 0;
    for (const b of sample) if (b === 0) nul++;
    if (nul > 2) throw new BadRequestException('file signature does not match text/plain');
    return;
  }
  throw new BadRequestException(`unsupported or unverifiable mime ${mime}`);
}

export function sniffMime(buffer: Buffer): string | null {
  for (const s of SIGNATURES) {
    if (s.test(buffer)) return s.mime;
  }
  if (isIsoBmff(buffer)) return 'video/mp4';
  return null;
}
