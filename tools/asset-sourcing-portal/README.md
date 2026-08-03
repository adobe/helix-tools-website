# Asset Sourcing Portal EDS tool

This directory contains the experimental, framework-free Asset Sourcing Portal frontend
for AEM Tools. It uses the site's standard EDS `header` and `footer` placeholders, but
the transactional workflow is intentionally code-owned rather than Drive-authored.

This tool is an optional customer-hosted alternative to the generic React Spectrum
portal bundled with the backend. Both implementations use the same upload API and
authentication contract; deploying this EDS tool does not retire the generic portal.

Login, upload, and confirmation are states in one document. The session JWT and upload
files exist only in JavaScript memory; refreshing or closing the page returns the user
to login. Raw API-key fields are cleared after session or replacement-key minting.

The checked-in configuration uses the branded stage API. Before pointing this tool at
the production API, update both `portal-config.json` and the `connect-src` directive in
`index.html`, then register the deployed AEM Tools origins in the production backend's
exact-origin CORS configuration.

## Customer fork setup

1. Fork this EDS repository.
2. Edit `portal-config.json`:
   - `apiBaseUrl`: the dedicated Asset Sourcing API base URL, without
     `/api/upload/v1`. It must use HTTPS. `http://localhost`, `127.0.0.1`, and
     `[::1]` are accepted only for local development.
   - `imsOrgId`: **required** Adobe IMS organization ID for this customer
     deployment (for example, `0123456789ABCDEF@AdobeOrg`). This public,
     code-owned setting binds login and API-key rotation to one tenant; it is
     not inferred from the account name. The portal disables sign-in and shows
     a configuration error while the checked-in empty value is unchanged.
   - `tenantSlug`: a public deployment label. It is not a credential or an
     authorization boundary.
   - `uploadHostSuffixes`: only the HTTPS host suffixes the API may return for
     direct multipart PUTs. Keep this list as narrow as the customer's AEM
     deployment permits.
   - `branding`: a public title and same-origin logo path.
3. In `index.html`, replace the API origin in the CSP `connect-src` directive.
   Add only the storage origins corresponding to `uploadHostSuffixes`. The JSON
   configuration cannot broaden CSP, so both places must agree.
4. Register every deployed EDS origin (production, preview, and local development
   where needed) in the backend's exact-origin CORS configuration.
5. Configure customer-facing header and footer content through the existing EDS
   content source. No Drive-authored navigation was added or changed by this tool.

The IMS organization ID is a public routing identifier, not an IMS credential. Do not
put API keys, session tokens, Adobe IMS credentials, AEM credentials, intake paths,
or other secrets in `portal-config.json` or any EDS source file.

## Content Security Policy

The page uses the repository's nonce-based tool convention and denies objects, base
URLs, frames, embedding, and form submission. `connect-src` explicitly lists the API
and direct-upload storage hosts. Keep the `move-to-http-header="true"` marker so the
deployment pipeline can promote the policy to an HTTP header; `frame-ancestors` is
only enforced when delivered as a response header.

Authenticated backend banner URLs must resolve to the configured API origin. Legacy
public HTTPS banner URLs can be displayed without credentials.

## Local testing

Run from the repository root:

```sh
npm test
npm run lint
```

For a local backend, temporarily point `apiBaseUrl` and the CSP `connect-src` at the
loopback origin. Do not commit a customer credential or local secret.
