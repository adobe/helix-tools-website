# Scheduler

Manage scheduled publishes for pages and snapshots, backed by the
[helix-snapshot-scheduler](https://helix-snapshot-scheduler-prod.adobeaem.workers.dev)
worker.

The tool ships two entry points in the same folder:

| Path | Purpose |
| --- | --- |
| `/tools/scheduler/index.html` | Full management UI — list all scheduled items (pages + snapshots) and delete schedules. |
| `/tools/scheduler/schedule.html` | Compact popup designed to be opened as an AEM Sidekick popover plugin so authors can schedule the page they are viewing in one click. |

## Management UI

1. Open `https://tools.aem.live/tools/scheduler/`.
2. Enter the **Organization** and **Site** and click **Load schedule**.
3. If the site is not yet enabled for scheduling, the status panel asks
   you to contact your admin — site registration is handled out-of-band
   through the AEM admin API, not from this UI.
4. Once enabled, the table shows each scheduled item with its type
   (Page / Snapshot), target, publish time, requester, and a Delete action.
   Page rows link out to the published preview URL; snapshot rows link into
   the existing `snapshot-admin` tool for that snapshot.

The console panel logs every HTTP call (status, method, URL, x-error) so
failures are easy to diagnose.

## Sidekick plugin

Any EDS project can add the scheduler popover to its Sidekick by appending
this entry to `/{org}/sites/{site}/sidekick.json` under `plugins`:

```json
{
  "id": "schedule-publish",
  "title": "Schedule Publish",
  "environments": ["edit", "preview", "prod"],
  "url": "https://tools.aem.live/tools/scheduler/schedule.html",
  "isPopover": true,
  "popoverRect": "width: 480px; height: 360px",
  "passReferrer": true,
  "passConfig": true
}
```

`passConfig` injects `owner`, `repo`, `ref`, etc. as query parameters and
`passReferrer` injects the current page URL — the popover uses
`owner`/`repo` as `org`/`site`. For the page path, Sidekick's `referrer` is
just `window.location.href` of the tab the plugin was opened from. On the
default `.aem.page`/`.aem.live`/`.aem.reviews` hosts that's the page itself,
so its URL pathname is the resource path. On any other host — SharePoint,
Google Docs, etc. — the tab isn't guaranteed to be the
page, so the popover instead resolves the path via the Admin API's
`GET /status/{org}/{site}/{ref}?editUrl={referrer}` (`webPath` on the
response), the same mechanism Sidekick itself uses while editing. The site must already
be enabled for scheduling for the popover to schedule successfully.

## Authentication

The scheduler tool and popover both rely on the AEM Sidekick extension
to inject the access token on outbound requests; the tool itself sets no
`Authorization` header. Without the Sidekick installed and signed in,
calls to `admin.hlx.page` and the scheduler worker will fail with 401.

## Files

- `utils.js` — worker API + helpers (pure module, no DOM).
- `index.html` / `scheduler.js` / `scheduler.css` — management UI.
- `schedule.html` / `schedule.js` / `schedule.css` — sidekick popover.
