import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCoveredRoles } from '../../utils/roles/roles.js';

describe('utils:roles.js', () => {
  describe('getCoveredRoles', () => {
    it('returns an empty set for no selection', () => {
      assert.equal(getCoveredRoles([]).size, 0);
      assert.equal(getCoveredRoles(undefined).size, 0);
    });

    it('returns an empty set for a base role', () => {
      assert.equal(getCoveredRoles(['author']).size, 0);
      assert.equal(getCoveredRoles(['config']).size, 0);
    });

    it('marks author as covered when publish is selected', () => {
      const covered = getCoveredRoles(['publish']);
      assert.ok(covered.has('author'));
      assert.ok(!covered.has('publish'));
    });

    it('marks publish, author and config as covered when config_admin is selected', () => {
      const covered = getCoveredRoles(['config_admin']);
      assert.ok(covered.has('publish'));
      assert.ok(covered.has('author'));
      assert.ok(covered.has('config'));
      assert.ok(!covered.has('config_admin'));
    });

    it('marks all other roles as covered when admin is selected', () => {
      const covered = getCoveredRoles(['admin']);
      ['author', 'publish', 'develop', 'config', 'config_admin'].forEach((role) => {
        assert.ok(covered.has(role), `${role} should be covered`);
      });
      assert.ok(!covered.has('admin'));
    });

    it('unions coverage across multiple selected roles', () => {
      const covered = getCoveredRoles(['develop', 'publish']);
      assert.ok(covered.has('author'));
    });

    it('ignores unknown roles', () => {
      assert.equal(getCoveredRoles(['does-not-exist']).size, 0);
    });
  });
});
