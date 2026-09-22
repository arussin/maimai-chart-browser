# Source selection, local persistence and refresh

Settings → Import player data offers a file, a hosted Session Report, and a
clearly unavailable Maishift option. Selecting a radio makes no request.

Files retain the existing compressed v1 validation and optional remembering.
Hosted reports accept complete HTTPS URLs with no credentials, custom ports,
query or fragment. Only `/<installation>` (with or without a trailing slash), `/<installation>/index.html` and
`/<installation>/party/latest.json` resolve directly to the existing manifest.
Other report paths use an explicit Open report recovery link, without discovery
crawls or interpreting report HTML. A public manifest requires readable CORS;
protected reports keep their own sign-in, Open in Party and download flows.
No report Access rules, cookies, credentials or private deployment are changed.

A page being visible in a browser does not by itself enable direct import.
The report host must explicitly allow cross-origin reads of its public
`party/latest.json` and referenced `party/data/<sha256>.gz` payload. A missing
CORS header or protected response uses the report's existing Open in Party /
download route. The main report's Open in Party action targets the main site;
use its downloaded player file to test in an isolated local or hosted pilot.

The public adapter reads at most 1 MiB of JSON metadata and verifies the existing
offer, same-installation immutable gzip path, SHA256, length, decoded revision
and full normalized dataset. Existing limits remain 32 MiB compressed and 128 MiB
expanded. Reads omit credentials and referrers, reject redirects and use 10/30
second timeouts. HTML returned with success status is not an empty dataset.

The chart browser's CSP permits HTTPS connections for user-selected public
report hosts. Script, image and frame policies remain unchanged. The standalone
historical site and payment-return policies retain their existing allowances.
Neither selecting a radio nor rendering a profile makes an external request;
reads begin after Continue or previously confirmed refresh consent. No provider
avatars/jackets are loaded. Source URLs and player records never enter sharing
links or analytics events.

## Consent and refresh

New report connections visibly select Remember and refresh, followed by a
preview and explicit Import & remember or Import once. One-time imports retain
scores only in the tab session and create no remembered connection. Unchecking
remembering while reimporting the connected report removes that saved connection
and revokes its refresh consent. A different temporary source does not erase an
independently remembered profile. Switching
players never combines identities. The selector defaults to the connected source,
otherwise file.

Remembered scores restore before any network read. Automatic refresh runs only
on visible, online visits/focus, outside another import, handoff or dialog.
Transactional leases allow at most one attempt per source per 15 minutes across
tabs; manual refresh has a 30-second cooldown. Leases expire after 60 seconds.
There is no background timer, worker sync or server population job. Retry-After
is honored for 429/503; other errors defer the next attempt by 15 minutes.

Unchanged source revisions update metadata only. Older upstream capture dates
cannot roll back the local source head. Changed data uses the existing complete
versus partial snapshot rules and observation corrections. Refresh does not
create a play or session. Quiet status distinguishes checks, successful reads and
upstream snapshot dates, preserving hidden results and chart/filter state.

## Storage contract and migration

IndexedDB `maimai-player-data` upgrades additively to version 2, retaining the
`datasets` store and legacy `active` data. Old open releases requesting database
version 1 then fail safely instead of recreating forgotten data. Users with an
old tab must reload. Portable dataset and handoff versions remain **1**.

`active` contains `{revision, bytes, source}`; `source` is null for file/handoff
imports. The version-1 source descriptor contains type, canonical URL, player
key, adapter version, consent, generation, attempt/check/success/source dates,
source revision and retry time. None are added to the hashed portable dataset.
`control` contains only an epoch, mutation version, optional clear epoch and
temporary lease ID/deadline. The clear epoch contains no player information.
Dataset and descriptor writes share a transaction and compare epoch, version,
revision and the refresh lease. A manual import invalidates outstanding leases.

Forget aborts local work, deletes the remembered dataset and source, increments
the source-free epoch and notifies other tabs. Tab caches carry the epoch and
are discarded after Forget, including on reload of a formerly suspended tab.
Legacy tab caches are accepted only before an epoch change. In-memory scores may
remain viewable until reload; refresh stops. Notifications contain no identity,
source URL or scores. BroadcastChannel uses a source-free storage-event fallback.

Clear player data additionally removes in-memory scores in the current and other
open tabs, and is available for temporary imports too. Its durable clear epoch is
checked on focus/visibility/online recovery, so missed notifications do not leave
an old tab able to restore scores. A Clear failure keeps the working state and
reports the error; it does not claim that device data was removed.

Storage denial/quota failures preserve the current usable view. Tab-only imports
remain possible when device storage is unavailable. Announcement seen-state is
stored separately and is unaffected by Forget or Clear.

## Release checklist

- Verify legacy files, offers, database upgrades and downstream Session Report
  pinned-module compatibility.
- Run Python, browser, localization and source-copy checks through the canonical
  development wrappers. Use synthetic fixtures and DevCache outputs only.
- Verify transactional races, malformed/oversized data, throttle/error recovery,
  four-language layouts and Chrome/Edge/Firefox/WebKit behavior.
- Keep Maishift and its combined announcement disabled until the gate in
  [MAISHIFT_INTEGRATION.md](MAISHIFT_INTEGRATION.md) is accepted.
- Publish only after a separate release action. No proxy, hosted installation,
  personal capture, live canary schedule or alert publication is part of this
  implementation.
