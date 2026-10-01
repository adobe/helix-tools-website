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

  it('allows switching copied publish roles to author without changing the first user', () => {
    const publisher = createRolesField(['publish']);
    const selectedRoles = [...publisher.querySelectorAll('input:checked')].map((input) => input.value);
    const author = createRolesField(selectedRoles);
    document.body.append(publisher, author);
    assert.equal(checkbox(author, 'publish').checked, true);
    assert.equal(checkbox(author, 'author').closest('.role-pill').classList.contains('is-covered'), true);
    checkbox(author, 'author').click();

    assert.equal(checkbox(publisher, 'publish').checked, true);
    assert.equal(checkbox(publisher, 'author').closest('.role-pill').classList.contains('is-covered'), true);
    assert.equal(checkbox(publisher, 'author').disabled, false);
    assert.equal(checkbox(author, 'author').checked, true);
    assert.equal(checkbox(author, 'author').disabled, false);
    assert.equal(checkbox(author, 'publish').checked, false);
  });

  it('removes the covered styling when publish is deselected', () => {
    const field = createRolesField(['publish']);
    document.body.append(field);
    checkbox(field, 'publish').click();
    assert.equal(checkbox(field, 'author').closest('.role-pill').classList.contains('is-covered'), false);
    assert.equal(checkbox(field, 'author').disabled, false);
    checkbox(field, 'author').click();
    assert.equal(checkbox(field, 'author').checked, true);
  });

  it('keeps covered roles greyed out but enabled', () => {
    const field = createRolesField(['admin']);
    assert.equal(field.querySelectorAll('.is-covered').length, 5);
    assert.equal(field.querySelectorAll('input:disabled').length, 0);
    assert.equal(field.querySelectorAll('input:checked').length, 1);
  });

  it('preserves independent roles when a covered role is selected', () => {
    const field = createRolesField(['publish', 'config']);
    document.body.append(field);
    checkbox(field, 'author').click();
    assert.equal(checkbox(field, 'publish').checked, false);
    assert.equal(checkbox(field, 'author').checked, true);
    assert.equal(checkbox(field, 'config').checked, true);
  });

  it('replaces every selected role that covers the newly selected role', () => {
    const field = createRolesField(['publish', 'develop']);
    document.body.append(field);
    checkbox(field, 'author').click();
    assert.deepEqual(
      [...field.querySelectorAll('input:checked')].map((input) => input.value),
      ['author'],
    );
  });

  it('replaces a less privileged role when a covering role is selected', () => {
    const field = createRolesField(['author']);
    document.body.append(field);
    checkbox(field, 'publish').click();
    assert.equal(checkbox(field, 'publish').checked, true);
    assert.equal(checkbox(field, 'author').checked, false);
    assert.equal(checkbox(field, 'author').closest('.role-pill').classList.contains('is-covered'), true);
  });

  it('normalizes redundant initial roles without disabling alternatives', () => {
    const field = createRolesField(['admin', 'publish', 'author']);
    assert.deepEqual(
      [...field.querySelectorAll('input:checked')].map((input) => input.value),
      ['admin'],
    );
    assert.equal(field.querySelectorAll('input:disabled').length, 0);
  });
});
