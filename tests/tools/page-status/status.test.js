import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import classifySequenceStatus from '../../../tools/page-status/status.js';

const EDIT = '2024-01-01T00:00:00.000Z';
const PREVIEW = '2024-01-02T00:00:00.000Z';
const PUBLISH = '2024-01-03T00:00:00.000Z';

describe('classifySequenceStatus — with source date', () => {
  it('returns Not previewed when only edit exists', () => {
    const { label, positive } = classifySequenceStatus(EDIT, undefined, undefined);
    assert.equal(label, 'Not previewed');
    assert.equal(positive, true);
  });

  it('returns Not published when edit and preview exist in sequence', () => {
    const { label, positive } = classifySequenceStatus(EDIT, PREVIEW, undefined);
    assert.equal(label, 'Not published');
    assert.equal(positive, true);
  });

  it('returns Pending changes when edit is newer than preview (unpublished edit)', () => {
    const { label, positive } = classifySequenceStatus(PUBLISH, EDIT, undefined);
    assert.equal(label, 'Pending changes');
    assert.equal(positive, true);
  });

  it('returns Current when edit → preview → publish are in sequence', () => {
    const { label, positive } = classifySequenceStatus(EDIT, PREVIEW, PUBLISH);
    assert.equal(label, 'Current');
    assert.equal(positive, true);
  });

  it('returns Pending changes when preview is newer than publish', () => {
    const { label, positive } = classifySequenceStatus(EDIT, PUBLISH, PREVIEW);
    assert.equal(label, 'Pending changes');
    assert.equal(positive, true);
  });
});

describe('classifySequenceStatus — no source (BYOM, issue #340)', () => {
  // Both undefined (absent field) and null (explicit API value) must be treated as no source.
  [undefined, null].forEach((noSource) => {
    const label = noSource === null ? 'null' : 'undefined';

    it(`returns No source (negative) when nothing exists [edit=${label}]`, () => {
      const result = classifySequenceStatus(noSource, undefined, undefined);
      assert.equal(result.label, 'No source');
      assert.equal(result.positive, false);
    });

    it(`returns Not published (positive) when only preview exists [edit=${label}]`, () => {
      const result = classifySequenceStatus(noSource, PREVIEW, undefined);
      assert.equal(result.label, 'Not published');
      assert.equal(result.positive, true);
    });

    it(`returns Current (positive) when only publish exists [edit=${label}]`, () => {
      const result = classifySequenceStatus(noSource, undefined, PUBLISH);
      assert.equal(result.label, 'Current');
      assert.equal(result.positive, true);
    });

    it(`returns Current (positive) when preview and publish are in sequence [edit=${label}]`, () => {
      const result = classifySequenceStatus(noSource, PREVIEW, PUBLISH);
      assert.equal(result.label, 'Current');
      assert.equal(result.positive, true);
    });

    it(`returns Pending changes (positive) when preview is newer than publish [edit=${label}]`, () => {
      const result = classifySequenceStatus(noSource, PUBLISH, PREVIEW);
      assert.equal(result.label, 'Pending changes');
      assert.equal(result.positive, true);
    });
  });
});
