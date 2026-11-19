import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import createMockAemApi from './mock-aem-api.js';

describe('helpers:mock-aem-api.js', () => {
  const api = createMockAemApi();

  afterEach(() => {
    api.uninstall();
    api.reset();
  });

  it('records a violation for a request outside the H6 origin, even if the caller swallows the error', async () => {
    api.install();
    await fetch('https://admin.hlx.page/config/myorg/users.json').catch(() => {});

    assert.equal(api.violations.length, 1);
    assert.equal(api.violations[0].url, 'https://admin.hlx.page/config/myorg/users.json');
    assert.match(api.violations[0].reason, /non-H6 origin/);
  });
});
