function assertMagic(buffer, declaredMime) {
  const mime = declaredMime.toLowerCase().split(';')[0].trim();
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (mime === 'image/jpeg' && !isJpeg) throw new Error('bad jpeg');
  if (mime === 'image/png' && !isPng) throw new Error('bad png');
  if (mime === 'image/jpeg' && isJpeg) return;
  if (mime === 'image/png' && isPng) return;
  if (mime === 'text/plain') {
    if (buffer.includes(0)) throw new Error('binary text');
    return;
  }
  throw new Error('unsupported');
}

const results = [];
function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

try {
  assertMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');
  record('magic.jpeg_ok', 'PASS');
} catch (e) {
  record('magic.jpeg_ok', 'FAIL', String(e.message || e));
}

try {
  assertMagic(Buffer.from('not-a-jpeg'), 'image/jpeg');
  record('magic.jpeg_reject', 'FAIL', 'should reject');
} catch {
  record('magic.jpeg_reject', 'PASS');
}

try {
  assertMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
  record('magic.png_ok', 'PASS');
} catch (e) {
  record('magic.png_ok', 'FAIL', String(e.message || e));
}

try {
  assertMagic(Buffer.from('hello world'), 'text/plain');
  record('magic.text_ok', 'PASS');
} catch (e) {
  record('magic.text_ok', 'FAIL', String(e.message || e));
}

const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nSummary: PASS=${results.length - fail} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
