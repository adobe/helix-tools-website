import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidRelativePath,
  checkFileExtension,
  flattenPathCollisions,
  resolveUploadRelativePath,
  validateImageDimensions,
} from '../../../tools/asset-sourcing-portal/policies.js';

describe('upload policies', () => {
  it('rejects traversal and paths without a leading slash', () => {
    assert.throws(() => assertValidRelativePath('../secret.jpg'), /start with/);
    assert.throws(() => assertValidRelativePath('/campaign/../secret.jpg'), /must not/);
  });

  it('resolves preserve, flatten, and fixed paths', () => {
    assert.equal(resolveUploadRelativePath(
      { mode: 'preserve', vendorPath: { enabled: true } },
      '/folder/image.jpg',
      '/campaign',
    ), 'campaign/folder/image.jpg');
    assert.equal(
      resolveUploadRelativePath({ mode: 'flatten' }, '/folder/image.jpg'),
      'image.jpg',
    );
    assert.equal(resolveUploadRelativePath(
      { mode: 'fixed', subPath: 'approved' },
      '/folder/image.jpg',
    ), 'approved/folder/image.jpg');
  });

  it('detects flattening collisions', () => {
    assert.match(flattenPathCollisions(
      { mode: 'flatten' },
      ['/one/image.jpg', '/two/image.jpg'],
    ), /Multiple files/);
  });

  it('applies extension allow and deny policies', () => {
    assert.match(checkFileExtension({ allow: ['jpg'] }, '/image.png'), /not allowed/);
    assert.match(checkFileExtension({ deny: ['exe'] }, '/image.exe'), /not allowed/);
    assert.equal(checkFileExtension({ allow: ['jpg'] }, '/image.JPG'), undefined);
  });

  it('rejects undersized images and ignores non-images', () => {
    assert.throws(() => validateImageDimensions(
      { minDimensionPx: 1000 },
      'image/jpeg',
      1200,
      900,
    ), /shortest side/);
    assert.doesNotThrow(() => validateImageDimensions(
      { minDimensionPx: 1000 },
      'application/pdf',
      undefined,
      undefined,
    ));
  });
});
