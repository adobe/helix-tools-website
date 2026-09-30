import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCoveredRoles } from '../../utils/roles/roles.js';
import { createRolesField } from '../../utils/roles/roles-field.js';

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

describe('utils:roles-field.js', () => {
  const checkbox = (field, role) => field.querySelector(`input[value="${role}"]`);
  afterEach(() => document.body.replaceChildren());

  it('starts a new user with no selected or disabled roles', () => {
    const field = createRolesField();
    assert.equal(field.querySelectorAll('input:checked').length, 0);
    assert.equal(field.querySelectorAll('input:disabled').length, 0);
  });

  it('allows another user to be an author when the first user has publish', () => {
    const publisher = createRolesField(['publish']);
    const author = createRolesField();
    document.body.append(publisher, author);
    checkbox(author, 'author').click();

    assert.equal(checkbox(publisher, 'publish').checked, true);
    assert.equal(checkbox(publisher, 'author').disabled, true);
    assert.equal(checkbox(author, 'author').checked, true);
    assert.equal(checkbox(author, 'author').disabled, false);
    assert.equal(checkbox(author, 'publish').checked, false);
  });

  it('re-enables author when publish is deselected for the same user', () => {
    const field = createRolesField(['publish']);
    document.body.append(field);
    checkbox(field, 'publish').click();
    assert.equal(checkbox(field, 'author').disabled, false);
    checkbox(field, 'author').click();
    assert.equal(checkbox(field, 'author').checked, true);
  });
});
