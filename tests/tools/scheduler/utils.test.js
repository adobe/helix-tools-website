import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateNonce } from '../../../tools/scheduler/utils.js';

describe('scheduler:utils.js', () => {
  describe('generateNonce', () => {
    it('returns a UUID v4 shaped string', () => {
      const n = generateNonce();
      assert.match(n, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns different values on successive calls', () => {
      assert.notEqual(generateNonce(), generateNonce());
    });
  });
});
