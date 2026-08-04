# Asset Sourcing Portal EDS tool

This directory contains the experimental, framework-free Asset Sourcing Portal frontend
for AEM Tools. It uses the site's standard EDS `header` and `footer` placeholders, but
the transactional workflow is intentionally code-owned rather than Drive-authored.

This tool is an optional customer-hosted alternative to the generic React Spectrum
portal bundled with the backend. Both implementations use the same upload API and
authentication contract; deploying this EDS tool does not retire the generic portal.

Authentication uses HTTP Basic with the backend-issued `username` and opaque
`password`. Vendor display names remain presentation data and are never used as login
identifiers. Usernames are trimmed and lowercased; passwords are sent byte-for-byte
without trimming. Self-service changes call
`/api/upload/v1/account/rotate-password?org=<organization ID>` and consume the returned
`password` and `passwordId`; the generated password is shown only once.

Login, upload, and confirmation are states in one document. The session JWT, password,
metadata form state, and selected upload files exist only in JavaScript memory;
refreshing or closing the page returns the user to login. Raw password fields are
cleared after session or replacement-password minting.

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
   - `org`: optional authoritative short organization ID for a single-customer
     fork (for example, `0123456789ABCDEF`). Do not include an internal suffix.
     When configured, the portal always uses this value and ignores `org`
     supplied in the page URL.
   - `tenantSlug`: a public deployment label. It is not a credential or an
     authorization boundary.
   - `locale`: optional EDS deployment default. Supported values are `en`, `fr`,
     `de`, `es`, `pt-BR`, `ja`, `ko`, `zh-Hans`, `ar`, and `hi`. URL `lang`
     and the organization-scoped browser selection take precedence.
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

The checked-in empty `org` supports a shared deployment. Its public login URLs
must include the URL-encoded short organization ID in the `org` query parameter:

```text
https://example.com/tools/asset-sourcing-portal/index.html?org=0123456789ABCDEF
```

When neither the fork configuration nor the URL supplies an organization, the portal
fails closed, disables sign-in, and shows a configuration error. The username is never
used to infer tenancy.

The short organization ID is a public routing identifier, not an IMS credential. Do not
put passwords, session tokens, Adobe IMS credentials, AEM credentials, intake paths,
or other secrets in `portal-config.json` or any EDS source file.

## Content Security Policy

The page uses the repository's nonce-based tool convention and denies objects, base
URLs, frames, embedding, and form submission. `connect-src` explicitly lists the API
and direct-upload storage hosts. Keep the `move-to-http-header="true"` marker so the
deployment pipeline can promote the policy to an HTTP header; `frame-ancestors` is
only enforced when delivered as a response header.

Authenticated backend banner URLs must resolve to the configured API origin. Legacy
public HTTPS banner URLs can be displayed without credentials.

## Localization

The portal fetches `/api/upload/v1/i18n/manifest.json` from the configured API and then
loads only the selected hashed locale catalog. If that catalog cannot be loaded, it
retries the English catalog. Translation catalogs remain backend-owned and must not be
copied into this repository.

Deploy the backend manifest, hashed catalogs, canonical username/password endpoints,
and session `portalLocalization`/metadata `labelByLocale` fields before enabling this
frontend against an environment. The API origin must also allow the deployed EDS
origins through its exact-origin CORS configuration.

The selector stores only the locale under an organization-scoped `asp.locale.<org>`
browser key and updates `lang` without removing `org` or other URL parameters. After
sign-in, the vendor's `portalLocalization` limits available locales and supplies the
default when there was no explicit URL or persisted selection. Localized metadata
labels come from each field's `labelByLocale`; field IDs, option values, submitted
metadata, filenames, paths, and branding remain unchanged.

## Local testing

Run from the repository root:

```sh
npm test
npm run lint
```

For a local backend, temporarily point `apiBaseUrl` and the CSP `connect-src` at the
loopback origin. Do not commit a customer credential or local secret.
