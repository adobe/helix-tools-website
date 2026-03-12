# Media Library Backfill

This tool backfills the AEM media log for an existing site by:

1. Discovering preview resources for the site.
2. Classifying those resources into pages and standalone media files.
3. Fetching Markdown for each page and extracting media references.
4. Converting those references into deterministic `ingest` and `reuse` medialog entries.
5. Posting the entries to the medialog API, or printing them in dry-run mode.

The implementation lives in `media-library-backfill.js`, with `index.html` providing the form and progress UI.

## Prerequisites

- The operator must be logged in for the target `org/site`.
- The tool works against the `main` ref only.
- The tool only reads preview data (`select: ['preview']`) when running bulk status.
- If `previewLastModifiedBy` is not available in status results, the tool falls back to the optional fallback email field or an empty user value.

## UI Inputs

- `Organization` and `Site`: target repository.
- `Dry run`: do not post to medialog; print the entries that would be sent.
- `Fallback user email`: used only when preview metadata does not provide a user.

## End-to-End Flow

### 1. Page Discovery

The tool starts with a lightweight bulk status call:

- `POST /status/{org}/{site}/main/*`
- Payload:
  - `paths: ['/*']`
  - `pathsOnly: true`
  - `select: ['preview']`

This returns preview paths without full resource payloads. The result is used as a planning pass.

#### Small sites

If the discovery pass returns `20,000` preview paths or fewer, the tool runs one full detailed status job for `['/*']`.

#### Large sites

If discovery returns more than `20,000` preview paths, the tool avoids one massive detailed job and instead builds packed partitions from the discovered paths.

Current rules:

- Target about `20,000` discovered preview paths per detailed status job.
- Allow up to `250` request paths in a single packed job.
- Group by top-level segment first.
- If both an exact top-level path and subtree content exist, keep them in the same partition.
  - Example: `['/blog', '/blog/*']`
- If only subtree content exists for a segment, use only the wildcard path.
  - Example: `['/en/*']`
- If only a root-level exact path exists, keep it as its own path bucket.
  - Example: `['/metadata.json']`
- Mixed exact paths and wildcards in one request are allowed and used intentionally.

The partition packing is greedy:

- Estimate each bucket size from the discovery pass.
- Sort largest buckets first.
- Add each bucket to the first partition that stays under both the target resource count and max path count.

This is designed to reduce status-job count while keeping coverage deterministic.

#### Job completion semantics

The admin job API can return either:

- An async job (`202`) that must be polled via `links.self` and then read from `/details`.
- A synchronous/transient job (`200`) that already contains the final job payload inline.

The client handles both. A job is treated as terminal when `state === 'stopped'`, and treated as complete only when `phase === 'completed'`.

If a detailed full-site job stops before completion and a partition plan exists, the tool retries discovery using the packed partitions and merges results by resource path.

### 2. Resource Classification

Detailed status results are deduplicated by `resource.path`.

From those resources:

- `pages` are resources with `previewLastModified` whose path does not end in a file extension.
- `standaloneMedia` are resources with `previewLastModified` whose path matches the supported media extensions.

Supported media extensions:

- Images: `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`
- Video: `mp4`, `mov`, `webm`, `avi`, `m4v`, `mkv`

### 3. User Attribution

User precedence during ingestion is:

1. `previewLastModifiedBy` from status results
2. `fallback-user` input
3. Empty string

## Markdown Fetching and Media Extraction

### Fetch strategy

Each page is fetched as Markdown with concurrency `5`.

The tool tries:

1. CDN first:
   - `https://main--{site}--{org}.aem.page{markdownPath}`
2. Admin preview fallback:
   - `GET /preview/{org}/{site}/main{markdownPath}`

If CDN access fails once, the run switches permanently to the admin preview API for the remaining pages.

`markdownPath` is derived from the web path:

- `/foo` -> `/foo.md`
- `/foo/` -> `/foo/index.md`
- `/` -> `/index.md`

### Supported Markdown patterns

The parser extracts media references from:

- Inline images:
  - `![alt](url)`
  - `![alt](url "title")`
- Reference-style images:
  - `![alt][ref]`
  - `[ref]: url`
- Markdown links whose URL ends in a supported video extension:
  - `[text](video-url.mp4)`

### URL normalization

Every extracted URL is normalized against the page URL:

- Protocol-relative URLs (`//...`) are converted to `https:`.
- Only `http:` and `https:` URLs are kept.
- `.hlx.page` becomes `.aem.page`.
- `.hlx.live` becomes `.aem.live`.

The medialog entry path uses the normalized absolute URL.

