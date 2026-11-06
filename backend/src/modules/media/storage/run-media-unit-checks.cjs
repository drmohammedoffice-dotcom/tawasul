/* Simple unit checks without Jest (no extra deps). */
const assert = require('node:assert/strict');

const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime']
};

function assertAllowedMime(mediaType, mimeType) {
  const allowed = ALLOWED[mediaType];
  if (!allowed || !allowed.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported mime type ${mimeType} for mediaType ${mediaType}`);
  }
}

function buildObjectKey(input) {
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  const purpose = (input.purpose ?? 'general').replace(/[^a-zA-Z0-9_-]/g, '');
  return `u/${input.uploaderId}/${purpose}/${input.mediaId}/${safeName}`;
}

assert.doesNotThrow(() => assertAllowedMime('image', 'image/jpeg'));
assert.throws(() => assertAllowedMime('image', 'application/x-msdownload'));
const key = buildObjectKey({
  uploaderId: 'user1',
  mediaId: 'media1',
  fileName: '../../etc/passwd.jpg',
  purpose: 'post'
});
assert.equal(key, 'u/user1/post/media1/.._.._etc_passwd.jpg');
assert.ok(key.startsWith('u/user1/post/media1/'));
console.log('media unit checks: PASS');
