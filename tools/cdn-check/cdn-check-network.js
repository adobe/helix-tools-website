/**
 * Pure IP → CDN classification for the Production DNS & network panel.
 * Imported by `cdn-check.js` and unit tests (no DOM / fetch).
 */

/**
 * ASN → common CDN / edge name (conservative where possible; org string used for ambiguous cases).
 * CloudFront edge is announced under AS16509 (AMAZON-02) and AS14618 (AMAZON-AES); both ASNs are
 * shared with other AWS services, so this is a best-effort match for production CDN-fronted URLs.
 */
const CDN_BY_ASN = new Map([
  [13335, 'Cloudflare'],
  [54113, 'Fastly'],
  [20940, 'Akamai'],
  [35993, 'Akamai'],
  [16625, 'Akamai'],
  [16647, 'Akamai'],
  [32787, 'Akamai'],
  [24319, 'Akamai'],
  [63949, 'Akamai (Linode)'],
  [16509, 'Amazon CloudFront'],
  [14618, 'Amazon CloudFront'],
]);

/**
 * @param {{ asn?: number|string, org?: string, isp?: string }} conn
 * @returns {{ isKnownCdn: boolean, label: string, detail: string }}
 */
export default function classifyIpNetwork(conn) {
  const asn = Number(conn.asn);
  const org = (conn.org || '').trim();
  const isp = (conn.isp || '').trim();
  const blob = `${org} ${isp}`.toLowerCase();

  if (Number.isFinite(asn) && CDN_BY_ASN.has(asn)) {
    return {
      isKnownCdn: true,
      label: CDN_BY_ASN.get(asn),
      detail: [org, isp, `AS${asn}`].filter(Boolean).join(' · '),
    };
  }

  const cdnByName = [
    ['cloudflare', 'Cloudflare'],
    ['fastly', 'Fastly'],
    ['akamai', 'Akamai'],
    ['cloudfront', 'Amazon CloudFront'],
    ['amazon cloudfront', 'Amazon CloudFront'],
    // RDAP often has no origin ASN for Amazon IP allocations; registrant is still Amazon.com, Inc.
    ['amazon.com, inc', 'Amazon CloudFront'],
    ['amazon.com inc', 'Amazon CloudFront'],
    ['edgecast', 'Edgecast (Verizon)'],
    ['verizon digital media', 'Verizon Media CDN'],
    ['limelight', 'Limelight'],
    ['llnw', 'Limelight'],
    ['stackpath', 'StackPath'],
    ['highwinds', 'StackPath / Highwinds'],
    ['cdn77', 'CDN77'],
    ['bunny.net', 'Bunny.net'],
    ['bunnycdn', 'Bunny.net'],
    ['keycdn', 'KeyCDN'],
    ['azurefd', 'Azure Front Door'],
    ['microsoft-azure', 'Microsoft Azure CDN'],
    ['google edge', 'Google edge'],
    ['gcore', 'Gcore'],
  ];

  const matchedByName = cdnByName.find(([needle]) => blob.includes(needle));
  if (matchedByName) {
    const [, name] = matchedByName;
    return {
      isKnownCdn: true,
      label: name,
      detail: [org, isp, Number.isFinite(asn) ? `AS${asn}` : ''].filter(Boolean).join(' · '),
    };
  }

  if (asn === 15169) {
    return {
      isKnownCdn: false,
      label: 'Google',
      detail: [org, isp, 'AS15169'].filter(Boolean).join(' · '),
    };
  }
  if (asn === 8075) {
    return {
      isKnownCdn: false,
      label: 'Microsoft',
      detail: [org, isp, 'AS8075'].filter(Boolean).join(' · '),
    };
  }

  const fallback = org || isp || (Number.isFinite(asn) ? `AS${asn}` : 'Unknown network');
  return {
    isKnownCdn: false,
    label: 'Unsupported CDN',
    detail: [org, isp, Number.isFinite(asn) ? `AS${asn}` : ''].filter(Boolean).join(' · ') || fallback,
  };
}
