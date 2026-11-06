# tools.aem.live

[tools.aem.live](https://tools.aem.live/), provides administrative and development tools for AEM Edge Delivery Services (EDS).

## Environments
- Preview: https://main--helix-tools-website--adobe.aem.page/
- Live: https://main--helix-tools-website--adobe.aem.live/

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Code Browser

Open `/tools/code-browser/index.html` to inspect codebus for an organization and site.
Select a branch, navigate folders, and filter entries. Each folder's complete
listing is loaded automatically across all API pages. Dot-prefixed files and
folders are hidden. Selecting a file navigates to the `live.url` returned by its
codebus metadata.

**Download branch as ZIP** recursively downloads all non-hidden files in the
selected branch, independent of the current folder or filter. It fetches each
file's bytes from its metadata's `live.url` without sending API credentials.
Folder discovery is sequential; metadata lookups and file downloads use up to
40 concurrent workers. A failure cancels outstanding requests before the tool
allows another operation.
The live host must permit cross-origin requests; any failed download aborts
the export rather than producing an incomplete ZIP. If the browser console
confirms CORS blocking, the error suggests installing a trusted CORS-unblocking
extension (CORS blocker), enabling it only for the download, and disabling it
afterward. Browsers do not distinguish CORS failures from network failures in
the fetch error, so the tool presents this as a possible cause.
The ZIP reflects live
responses at download time, which may be cached or differ from codebus metadata.
ZIPs are assembled in browser memory and stored without recompression.

The browser is read-only. All listing and metadata requests are GETs to
`https://api.aem.live/{org}/repos/{site}/code/` and its branch/file paths; it does
not use the legacy admin endpoint. For protected repositories, sign in to the
organization using AEM Sidekick before browsing. Your session must have code
read/list permissions. The homepage tool catalog is CMS-authored; adding a card
for this tool requires a content update.

## Local development

1. Create a new repository based on the `aem-boilerplate` template and add a mountpoint in the `fstab.yaml`
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `helix-admin-website` directory in your favorite IDE and start coding :)
