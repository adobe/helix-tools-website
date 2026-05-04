import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath, classifySequenceStatus } from '../../../tools/page-status/utils.js';

describe('validatePath', () => {
  it('returns /* for falsy input', () => {
    assert.equal(validatePath(''), '/*');
    assert.equal(validatePath(null), '/*');
    assert.equal(validatePath(undefined), '/*');
  });

  it('appends /* to a bare path', () => {
    assert.equal(validatePath('/blog'), '/blog/*');
  });

  it('normalises a path that already ends with /', () => {
    assert.equal(validatePath('/blog/'), '/blog/*');
  });

  it('returns /* for a full URL with protocol (splits on :// keeping protocol)', () => {
    // split('://') yields ['https', 'host/path']; [str] = [...] takes first element
    // 'https' has no '/' so falls through to the root wildcard
    assert.equal(validatePath('https://example.com/foo/bar'), '/*');
  });

  it('extracts path from a URL without protocol', () => {
    assert.equal(validatePath('example.com/foo/bar'), '/foo/bar/*');
  });

  it('handles a path with multiple segments', () => {
    assert.equal(validatePath('/a/b/c'), '/a/b/c/*');
  });
});

describe('classifySequenceStatus', () => {
  const OLD = '2024-01-01T00:00:00Z';
  const MID = '2024-06-01T00:00:00Z';
  const NEW = '2024-12-01T00:00:00Z';

  it('returns No source / negative when edit date is invalid', () => {
    const { label, modifier } = classifySequenceStatus('not-a-date', MID, NEW);
    assert.equal(label, 'No source');
    assert.equal(modifier, 'negative');
  });

  it('returns Not previewed / positive when only edit date is valid', () => {
    const { label, modifier } = classifySequenceStatus(OLD, '', '');
    assert.equal(label, 'Not previewed');
    assert.equal(modifier, 'positive');
  });

  it('returns Not published / positive when edit ≤ preview and no publish', () => {
    const { label, modifier } = classifySequenceStatus(OLD, MID, '');
    assert.equal(label, 'Not published');
    assert.equal(modifier, 'positive');
  });

  it('returns Current / positive when edit ≤ preview ≤ publish', () => {
    const { label, modifier } = classifySequenceStatus(OLD, MID, NEW);
    assert.equal(label, 'Current');
    assert.equal(modifier, 'positive');
  });

  it('returns Pending changes / positive when edit is newer than publish', () => {
    const { label, modifier } = classifySequenceStatus(NEW, MID, OLD);
    assert.equal(label, 'Pending changes');
    assert.equal(modifier, 'positive');
  });

  it('returns Pending changes / positive when preview is newer than publish', () => {
    const { label, modifier } = classifySequenceStatus(OLD, NEW, MID);
    assert.equal(label, 'Pending changes');
    assert.equal(modifier, 'positive');
  });
});
