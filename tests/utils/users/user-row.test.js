import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createUserRow, collectUsers, userRowErrors } from '../../../utils/users/user-row.js';

const GROUP = '0123456789ABCDEF01234567/authors';

const listOf = (...users) => {
  const list = document.createElement('div');
  list.append(...users.map((u) => createUserRow(u)));
  return list;
};

const messages = (list, options) => userRowErrors(list, options).map((e) => e.message);

describe('utils/users/user-row.js', () => {
  describe('createUserRow', () => {
    it('toggles the IMS group hint and aria-describedby with the input value', () => {
      const row = createUserRow({ email: 'a@b.com' });
      const input = row.querySelector('.user-row-email');
      const hint = row.querySelector('.user-row-hint');
      assert.equal(hint.hidden, true);
      assert.equal(input.hasAttribute('aria-describedby'), false);
      input.value = GROUP;
      input.dispatchEvent(new window.Event('input'));
      assert.equal(hint.hidden, false);
      assert.equal(input.getAttribute('aria-describedby'), hint.id);
    });

    it('calls onChange on input and after removal', () => {
      let calls = 0;
      const list = document.createElement('div');
      const row = createUserRow({}, { onChange: () => { calls += 1; } });
      list.append(row);
      row.querySelector('.user-row-email').dispatchEvent(new window.Event('input'));
      row.querySelector('.user-row-remove').click();
      assert.equal(calls, 2);
      assert.equal(list.children.length, 0);
    });
  });

  describe('collectUsers', () => {
    it('skips blank rows, normalizes users and keeps ids', () => {
      const list = listOf(
        { email: 'a@b.com', id: '1', roles: ['admin'] },
        { roles: ['admin'] },
        { email: ' 0123456789ABCDEF01234567@AdobeOrg/authors ', roles: ['author'] },
      );
      assert.deepEqual(collectUsers(list), [
        { email: 'a@b.com', id: '1', roles: ['admin'] },
        { email: GROUP, roles: ['author'] },
      ]);
    });
  });

  describe('userRowErrors', () => {
    it('accepts valid emails, wildcard domains and IMS groups', () => {
      const list = listOf(
        { email: 'a@b.com', roles: ['admin'] },
        { email: '*@adobe.com', roles: ['author'] },
        { email: GROUP, roles: ['author'] },
      );
      assert.deepEqual(messages(list), []);
    });

    it('ignores blank new rows but not cleared existing users', () => {
      const list = listOf({ roles: ['admin'] }, { email: 'a@b.com', roles: ['admin'] });
      assert.deepEqual(messages(list), []);
      const [, existing] = list.children;
      existing.querySelector('.user-row-email').value = '  ';
      assert.deepEqual(userRowErrors(list), [{
        row: existing,
        input: existing.querySelector('.user-row-email'),
        message: 'Enter an email or IMS group for each user, or remove the empty user.',
      }]);
    });

    it('rejects malformed users', () => {
      ['not-an-email', '/authors', '528D65B156D673FA7F000101/', 'not-an-org/authors'].forEach((email) => {
        assert.deepEqual(
          messages(listOf({ email, roles: ['admin'] })),
          ['Enter a valid email or IMS group for each user.'],
          email,
        );
      });
    });

    it('does not bypass other input constraints', () => {
      const list = listOf({ email: GROUP, roles: ['admin'] });
      list.querySelector('.user-row-email').setCustomValidity('Invalid user');
      assert.deepEqual(messages(list), ['Enter a valid email or IMS group for each user.']);
    });

    it('requires at least one role', () => {
      assert.deepEqual(
        messages(listOf({ email: 'a@b.com', roles: [] })),
        ['Select at least one role for each user.'],
      );
    });

    it('rejects duplicates after normalization, case-insensitively', () => {
      const list = listOf(
        { email: GROUP, roles: ['admin'] },
        { email: '0123456789abcdef01234567@AdobeOrg/AUTHORS', roles: ['admin'] },
      );
      assert.deepEqual(messages(list), ['Duplicate user: 0123456789abcdef01234567/AUTHORS']);
    });

    it('rejects users that already exist', () => {
      const list = listOf({ email: 'A@b.com', roles: ['admin'] });
      assert.deepEqual(
        messages(list, { existing: [{ email: 'a@B.com' }] }),
        ['User already exists: A@b.com'],
      );
    });

    it('returns all errors in row order', () => {
      const list = listOf(
        { email: 'bad', roles: ['admin'] },
        { email: 'a@b.com', roles: [] },
      );
      assert.deepEqual(messages(list), [
        'Enter a valid email or IMS group for each user.',
        'Select at least one role for each user.',
      ]);
    });
  });
});
