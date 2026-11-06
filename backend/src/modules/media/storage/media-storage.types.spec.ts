import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertAllowedMime, buildObjectKey } from './media-storage.types';

describe('media storage helpers', () => {
  it('allows jpeg images', () => {
    assert.doesNotThrow(() => assertAllowedMime('image', 'image/jpeg'));
  });

  it('rejects unsupported mime', () => {
    assert.throws(() => assertAllowedMime('image', 'application/x-msdownload'), /Unsupported mime/);
  });

  it('builds non-traversable object keys owned by server', () => {
    const key = buildObjectKey({
      uploaderId: 'user1',
      mediaId: 'media1',
      fileName: '../../etc/passwd.jpg',
      purpose: 'post'
    });
    assert.equal(key, 'u/user1/post/media1/.._.._etc_passwd.jpg');
    assert.equal(key.includes('..'), true);
    assert.equal(key.startsWith('u/user1/post/media1/'), true);
  });
});
