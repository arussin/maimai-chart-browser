# Browser performance checks

The required browser CI job runs desktop capacity tests on every push and pull
request. It generates 7,000 synthetic charts in 1,750 song rows from the authored
fixtures, including pattern observations and Flow. This is a capacity workload,
not independent chart evidence, real visitor monitoring or a Lighthouse audit.
Both the original full catalog and progressive loading are exercised. The
generated full catalog is approximately 20 MB; no downloaded corpus or personal
files are needed in CI.

The check fails if the catalog is parsed more than once, startup exceeds five
seconds, any measured search/sort interaction exceeds 350 ms, or full-catalog
similarity exceeds one second. It also verifies that the expected results appear
and initial rendering stays at 40 rows. Interaction timing runs from the browser
event to two animation frames afterward. These are regression budgets for hosted
CI hardware, not claims that a one-second interaction is a good user experience.
The job prints its measurements and attaches `capacity-timings.json` to the test
result. The existing mobile, keyboard, comparison and privacy checks still run.

To run the same check in a normal developer environment, generate browser fixtures
with `python tests/browser/prepare.py`, then run `npm test -- performance.spec.js
--project=desktop` from `tests/browser` after installing its pinned dependencies
and Chromium. The browser test configuration starts the local fixture server.
No live-site load generation or account access is involved.

## September 2026 startup correction

The published research interface parsed the roughly 31 MB catalog four times:
once in the loader and once each for artwork, pattern observations and the chart
view. It also serialized the whole parsed catalog back into text and sorted every
difficulty before grouping songs and sorting the displayed rows again.

The loader now shares one parsed public catalog across those modules, retains the
original JSON text for compatibility, and reads at most two verified catalog
parts concurrently. Filtering groups the matching charts before sorting the
displayed representatives. Integrity checks, catalog bytes, version IDs, selected
difficulties and ranking rules remain unchanged.

Local browser measurements used the actual 6,959-chart public release and an
instrumented local server, with no CPU or network throttling. Two alternating
repeat navigations measured 649/613 ms before and 325/293 ms after, approximately
halving startup time in those runs. Earlier first visits were 854 ms before and
1,258 ms after, so this small sample does **not** establish a universal cold-load
improvement. Repeat-run longest main-thread tasks fell from 281/284 ms to
121/124 ms. Internet transfer, slower devices and cache state can add delay.

## Progressive initial loading

Public release manifests now use schema `1.2.0`. Each version retains its original
catalog identity and exact full-catalog parts, and adds a separately hashed
`startup` index. The loader still accepts `1.0.0` and `1.1.0` manifests. Existing
catalog versions and chart URLs keep their meaning; this is a delivery change,
not a new analysis or qualification of the research catalog.

The index carries every chart's search and navigation fields, complete matching
measurements, pattern counts, prevalence, coverage and Flow peak. Thus filtering,
sorting and finding similar charts do not wait for detailed evidence. The latest
6,959-chart release needs 13,409,935 index bytes instead of 31,302,587 full-catalog
bytes (57% less before HTTP compression). A local gzip estimate is about 3 MB;
actual transfer encoding and speed depend on the host and browser.

Full Flow segments, representative spans and passage snippets live in up to
1,024 content-addressed shards per catalog. Small Flow plots request evidence
when they approach the viewport; opening chart details or passage demos gives
those requests priority. The loader allows at most three concurrent detail reads,
shares requests to the same shard, and keeps verified results in session memory.
Public index, detail and artwork assets also have immutable HTTP cache headers.
Interface code preloads alongside the index, but executes after it is ready.

Every shard is checked for its exact size, SHA-256, catalog identity and chart
source identities before any contents are applied. Failed reads leave the index
usable and expose a retry action. No personal file enters these public assets or
requests; personal import remains a separate, local-only interface. There is no
service worker, account storage or corpus update involved.

CI verifies index/full-catalog pattern and ranking parity, exact retained Flow
and evidence, deferred requests, duplicate request sharing, the concurrency cap,
failed integrity/identity checks, retries, linked comparisons and mobile layouts.
The capacity check budgets the initial index below 10 MiB for its synthetic
fixture and checks that offscreen rows wait to fetch their evidence. Network
payload budgets complement the existing timing checks; neither is a field
measurement or a promise that every device will have the same startup time.
