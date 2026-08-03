import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateApiBaseUrl,
  validatePortalConfig,
} from '../../../tools/asset-sourcing-portal/config.js';

describe('portal configuration', () => {
  it('accepts HTTPS and loopback development API URLs', () => {
    assert.equal(validateApiBaseUrl('https://api.example.com/'), 'https://api.example.com');
    assert.equal(validateApiBaseUrl('http://localhost:8787/'), 'http://localhost:8787');
  });

  it('rejects insecure remote API URLs and URL credentials', () => {
    assert.throws(() => validateApiBaseUrl('http://api.example.com'), /HTTPS/);
    assert.throws(() => validateApiBaseUrl('https://user:pass@api.example.com'), /credentials/);
  });

  it('validates customer-controlled public fields', () => {
    const config = validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: 'customer-one@AdobeOrg',
      tenantSlug: 'customer-one',
      uploadHostSuffixes: ['.adobeaemcloud.com'],
      branding: { title: '<Customer>', logoSrc: '/icons/adobe.svg' },
    });
    assert.equal(config.branding.title, '<Customer>');
    assert.equal(config.imsOrgId, 'customer-one@AdobeOrg');
    assert.deepEqual(config.uploadHostSuffixes, ['.adobeaemcloud.com']);
  });

  it('fails closed without a customer IMS organization ID', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
    }), /must define imsOrgId for this customer deployment/);
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: '   ',
    }), /must define imsOrgId for this customer deployment/);
  });

  it('rejects cross-origin logos and malformed upload suffixes', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: 'customer@AdobeOrg',
      branding: { logoSrc: 'https://evil.example/logo.svg' },
    }), /same-origin/);
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: 'customer@AdobeOrg',
      uploadHostSuffixes: ['*'],
    }), /DNS suffix/);
  });
});
