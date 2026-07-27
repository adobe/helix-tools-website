import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForceRotateRequiredError,
  PortalApi,
  SessionExpiredError,
} from '../../../tools/asset-sourcing-portal/api.js';

const config = {
  apiBaseUrl: 'https://api.example.com',
  uploadHostSuffixes: ['.adobeaemcloud.com'],
};

const unusedFetch = async () => {
  throw new Error('Unexpected request');
};

describe('portal API client', () => {
  it('mints and retains a session in memory', async () => {
    let request;
    const api = new PortalApi(config, async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        sessionToken: 'memory-only-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        metadataSchema: { editable: [], required: [], prepopulated: {} },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await api.createSession('account', 'secret-key');
    assert.equal(request.url, 'https://api.example.com/api/upload/v1/session');
    assert.match(request.options.headers.Authorization, /^Basic /);
    assert.equal(api.getSessionToken(), 'memory-only-token');
    assert.equal(window.sessionStorage.getItem('asp_auth'), null);
    assert.equal(window.localStorage.getItem('asp_auth'), null);
  });

  it('surfaces forced rotation without creating a session', async () => {
    const api = new PortalApi(config, async () => new Response(JSON.stringify({
      code: 'FORCE_ROTATE_REQUIRED',
      error: 'Rotate now',
    }), { status: 401 }));
    await assert.rejects(
      () => api.createSession('account', 'old-key'),
      ForceRotateRequiredError,
    );
    assert.equal(api.getSessionToken(), '');
  });

  it('fails closed and clears a rejected session', async () => {
    const api = new PortalApi(config, async () => new Response(
      JSON.stringify({ error: 'Expired' }),
      { status: 401 },
    ));
    api.setSession({ sessionToken: 'token', expiresAt: Date.now() + 10000 });
    await assert.rejects(
      () => api.getBatchVerification('batch/one'),
      SessionExpiredError,
    );
    assert.equal(api.getSessionToken(), '');
  });

  it('allows only configured HTTPS direct-upload destinations', () => {
    const api = new PortalApi(config, unusedFetch);
    assert.equal(
      api.validateUploadUri('https://author.example.adobeaemcloud.com/upload'),
      'https://author.example.adobeaemcloud.com/upload',
    );
    assert.throws(
      () => api.validateUploadUri('https://evil.example/upload'),
      /unapproved/,
    );
    assert.throws(
      () => api.validateUploadUri('http://author.example.adobeaemcloud.com/upload'),
      /unapproved/,
    );
  });

  it('allows loopback HTTP uploads only on the configured local API origin', () => {
    const api = new PortalApi({
      apiBaseUrl: 'http://localhost:3000',
      uploadHostSuffixes: ['.adobeaemcloud.com'],
    }, unusedFetch);
    assert.equal(
      api.validateUploadUri('http://localhost:3000/mock-upload'),
      'http://localhost:3000/mock-upload',
    );
    assert.throws(
      () => api.validateUploadUri('http://localhost:3001/mock-upload'),
      /unapproved/,
    );
  });
});
