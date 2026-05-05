import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody, getErrorMessage } from '../../../tools/cdn-setup/utils.js';

describe('parseBody', () => {
  it('returns null for null', () => assert.equal(parseBody(null), null));
  it('returns null for undefined', () => assert.equal(parseBody(undefined), null));
  it('returns null for empty string', () => assert.equal(parseBody(''), null));
  it('returns null for non-string primitives', () => assert.equal(parseBody(42), null));
  it('passes objects through unchanged', () => {
    const obj = { key: 'value' };
    assert.equal(parseBody(obj), obj);
  });
  it('parses valid JSON strings', () => {
    assert.deepEqual(parseBody('{"key":"value"}'), { key: 'value' });
  });
  it('wraps unparseable strings in rawMessage', () => {
    assert.deepEqual(parseBody('not json'), { rawMessage: 'not json' });
  });
  it('wraps truncated JSON in rawMessage', () => {
    assert.deepEqual(parseBody('{"broken"'), { rawMessage: '{"broken"' });
  });
});

describe('getErrorMessage', () => {
  it('returns success message for ok status', () => {
    assert.equal(getErrorMessage({ status: 'ok' }), 'Validation successful');
  });

  it('returns success message for succeeded status', () => {
    assert.equal(getErrorMessage({ status: 'succeeded' }), 'Validation successful');
  });

  it('returns body string for unsupported status with string body', () => {
    assert.equal(getErrorMessage({ status: 'unsupported', body: 'custom message' }), 'custom message');
  });

  it('returns generic unsupported message when body is not a string', () => {
    assert.equal(
      getErrorMessage({ status: 'unsupported', body: { something: 'else' } }),
      'This operation is not supported',
    );
  });

  it('returns error message for known HTTP status codes', () => {
    assert.equal(
      getErrorMessage({ statusCode: 401 }),
      'Authentication failed. Please verify your credentials.',
    );
    assert.equal(
      getErrorMessage({ statusCode: 403 }),
      'Access denied. Your credentials may not have the required permissions.',
    );
    assert.equal(
      getErrorMessage({ statusCode: 500 }),
      'CDN server error. Please try again later.',
    );
  });

  it('returns error message for known error codes in body', () => {
    assert.equal(
      getErrorMessage({ body: { code: 'ENOTFOUND' } }),
      'Could not connect to CDN endpoint. Please verify the hostname is correct.',
    );
    assert.equal(
      getErrorMessage({ body: { code: 'ECONNREFUSED' } }),
      'Connection refused by CDN server. Please check your endpoint configuration.',
    );
  });

  it('surfaces msg field from body', () => {
    assert.equal(
      getErrorMessage({ body: { msg: 'custom msg' } }),
      'Validation failed: custom msg',
    );
  });

  it('surfaces first error message from errors array', () => {
    assert.equal(
      getErrorMessage({ body: { errors: [{ message: 'first error' }, { message: 'second' }] } }),
      'Validation failed: first error',
    );
  });

  it('ignores empty errors array', () => {
    assert.equal(
      getErrorMessage({ body: { errors: [], message: 'fallback' } }),
      'Validation failed: fallback',
    );
  });

  it('surfaces message field from body', () => {
    assert.equal(
      getErrorMessage({ body: { message: 'body message' } }),
      'Validation failed: body message',
    );
  });

  it('surfaces error field from body', () => {
    assert.equal(
      getErrorMessage({ body: { error: 'body error' } }),
      'Validation failed: body error',
    );
  });

  it('parses JSON string body', () => {
    assert.equal(
      getErrorMessage({ body: '{"msg":"parsed"}' }),
      'Validation failed: parsed',
    );
  });

  it('returns generic fallback when no recognisable fields', () => {
    assert.equal(
      getErrorMessage({ body: { unrecognised: true } }),
      'Validation failed. Check details for more information.',
    );
  });

  it('returns generic fallback for empty result', () => {
    assert.equal(getErrorMessage({}), 'Validation failed');
  });
});