## Deterministic `ingest` vs `reuse`

Extracted media candidates are sorted deterministically before operations are assigned.

Sort order:

1. Page `lastModified`
2. Page path
3. Media URL
4. Original discovery order within the page-processing run

After sorting:

- The first occurrence of a media URL is emitted as `ingest`.
- Later occurrences of the same media URL are emitted as `reuse`.

This guarantees stable classification even though page fetching runs concurrently.

## Standalone Media Handling

Bulk status can also discover media resources that are not referenced from parsed page Markdown.

After page parsing:

- The tool builds a set of media URLs already represented by page-derived entries.
- Each standalone media file is converted to:
  - `operation: 'ingest'`
  - `resourcePath: <media path>`
  - `path: https://main--{site}--{org}.aem.page{media.path}`
- If that URL already exists in the set, it is counted as a duplicate and skipped.

This lets the tool backfill direct media resources in addition to page-linked references.

## Medialog Payload

Before submission, each entry is enriched with:

- `user`
- `timestamp` from the page or standalone media `lastModified`

Base fields:

- `operation`
- `path`
- `resourcePath`
- `contentType`
- Optional `width` and `height` if they can be inferred from the media URL query string pattern used by generated `media_<hash>` URLs

Content type is inferred from file extension and defaults to `application/octet-stream`.

## Posting Behavior

Entries are posted in batches of `10` to:

- `POST /medialog/{org}/{site}/main/`

Rules:

- Dry run:
  - No API calls are made to medialog.
  - Every would-be entry is logged to the console.
- Live run:
  - Each successful batch increments `sent`.
  - Failed or thrown batches increment `errors` by batch size.

## Logging and Progress

The console is intended to be operational, not verbose by default.

Current logging behavior:

- Job creation logs show the job URL.
- In-flight status polling logs show only `state` and optional `phase`.
- Final status-job logs show `phase` plus `paths` or `resources`, depending on the job type.
- Packed partitions log only a short preview of request paths, not the full list.

Progress phases:

1. Planning page discovery
2. Processing page content
3. Ingesting entries
4. Final summary

The progress card also shows:

- `Elapsed`: time since the current run started
- `ETA`: an approximate remaining time derived from elapsed time and overall progress percentage

The ETA is intentionally approximate and becomes more stable after the run has made visible progress through the weighted phases.

Visible counters:

- `Pages`: discovered content pages
- `Media`: total generated media entries, including duplicates and accepted standalone media
- `Sent`: successfully posted entries, or total would-be entries in dry-run mode
- `Errors`: failed fetches or failed medialog batches
- `Dupes`: entries classified as `reuse` plus skipped standalone-media duplicates

The summary also prints:

- Total duration
- Unique `ingest` count as `media - dupes`
- Duplicate `reuse` count

## Rate Limiting, Retries, and Cancellation

### Retries

`fetchWithRetry()` applies retries to all requests:

- `429`: respects `x-retry-after` or `retry-after`
- `503`: exponential backoff
- Other thrown network errors: exponential backoff

### Admin API pacing

Admin API requests are rate-limited client-side using `x-ratelimit-rate` when present.

### Cancellation

The Cancel button aborts the shared `AbortController`.

This stops:

- Poll waits
- Rate-limit waits
- In-flight fetches that honor the abort signal
- Remaining concurrency workers

## Important Constants

These values are current as of this README and should stay aligned with `media-library-backfill.js`:

- `REF = 'main'`
- `BATCH_SIZE = 10`
- `CONCURRENCY = 5`
- `POLL_INTERVAL = 2000`
- `ADMIN_API_RATE = 10`
- `LOG_WINDOW_SIZE = 1000`
- `LARGE_SITE_PATH_THRESHOLD = 20000`
- `TARGET_PARTITION_RESOURCE_COUNT = 20000`
- `MAX_PARTITION_PATHS = 250`

## Known Limitations

- Only Markdown is parsed. HTML blocks, CSS, and JavaScript are not inspected for media references.
- Only the explicitly supported image and video extensions are recognized.
- The tool operates on preview metadata and preview Markdown, not publish state.
- User attribution depends on `previewLastModifiedBy` being present in status results; otherwise the fallback email or a blank user is used.
- A single very large top-level subtree still remains one bucket; the planner currently packs buckets together but does not recursively split an oversized subtree into second-level partitions.

## Maintainer Notes

If you change discovery or partition logic, update this README together with:

- Threshold constants
- Job completion semantics
- Request shapes sent to bulk status
- The rules for `ingest` vs `reuse`
- Dry-run logging behavior
