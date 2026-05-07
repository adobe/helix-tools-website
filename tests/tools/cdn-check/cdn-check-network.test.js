import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import classifyIpNetwork from '../../../tools/cdn-check/cdn-check-network.js';

describe('cdn-check-network.js', () => {
  describe('classifyIpNetwork', () => {
    it('maps known CDN ASNs', () => {
      const cf = classifyIpNetwork({ asn: 16509, org: 'Amazon.com, Inc.', isp: 'Amazon' });
      assert.equal(cf.isKnownCdn, true);
      assert.equal(cf.label, 'Amazon CloudFront');
      assert.ok(cf.detail.includes('AS16509'));

      const fastly = classifyIpNetwork({ asn: 54113, org: 'Fastly', isp: 'Fastly' });
      assert.equal(fastly.isKnownCdn, true);
      assert.equal(fastly.label, 'Fastly');
    });

    it('treats Amazon.com, Inc. registrant as CloudFront when ASN is missing (RDAP-style)', () => {
      const r = classifyIpNetwork({
        org: 'Amazon.com, Inc.',
        isp: 'Amazon.com, Inc.',
      });
      assert.equal(r.isKnownCdn, true);
      assert.equal(r.label, 'Amazon CloudFront');
    });

    it('matches org/ISP substring for Cloudflare before falling through', () => {
      const r = classifyIpNetwork({
        org: 'Cloudflare, Inc.',
        isp: 'Cloudflare',
      });
      assert.equal(r.isKnownCdn, true);
      assert.equal(r.label, 'Cloudflare');
    });

    it('labels Google and Microsoft ASNs as non-CDN infrastructure', () => {
      const g = classifyIpNetwork({ asn: 15169, org: 'Google LLC', isp: 'Google' });
      assert.equal(g.isKnownCdn, false);
      assert.equal(g.label, 'Google');

      const m = classifyIpNetwork({ asn: 8075, org: 'Microsoft Corporation', isp: 'Microsoft' });
      assert.equal(m.isKnownCdn, false);
      assert.equal(m.label, 'Microsoft');
    });

    it('returns Unsupported CDN for unknown networks', () => {
      const r = classifyIpNetwork({ org: 'Example ISP', isp: 'Example ISP' });
      assert.equal(r.isKnownCdn, false);
      assert.equal(r.label, 'Unsupported CDN');
    });
  });
});
