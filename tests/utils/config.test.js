import {
  describe, it, beforeEach, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import { getProjectFromUrl } from '../../utils/config/config.js';

describe('utils/config/config.js · getProjectFromUrl', () => {
  let originalHref;
  beforeEach(() => { originalHref = window.location.href; });
  afterEach(() => { window.history.replaceState({}, '', originalHref); });

  it('returns org and site from current URL params', () => {
    window.history.replaceState({}, '', '/?org=acme&site=blog');
    assert.deepEqual(getProjectFromUrl(), { org: 'acme', site: 'blog' });
  });

  it('returns empty strings when both params are missing', () => {
    window.history.replaceState({}, '', '/');
    assert.deepEqual(getProjectFromUrl(), { org: '', site: '' });
  });

  it('handles one param missing', () => {
    window.history.replaceState({}, '', '/?org=acme');
    assert.deepEqual(getProjectFromUrl(), { org: 'acme', site: '' });
  });

  it('preserves other params (read-only)', () => {
    window.history.replaceState({}, '', '/?org=acme&site=blog&path=/foo');
    assert.deepEqual(getProjectFromUrl(), { org: 'acme', site: 'blog' });
    assert.equal(new URL(window.location.href).searchParams.get('path'), '/foo');
  });
});
