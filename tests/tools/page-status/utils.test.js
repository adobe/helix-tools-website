import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath, classifySequenceStatus } from '../../../tools/page-status/utils.js';

describe('validatePath', () => {
  it('returns /* for empty input', () => assert.equal(validatePath(''), '/*'));
  it('returns /* for null', () => assert.equal(validatePath(null), '/*'));
  it('returns /* for undefined', () => assert.equal(validatePath(undefined), '/*'));

  it('appends /* to a bare path', () => assert.equal(validatePath('/blog'), '/blog/*'));
  it('normalises a path that already ends with /', () => assert.equal(validatePath('/blog/'), '/blog/*'));
  it('handles a multi-segment path', () => assert.equal(validatePath('/a/b/c'), '/a/b/c/*'));

  it('extracts path from a URL without protocol', () => {
    assert.equal(validatePath('example.com/foo/bar'), '/foo/bar/*');
  });

  it('returns /* for a URL with protocol (split on :// yields protocol, not path)', () => {
    // split('://') gives ['https', 'example.com/path']; destructuring takes first element
    assert.equal(validatePath('https://example.com/foo/bar'), '/*');
  });
});

describe('classifySequenceStatus', () => {
  const OLD = '2024-01-01T00:00:00Z';
  const MID = '2024-06-01T00:00:00Z';
  const NEW = '2024-12-01T00:00:00Z';

  it('No source / negative when edit is invalid', () => {
    const r = classifySequenceStatus('not-a-date', MID, NEW);
    assert.equal(r.label, 'No source');
    assert.equal(r.modifier, 'negative');
  });

  it('Not previewed / positive when only edit date is valid', () => {
    const r = classifySequenceStatus(OLD, '', '');
    assert.equal(r.label, 'Not previewed');
    assert.equal(r.modifier, 'positive');
  });

  it('Not published / positive when edit ≤ preview, no publish', () => {
    const r = classifySequenceStatus(OLD, MID, '');
    assert.equal(r.label, 'Not published');
    assert.equal(r.modifier, 'positive');
  });

  it('Current / positive when edit ≤ preview ≤ publish', () => {
    const r = classifySequenceStatus(OLD, MID, NEW);
    assert.equal(r.label, 'Current');
    assert.equal(r.modifier, 'positive');
  });

  it('Pending changes / positive when preview > publish', () => {
    const r = classifySequenceStatus(OLD, NEW, MID);
    assert.equal(r.label, 'Pending changes');
    assert.equal(r.modifier, 'positive');
  });

  it('Pending changes / positive when edit > publish', () => {
    const r = classifySequenceStatus(NEW, MID, OLD);
    assert.equal(r.label, 'Pending changes');
    assert.equal(r.modifier, 'positive');
  });
});
