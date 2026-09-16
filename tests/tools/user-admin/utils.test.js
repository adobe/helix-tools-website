import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUsersFromAccessConfig, buildAccessConfig, isImsGroup, identityError,
} from '../../../tools/user-admin/utils.js';

describe('user-admin:utils.js', () => {
  describe('isImsGroup', () => {
    it('accepts an ims org id and group name', () => {
      assert.equal(isImsGroup('0123456789abcdef01234567/administrators'), true);
    });

    it('accepts any character in the group name', () => {
      assert.equal(isImsGroup('0123456789abcdef01234567/My Group (EMEA)/2'), true);
    });

    it('ignores surrounding whitespace', () => {
      assert.equal(isImsGroup('  0123456789abcdef01234567/administrators  '), true);
    });

    it('rejects emails and malformed group references', () => {
      assert.equal(isImsGroup('user@example.com'), false);
      assert.equal(isImsGroup('0123456789abcdef01234567'), false);
      assert.equal(isImsGroup('0123456789abcdef01234567/'), false);
      assert.equal(isImsGroup('/administrators'), false);
      assert.equal(isImsGroup('short/administrators'), false);
      // 24 characters, but not hex
      assert.equal(isImsGroup('zzz3456789abcdef01234567/administrators'), false);
      assert.equal(isImsGroup(''), false);
      assert.equal(isImsGroup(undefined), false);
    });
  });

  describe('identityError', () => {
    it('accepts email addresses', () => {
      assert.equal(identityError('user@example.com'), null);
      assert.equal(identityError('user@example.com', 'email'), null);
    });

    it('accepts email wildcards', () => {
      assert.equal(identityError('*@example.com', 'email'), null);
    });

    it('accepts ims groups', () => {
      assert.equal(identityError('0123456789abcdef01234567/administrators', 'group'), null);
    });

    it('reports an empty value for either type', () => {
      const expected = /enter a valid email or Adobe IMS group for each entity/i;
      assert.match(identityError('  ', 'email'), expected);
      assert.match(identityError('', 'group'), expected);
    });

    it('reports an invalid email', () => {
      assert.match(identityError('not-an-email', 'email'), /Invalid email/);
      assert.match(identityError('user@example', 'email'), /Invalid email/);
    });

    it('reports an invalid ims group', () => {
      assert.match(identityError('administrators', 'group'), /Invalid Adobe IMS group/);
      assert.match(identityError('short/administrators', 'group'), /Invalid Adobe IMS group/);
    });

    it('does not accept a group in the email field, or vice versa', () => {
      assert.match(identityError('0123456789abcdef01234567/administrators', 'email'), /Invalid email/);
      assert.match(identityError('user@example.com', 'group'), /Invalid Adobe IMS group/);
    });
  });

  describe('parseUsersFromAccessConfig', () => {
    it('returns [] for null config', () => {
      assert.deepEqual(parseUsersFromAccessConfig(null), []);
    });

    it('returns [] for empty config', () => {
      assert.deepEqual(parseUsersFromAccessConfig({}), []);
    });

    it('returns [] when role map is empty', () => {
      assert.deepEqual(parseUsersFromAccessConfig({ admin: { role: {} } }), []);
    });

    it('returns a single user with one role', () => {
      const config = { admin: { role: { author: ['a@b.com'] } } };
      assert.deepEqual(parseUsersFromAccessConfig(config), [{ email: 'a@b.com', roles: ['author'] }]);
    });

    it('returns multiple users from a single role', () => {
      const config = { admin: { role: { author: ['a@b.com', 'c@d.com'] } } };
      const result = parseUsersFromAccessConfig(config);
      assert.equal(result.length, 2);
      assert.ok(result.some((u) => u.email === 'a@b.com' && u.roles[0] === 'author'));
      assert.ok(result.some((u) => u.email === 'c@d.com' && u.roles[0] === 'author'));
    });

    it('merges multiple roles for the same user into one entry', () => {
      const config = { admin: { role: { admin: ['a@b.com'], author: ['a@b.com'] } } };
      const result = parseUsersFromAccessConfig(config);
      assert.equal(result.length, 1);
      assert.equal(result[0].email, 'a@b.com');
      assert.ok(result[0].roles.includes('admin'));
      assert.ok(result[0].roles.includes('author'));
    });

    it('handles multiple users each with multiple roles', () => {
      const config = {
        admin: {
          role: {
            admin: ['a@b.com'],
            author: ['a@b.com', 'c@d.com'],
            publish: ['c@d.com'],
          },
        },
      };
      const result = parseUsersFromAccessConfig(config);
      const userA = result.find((u) => u.email === 'a@b.com');
      const userC = result.find((u) => u.email === 'c@d.com');
      assert.ok(userA.roles.includes('admin') && userA.roles.includes('author'));
      assert.ok(userC.roles.includes('author') && userC.roles.includes('publish'));
    });

    it('handles a role with a null or undefined email list gracefully', () => {
      const config = { admin: { role: { admin: null } } };
      assert.deepEqual(parseUsersFromAccessConfig(config), []);
    });
  });

  describe('buildAccessConfig', () => {
    it('returns an access config with an empty role map when users is []', () => {
      const original = { admin: { role: { author: ['a@b.com'] } } };
      const result = buildAccessConfig(original, []);
      assert.deepEqual(result.admin.role, {});
    });

    it('does not mutate the originalAccess object', () => {
      const original = { admin: { role: { author: ['a@b.com'] } } };
      const snapshot = JSON.stringify(original);
      buildAccessConfig(original, [{ email: 'x@y.com', roles: ['admin'] }]);
      assert.equal(JSON.stringify(original), snapshot);
    });

    it('builds a role map from a single user with one role', () => {
      const result = buildAccessConfig({}, [{ email: 'a@b.com', roles: ['author'] }]);
      assert.deepEqual(result.admin.role, { author: ['a@b.com'] });
    });

    it('builds a role map from a user with multiple roles', () => {
      const result = buildAccessConfig({}, [{ email: 'a@b.com', roles: ['admin', 'author'] }]);
      assert.ok(result.admin.role.admin.includes('a@b.com'));
      assert.ok(result.admin.role.author.includes('a@b.com'));
    });

    it('builds a role map from multiple users', () => {
      const users = [
        { email: 'a@b.com', roles: ['admin'] },
        { email: 'c@d.com', roles: ['author', 'publish'] },
      ];
      const result = buildAccessConfig({}, users);
      assert.deepEqual(result.admin.role.admin, ['a@b.com']);
      assert.deepEqual(result.admin.role.author, ['c@d.com']);
      assert.deepEqual(result.admin.role.publish, ['c@d.com']);
    });

    it('preserves non-admin fields from originalAccess', () => {
      const original = { version: 2, other: 'data', admin: { role: {} } };
      const result = buildAccessConfig(original, []);
      assert.equal(result.version, 2);
      assert.equal(result.other, 'data');
    });

    it('handles null originalAccess without throwing', () => {
      const result = buildAccessConfig(null, [{ email: 'a@b.com', roles: ['author'] }]);
      assert.deepEqual(result.admin.role, { author: ['a@b.com'] });
    });

    it('always sets admin.requireAuth to auto', () => {
      const result = buildAccessConfig({}, []);
      assert.equal(result.admin.requireAuth, 'auto');
    });

    it('overwrites an existing admin.requireAuth value with auto', () => {
      const original = { admin: { role: {}, requireAuth: 'true' } };
      const result = buildAccessConfig(original, []);
      assert.equal(result.admin.requireAuth, 'auto');
    });

    it('is the inverse of parseUsersFromAccessConfig', () => {
      const original = {
        admin: {
          role: {
            admin: ['a@b.com'],
            author: ['a@b.com', 'c@d.com'],
          },
        },
      };
      const users = parseUsersFromAccessConfig(original);
      const rebuilt = buildAccessConfig(original, users);
      assert.deepEqual(rebuilt.admin.role.admin, ['a@b.com']);
      assert.ok(rebuilt.admin.role.author.includes('a@b.com'));
      assert.ok(rebuilt.admin.role.author.includes('c@d.com'));
    });
  });
});
