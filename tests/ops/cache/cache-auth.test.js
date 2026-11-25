/* eslint-env node */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// cache-auth.js only needs the IMS token
mock.module('../../../utils/ims.js', {
  namedExports: { getImsToken: () => undefined },
});

const { getAuthError } = await import('../../../ops/cache/cache-auth.js');

const response = (status, xError) => new Response(null, {
  status,
  headers: xError ? { 'x-error': xError } : {},
});

describe('cache-auth.js', () => {
  describe('getAuthError', () => {
    it('maps the cache worker authorization errors to user messages', () => {
      assert.equal(
        getAuthError(response(403, 'invalid authorization')),
        'Your Adobe sign-in is missing or has expired. Please sign in with Adobe again.',
      );
      assert.equal(
        getAuthError(response(403, 'not authorized')),
        'Your Adobe account is not authorized to use this tool (ops role required).',
      );
      assert.equal(
        getAuthError(response(503, 'ims unavailable')),
        'Adobe sign-in could not be verified (IMS unavailable). Please try again later.',
      );
    });

    it('returns null for other responses', () => {
      [
        response(200),
        response(403),
        response(403, 'forbidden'),
        response(403, 'toString'),
        response(403, 'ims unavailable'),
        response(401, 'invalid authorization'),
        response(503),
        response(503, 'not authorized'),
        response(500, 'ims unavailable'),
      ].forEach((resp) => assert.equal(getAuthError(resp), null));
    });
  });
});
