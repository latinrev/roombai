# Public community counters

Starting with desktop v0.1.5, the community counter feature adds four pixel-styled figures to the landing page, refreshed every 30 seconds:

| Counter | Meaning |
| --- | --- |
| Total visits | Browsing sessions since the tracker was enabled, not unique people or raw pageviews. Reloads and tabs share a session when browser storage is available. |
| Browsing now | Browser sessions with a foreground heartbeat during the last 90 seconds. |
| Roombas online | Sum of counts shared by desktop installations that checked in during the last five minutes. Includes their roombas across all rooms, deduplicated locally by agent ID. |
| Download clicks | Clicks on actual release-file links, including the OS-specific header/hero buttons and all five explicit asset links. Not completed downloads, installs, or unique downloaders. |

## Website

`site/community.js` sends a foreground heartbeat every 30 seconds. A random local browser session ID expires after 30 minutes of inactivity (or 24 hours maximum). Where available, Web Locks prevent two simultaneously opened tabs from creating different sessions. If storage is unavailable, tracking falls back to an in-memory session and cannot deduplicate reloads. Do Not Track / Global Privacy Control suppress this client's visit and click events. The public totals remain visible.

Download events use `sendBeacon`, with a keepalive fetch fallback, so they never block the download link. Each event has a random ID for retry deduplication. Download clicks are also sent to Umami as the `download` event with a `platform` property when its tracker is available. Header/hero links pointing to the download section itself are not counted as downloads. Blockers or failed delivery can undercount events.

The public figures are maintained in D1, independently of Umami. No Umami administrative token is exposed. Existing Umami visitor history is **not** automatically imported. The visible explanation reports when these new counters began. HTTP failures show a dash and an unavailable label, not a fake zero or stale online count.

## Desktop

`src/community.js` is enabled only for packaged, non-demo installations whose user checks **Share roomba count** in the existing app menu. It is off by default and creates no tracking identity or requests until enabled. Turning sharing off sends zero and stops its timer. Quitting attempts a zero heartbeat; if it cannot finish, the server's five-minute timeout handles it.

The payload contains exactly four fields: a random installation ID, a random installation credential, an increasing sequence number, and the aggregate count. There are no agent IDs, session IDs, conversations, project names, paths, usernames, OS details, or versions. The local `community.json` retains the random identity and sequence across restarts. Server-side hashes identify records and authorize later updates. Sequence checks stop delayed requests from restoring an old count after opt-out.

Only a future app release containing this module can contribute counts. Existing v0.1.4 installations and the website's simulated roombas do not contribute. Forks should change or disable the endpoint rather than send unrelated counts to roombai.com.

## Storage and limits

`site/server/stats.js` serves `/api/stats` and the `/visit`, `/download`, and `/roombas` POST routes. It uses its own `STATS_DB` binding and the `roombai-community` D1 database, with no payment-system dependency. Only aggregate numbers are returned publicly.

Migration `0001_community_stats.sql` creates the counter tables. Lifetime visit/download totals persist; transient visit and click records expire after one day, installation records after 30 days without a heartbeat. Short-lived IP-derived rate-limit hashes expire after two minutes; raw IPs are not written to D1 by this code. The HTTP provider still receives network metadata as usual. Event bodies are capped at 1 KB. Same-origin checks protect browser events; installation credentials protect existing app records. These are anonymous, self-reported analytics, not fraud-proof audited audience figures.

## Testing and later deployment

Run `node --test test/*.test.js` from the root and `npm test --prefix site`. For a local preview:

```sh
npm run build:site
cd site
node node_modules/wrangler/bin/wrangler.js d1 migrations apply roombai-community --local
node node_modules/wrangler/bin/wrangler.js pages dev .output --port 4173 --binding SITE_ORIGIN=http://localhost:4173
```

For new deployments, create a D1 database, update its ID in `site/wrangler.jsonc`, and apply the migrations before deploying the website functions/assets. The Pages build command is `npm test && node ../scripts/build-site.js && node ../scripts/build-downloads.js`. Desktop count sharing is included in v0.1.5 and later; users must update and opt in before their roombas contribute.
