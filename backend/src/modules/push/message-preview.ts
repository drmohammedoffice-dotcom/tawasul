/** Short lock-screen text. Ciphertext-looking blobs stay generic. */
export function messagePreview(raw: string | null | undefined, hasMedia = false): string {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return hasMedia ? 'مرفق' : 'رسالة جديدة';
  if (text.startsWith('{') || text.startsWith('[')) {
    return hasMedia ? 'مرفق' : 'رسالة جديدة';
  }
  return text.slice(0, 140);
}
