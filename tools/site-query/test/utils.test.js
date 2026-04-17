import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getErrorCode, getErrorMessage } from '../utils.js';

describe('site-query:utils.js', () => {
  describe('getErrorCode', () => {
    it('returns 401 when err.status is 401', () => {
      const err = Object.assign(new Error('some error'), { status: 401 });
      assert.equal(getErrorCode(err), 401);
    });

    it('returns 401 when message starts with "Unauthorized"', () => {
      const err = new Error('Unauthorized: missing token');
      assert.equal(getErrorCode(err), 401);
    });

    it('prefers status 401 over message prefix for Unauthorized check', () => {
      // status wins regardless of message content
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      assert.equal(getErrorCode(err), 401);
    });

    it('returns 499 when message starts with "Failed on initial fetch"', () => {
      const err = new Error('Failed on initial fetch of sitemap.');
      assert.equal(getErrorCode(err), 499);
    });

    it('returns 499 for the index variant of the initial-fetch message', () => {
      const err = new Error('Failed on initial fetch of index.');
      assert.equal(getErrorCode(err), 499);
    });

    it('returns 404 when message starts with "Not found"', () => {
      const err = new Error('Not found: /sitemap.xml');
      assert.equal(getErrorCode(err), 404);
    });

    it('returns 500 for any other error', () => {
      assert.equal(getErrorCode(new Error('Network error')), 500);
      assert.equal(getErrorCode(new Error('Unexpected token')), 500);
      assert.equal(getErrorCode(new Error('')), 500);
    });

    it('does not match 401 for a message that merely contains "Unauthorized" mid-string', () => {
      const err = new Error('Access Unauthorized: denied');
      assert.equal(getErrorCode(err), 500);
    });

    it('does not match 499 for a message that merely contains the phrase mid-string', () => {
      const err = new Error('Request failed on initial fetch attempt was fine');
      // does not start with "Failed on initial fetch"
      assert.equal(getErrorCode(err), 500);
    });
  });

  describe('getErrorMessage', () => {
    it('returns a 401 title for errCode 401', () => {
      const { title } = getErrorMessage(401, 'myorg', 'mysite');
      assert.equal(title, '401 Unauthorized Error');
    });

    it('includes sign-in link with correct org and site in 401 message', () => {
      const { msg } = getErrorMessage(401, 'myorg', 'mysite');
      assert.ok(msg.includes('https://main--mysite--myorg.aem.page'), `expected AEM page URL in msg: ${msg}`);
      assert.ok(msg.includes('mysite'), `expected site name in msg: ${msg}`);
    });

    it('returns a 404 title for errCode 404', () => {
      const { title } = getErrorMessage(404, 'org', 'site');
      assert.equal(title, '404 Not Found Error');
    });

    it('returns sitemap/index guidance in 404 message', () => {
      const { msg } = getErrorMessage(404, 'org', 'site');
      assert.ok(msg.includes('sitemap'), `expected sitemap mention: ${msg}`);
    });

    it('returns a CORS-related title for errCode 499', () => {
      const { title } = getErrorMessage(499, 'org', 'site');
      assert.equal(title, 'Initial Fetch Failed');
    });

    it('mentions CORS in the 499 message', () => {
      const { msg } = getErrorMessage(499, 'org', 'site');
      assert.ok(msg.includes('CORS'), `expected CORS mention: ${msg}`);
    });

    it('returns a generic title for an unrecognised error code', () => {
      const { title } = getErrorMessage(500, 'org', 'site');
      assert.equal(title, 'Error');
    });

    it('returns a generic message for an unrecognised error code', () => {
      const { msg } = getErrorMessage(500, 'org', 'site');
      assert.ok(msg.includes('console'), `expected console mention: ${msg}`);
    });

    it('interpolates org and site correctly when both contain hyphens', () => {
      const { msg } = getErrorMessage(401, 'my-org', 'my-site');
      assert.ok(msg.includes('https://main--my-site--my-org.aem.page'), `expected URL with hyphens: ${msg}`);
    });
  });
});
