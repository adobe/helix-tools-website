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
    }, 'https://portal.example.com/?imsOrgId=ignored%40AdobeOrg');
    assert.equal(config.branding.title, '<Customer>');
    assert.equal(config.imsOrgId, 'customer-one@AdobeOrg');
    assert.deepEqual(config.uploadHostSuffixes, ['.adobeaemcloud.com']);
  });

  it('uses the organization-specific login URL when no fork default is configured', () => {
    const config = validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: '',
    }, 'https://portal.example.com/index.html?imsOrgId=customer%2Fone%40AdobeOrg');
    assert.equal(config.imsOrgId, 'customer/one@AdobeOrg');
  });

  it('fails closed without a configured or URL organization ID', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
    }, 'https://portal.example.com/index.html'), /organization-specific login URL/);
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      imsOrgId: '   ',
    }, 'https://portal.example.com/index.html?imsOrgId='), /organization-specific login URL/);
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
