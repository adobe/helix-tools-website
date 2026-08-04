import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForcePasswordRotationRequiredError,
  PortalApi,
  PortalApiError,
  SessionExpiredError,
} from '../../../tools/asset-sourcing-portal/api.js';

const config = {
  apiBaseUrl: 'https://api.example.com',
  org: 'customer/one',
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
        username: 'vendor-user',
        vendor: { vendorId: 'vendor-one', name: 'Vendor One' },
        metadataSchema: { editable: [], required: [], prepopulated: {} },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await api.createSession(' Vendor.User ', ' secret password ');
    assert.equal(
      request.url,
      'https://api.example.com/api/upload/v1/session?org=customer%2Fone',
    );
    assert.match(request.options.headers.Authorization, /^Basic /);
    assert.equal(
      atob(request.options.headers.Authorization.replace('Basic ', '')),
      'vendor.user: secret password ',
    );
    assert.equal(api.getSessionToken(), 'memory-only-token');
    assert.equal(window.sessionStorage.getItem('asp_auth'), null);
    assert.equal(window.localStorage.getItem('asp_auth'), null);
  });

  it('surfaces forced password rotation without creating a session', async () => {
    const api = new PortalApi(config, async () => new Response(JSON.stringify({
      code: 'FORCE_PASSWORD_ROTATION_REQUIRED',
      error: 'Rotate now',
    }), { status: 401 }));
    await assert.rejects(
      () => api.createSession('account', 'old-key'),
      ForcePasswordRotationRequiredError,
    );
    assert.equal(api.getSessionToken(), '');
  });

  it('uses the configured organization for public branding and password rotation', async () => {
    const requests = [];
    const api = new PortalApi(config, async (url) => {
      requests.push(url);
      if (url.includes('/portal-branding/login?')) {
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({
        password: 'replacement-password',
        passwordId: 'password-two',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await api.getLoginBranding();
    await api.rotatePassword('shared-user', 'current-password');
    assert.deepEqual(requests, [
      'https://api.example.com/api/upload/v1/portal-branding/login?org=customer%2Fone',
      'https://api.example.com/api/upload/v1/account/rotate-password?org=customer%2Fone',
    ]);
  });

  it('preserves structured backend error codes and parameters', async () => {
    const api = new PortalApi(config, async () => new Response(JSON.stringify({
      code: 'FILE_TOO_LARGE',
      error: 'Raw backend text must not be displayed',
      params: { maxFileBytes: 42 },
    }), { status: 413 }));
    api.setSession({ sessionToken: 'token', expiresAt: Date.now() + 10000 });
    await assert.rejects(
      () => api.startBatch({}),
      (error) => error instanceof PortalApiError
        && error.code === 'FILE_TOO_LARGE'
        && error.params.maxFileBytes === 42,
    );
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

  it('includes org on authenticated session requests', async () => {
    let requestUrl;
    const api = new PortalApi(config, async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ status: 'done' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    api.setSession({ sessionToken: 'token', expiresAt: Date.now() + 10000 });
    await api.getBatchVerification('batch/one');
    assert.equal(
      requestUrl,
      'https://api.example.com/api/upload/v1/batches/batch%2Fone/verification?org=customer%2Fone',
    );
  });

  it('allows only configured HTTPS direct-upload destinations', () => {
    const api = new PortalApi(config, unusedFetch);
    assert.equal(
      api.validateUploadUri('https://author.example.adobeaemcloud.com/upload'),
      'https://author.example.adobeaemcloud.com/upload',
    );
    assert.throws(
      () => api.validateUploadUri('https://evil.example/upload'),
      (error) => error instanceof PortalApiError && error.code === 'UPLOAD_FAILED',
    );
    assert.throws(
      () => api.validateUploadUri('http://author.example.adobeaemcloud.com/upload'),
      (error) => error instanceof PortalApiError && error.code === 'UPLOAD_FAILED',
    );
  });

  it('allows loopback HTTP uploads only on the configured local API origin', () => {
    const api = new PortalApi({
      apiBaseUrl: 'http://localhost:3000',
      org: 'customer',
      uploadHostSuffixes: ['.adobeaemcloud.com'],
    }, unusedFetch);
    assert.equal(
      api.validateUploadUri('http://localhost:3000/mock-upload'),
      'http://localhost:3000/mock-upload',
    );
    assert.throws(
      () => api.validateUploadUri('http://localhost:3001/mock-upload'),
      (error) => error instanceof PortalApiError && error.code === 'UPLOAD_FAILED',
    );
  });
});
