/* eslint-env node */
import {
  describe, it, afterEach, mock,
} from 'node:test';
import assert from 'node:assert/strict';

// Mock the two admin modules before loading admin-compat so that
// getAdminClient()'s dynamic import picks up the stubs.
mock.module('../../scripts/helix-admin.js', {
  defaultExport: { clientId: 'helix-admin' },
});
mock.module('../../scripts/aem-admin.js', {
  defaultExport: { clientId: 'aem-admin' },
});

const { default: getAdminClient } = await import('../../scripts/admin-compat.js');

describe('getAdminClient()', () => {
  afterEach(() => {
    window.localStorage.removeItem('use-h6-api');
  });

  it('returns the H5 client when use-h6-api is absent', async () => {
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'helix-admin' });
  });

  it('returns the H6 client when use-h6-api is present with an empty value', async () => {
    window.localStorage.setItem('use-h6-api', '');
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });

  it('returns the H6 client regardless of the key\'s value', async () => {
    window.localStorage.setItem('use-h6-api', 'true');
    const client = await getAdminClient();
    assert.deepEqual(client, { clientId: 'aem-admin' });
  });
});
