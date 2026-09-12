# Browser performance checks

The required browser CI job runs a desktop capacity test on every push and pull
request. It generates 7,000 synthetic charts in 1,750 song rows from the authored
fixtures, including pattern observations and Flow. This is a capacity workload,
not independent chart evidence, real visitor monitoring or a Lighthouse audit.
The generated catalog is approximately 20 MB; no downloaded corpus or personal
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

The live catalog still contains about 31 MB before HTTP compression. Separating
the initial song index from on-demand chart evidence is a possible future
improvement if real-world loading remains slow; it requires a versioned loading
contract and preservation of existing deep links. The current change does not
discard pattern evidence or Flow to reduce payload size.
