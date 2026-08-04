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
      org: 'customer-one',
      tenantSlug: 'customer-one',
      locale: 'fr',
      uploadHostSuffixes: ['.adobeaemcloud.com'],
      branding: { title: '<Customer>', logoSrc: '/icons/adobe.svg' },
    }, 'https://portal.example.com/?org=ignored');
    assert.equal(config.branding.title, '<Customer>');
    assert.equal(config.org, 'customer-one');
    assert.equal(config.locale, 'fr');
    assert.deepEqual(config.uploadHostSuffixes, ['.adobeaemcloud.com']);
  });

  it('uses the organization-specific login URL when no fork default is configured', () => {
    const config = validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: '',
    }, 'https://portal.example.com/index.html?org=customer%2Fone');
    assert.equal(config.org, 'customer/one');
  });

  it('fails closed without a configured or URL organization ID', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
    }, 'https://portal.example.com/index.html'), /login URL with \?org=/);
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: '   ',
    }, 'https://portal.example.com/index.html?org='), /login URL with \?org=/);
  });

  it('rejects internal organization suffixes', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: 'customer@internal',
    }), /without a suffix/);
  });

  it('rejects unsupported configured locales', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: 'customer',
      locale: 'xx',
    }), /supported portal locale/);
  });

  it('rejects cross-origin logos and malformed upload suffixes', () => {
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: 'customer',
      branding: { logoSrc: 'https://evil.example/logo.svg' },
    }), /same-origin/);
    assert.throws(() => validatePortalConfig({
      apiBaseUrl: 'https://api.example.com',
      org: 'customer',
      uploadHostSuffixes: ['*'],
    }), /DNS suffix/);
  });
});
