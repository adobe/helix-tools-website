import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFilesFromFileList,
  normalizeClientPath,
} from '../../../tools/asset-sourcing-portal/files.js';

describe('file collection', () => {
  it('normalizes browser file paths and rejects traversal', () => {
    assert.equal(normalizeClientPath('folder\\image.jpg'), '/folder/image.jpg');
    assert.throws(() => normalizeClientPath('folder/../image.jpg'), /must not/);
  });

  it('preserves relative paths from folder selection', () => {
    const file = new window.File(['bytes'], 'image.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'campaign/image.jpg' });
    const items = collectFilesFromFileList([file]);
    assert.equal(items[0].relativePath, '/campaign/image.jpg');
    assert.equal(items[0].file, file);
  });
});
