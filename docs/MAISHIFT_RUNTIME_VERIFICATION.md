# Maishift runtime and chronology verification

2026-09-21. **Local verification passed; release remains incomplete and disabled.**
The final Worker returned the approved official sample's 2,010 International PBs
and 200 Japan PBs unchanged. Source chronology across actual uploads, deployed
CPU/memory behavior, upstream access from Cloudflare and Party-origin browser
acceptance remain open. No deployment or monitoring activation occurred.

Follow-up: the [invited hosted pilot](MAISHIFT_PILOT.md) now implements the
baseline/genuine-upload/stable-reread experiment proposed here. Its fictional
tests pass and a separate static artifact is prepared. It is not published and
has not closed chronology or deployed operating-limit acceptance. The original
measurements and provenance below remain unchanged.

## What this pass changed

- Bound the returned JSON to 4 MiB, including identity, coverage and diagnostics.
  Shared song metadata can expand once per PB, even when the input fits its own
  4-MiB limit. The adapter now measures each serialized record's UTF-8 bytes and
  rejects excessive expansion before assembling a large response. It never
  truncates a successful import or silently drops identifiable PBs.
- Admit at most two active imports per Worker isolate. Excess requests receive
  HTTP 429 and a 30-second retry before any profile lease or upstream fetch.
  No request bodies are queued. The only shared value is an in-memory count;
  no player identity, data or response is cached. Existing Durable Object leases
  still coordinate individual profiles across isolates. This is a memory guard,
  not an account-wide traffic or spending limit.
- Set a proposed 1,000-ms CPU ceiling in the disabled Wrangler configuration.
  It requires the paid plan and deployed verification before release. No account,
  route, rate-limit namespace, authentication or logging configuration was enabled.
- Add a manually run, aggregate-only local benchmark and regressions for output
  expansion, reservation cleanup, and safe handling of ambiguous chronology.

## Method and privacy

`player-import-worker/benchmark.mjs` runs the unchanged production entry point,
decoder, minimizer and SQLite coordinator in Miniflare/workerd. The local native
rate binding is enabled. All local Worker outbound requests are intercepted and
checked against the two frozen RPC destinations, their sequence, and the absence
of credentials/referrers. The production source is not instrumented.

The live mode performs exactly one validated profile/tracks/profile sequence
against the approved canary. Raw wire bodies remain in Node memory. Replays use
fictional handles and reserved documentation IPs for independent local leases;
these identities are never sent to Maishift. The actual chart/PB payload is
unchanged. Every successful replay is compared with the validated source result,
apart from the fictional handle. This exercises serialization inside workerd,
but the initial upstream network connection still originates in local Node.

Each run makes three individual requests, then bursts of four and eight requests
to the **local** Worker. In the final runs, seven requests succeed and eight
receive the expected capacity retry. Those seven imports cause 21 in-memory
RPC replays, not additional upstream requests. Each region uses three live reads.
An earlier International measurement before hardening also used three reads:
**nine live canary requests total for this verification pass**. No other profile
was read or enumerated. Public guide and static-code reads are separate.

The inspector is bound to loopback. CPU profiles are summarized in memory;
heap snapshots, raw profiles, PB dumps, browser storage and live screenshots are
not saved. Only numeric timing, memory, byte and record counts, tool versions and
a source-code digest are emitted. Application logging and telemetry remain off.
Runtime dependencies and retained outputs stay in the approved DevCache. The
final harness also pins process-local temporary storage there. The initial manual
launches used Miniflare's default OS temporary staging, removed by its normal
disposal; this was corrected without changing the measured production modules.

## Results on the final Worker

| Input | Catalog / played PBs | Track input bytes | Returned bytes | First local request | Next two local requests | Largest sampled JS heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Official sample, International | 6,031 / 2,010 | 2,031,700 | 484,333 | 129 ms | 77–79 ms | 31.5 MiB |
| Official sample, Japan | 6,443 / 200 | 1,902,798 | 47,005 | 110 ms | 61–77 ms | 48.8 MiB |
| Fictional full catalog | 6,443 / 6,443 | 2,021,221 | 1,521,720 | 121 ms | 71–73 ms | 53.9 MiB |
| Fictional near-input-limit profile | 13,000 / 13,000 | 4,081,810 | 3,074,141 | 159 ms | 129–142 ms | 71.7 MiB |

All admitted requests returned every expected PB with zero exclusions. Timings
exclude upstream network reads but include local fixture delivery, the coordinator,
profiling and response consumption. These are development-machine observations,
not production latency promises or physical-device browser measurements.

For the next two individual requests, sampled application-plus-GC intervals were
33–34 ms for International, 24–32 ms for Japan, 37–41 ms for the fictional catalog,
and 70–73 ms for 13,000 PBs. The raw aggregates retain idle and unattributed
intervals separately. Sampling, native work and profiler overhead prevent these
numbers from being treated as billed CPU or an exact upper bound.

Before the admission guard, the eight-way 13,000-PB burst sampled 108.6 MiB of JS
heap and 45.1 MiB of backing storage. These counters are not a complete or
necessarily additive platform accounting, but the result did not support a safe
shared-memory budget. With the guard, the largest sampled heap is 71.7 MiB with
15.0 MiB backing storage at that sample; excess work makes no upstream reads.
This supports the local guard, not a guarantee that every accepted wire shape or
production workload fits. Sampling can miss peaks, and garbage collection was
not forced; the final heap counter is not a retained-object/leak measurement.

Cloudflare documents a 10-ms free HTTP CPU limit, a paid default of 30 seconds,
and 128 MB shared per isolate. Local measurements do not justify the free plan.
The disabled configuration proposes a lower paid ceiling of 1,000 ms, leaving
room above this local sample while bounding CPU exposure. Owner review must
still cover paid-plan selection, Durable Object costs, aggregate abuse/spending
limits and actual deployed CPU/memory results. No account state was inspected or
changed. Sources: [Worker limits](https://developers.cloudflare.com/workers/platform/limits/),
[local CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)
and [memory profiling](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage/).

## What upstream dates do and do not establish

The [official upload guide](https://maimai.shiftpsh.com/en/guide?device=pc)
explains that records are not updated when the current play count is no greater
than the previous one. Read-only inspection of the served
[upload component](https://maimai.shiftpsh.com/assets/index-sm0rQYoS.js)
confirms that client-side check and a separate upload request. The component
contains no `createdAt` or `updatedAt` assignment. We did not execute the
bookmarklet, call the upload endpoint, sign in, change a profile or contact its
owner. No published timestamp/atomic-snapshot guarantee was established.

The earlier public profile/export components display `createdAt`; they do not
establish a stable account identifier. The before/after profile check establishes
agreement of the selected metadata during each read. It cannot establish that a
concurrent upload publishes profile metadata and full tracks atomically, or that
every correction advances `updatedAt`. Re-reading an unchanged profile cannot
prove either claim. See [earlier date evidence](MAISHIFT_MATCHING_RESEARCH.md#player-identity-and-dates).

Party's deterministic behavior is verified separately: unchanged PB content adds
no history; a newer correction may lower a PB; equal-time changed PBs are rejected;
older refreshes retain the saved data and show the older-source status. Fetch time
is never substituted for source time. Those tests do not prove upstream behavior.

To close chronology, use explicitly approved before/after observations of a
volunteer's genuine uploads, including an actual correction and a game-version
transition, or an authoritative supported contract. Compare the complete PB
content and both dates in memory and retain only aggregate change/order results.
Verify interrupted or overlapping updates cannot present mixed snapshots. An
ordinary unchanged re-read is insufficient, and changing the official sample is
outside this task. If stable ordering/consistency cannot be established, keep
automatic Maishift imports and the announcement disabled; any revised import
semantics require a separate explicit design decision.

## Reproduction and provenance

Run `tools/Test-Development.ps1 -Check worker` from the canonical checkout, then
run `node benchmark.mjs` in that fresh DevCache workspace's `player-import-worker`
directory. This Windows harness refuses paths outside the registry DevCache and
keeps its runtime staging in the project's short `temp` directory (the same path
used by the development wrapper). The default fictional workload
has 6,443 PBs and makes no network
requests; `MAISHIFT_BENCHMARK_CHARTS=13000` selects the near-limit case.

Live mode additionally requires `MAISHIFT_BENCHMARK_LIVE=true`,
`MAISHIFT_CANARY_APPROVED=true`, an explicitly approved `MAISHIFT_CANARY_URL`, and
`MAISHIFT_CANARY_REGION=intl` or `jp`. Never set these in unattended automation.
Keep `WRANGLER_SEND_METRICS=false`. Do not enable network tracing or dump live
exceptions. Benchmark output is not a release approval or a deployed contract test.

- Base implementation: registry commit `7729f2f`; this verification adds the
  reviewed Worker limits and tests without changing chart mappings or datasets.
- Final measured concatenated `worker.mjs`, `index.mjs`, `contract.mjs`,
  `coordinator.mjs` SHA256:
  `619e441cc64f5bde341eb87402ebef682c1c28207bbe9755944a20e7e84d9268`.
- Node `24.14.1`, Wrangler `4.135.0`, Miniflare `5.20260918.0-alpha`,
  workerd `1.20260918.1`, compatibility date `2026-09-21`; dependencies remain pinned.
- Final four aggregate benchmark files are in
  `workspaces/20260921T172044446-048cb83d/player-import-worker` under
  `C:\DevCache\projects\maimai-chart-browser-registry\6c15e789d6fd4518`.
- The inspected public upload component SHA256 is
  `c91cdfbe22c59a175283549a1cb0290f14638a82ef90468f9d7d92d06d22f92e`.
  Its public code is retained only in the earlier DevCache research workspace;
  it was read as text, not imported or evaluated.

The shared v1 library and Session Report pin remain
`f1abe2c7d93ff7f0b6610dd0bb57d4e038f609c0`. There are no UI copy or localization
changes in this pass. Earlier full Python, file/report compatibility and mapping
evidence remains in [delivery](PLAYER_IMPORT_DELIVERY.md) and
[mapping tests](MAISHIFT_MAPPING_TESTS.md). Concurrent filter/localization/artwork
work and untracked files are preserved separately.

## Deterministic validation in this pass

- `tools/Test-Development.ps1 -Check worker`: **16 passed**, including the actual
  workerd/SQLite tests and three new output/admission regressions. Binding
  generation also passes with the disabled proposed CPU ceiling. Final workspace:
  `20260921T172655896-d20ff84b`.
- `tools/Test-Development.ps1 -Check browser -TestFile player-maishift.spec.js`:
  **112 passed** across Chrome, Edge, Firefox, WebKit, desktop, mobile and 320px
  configurations. This includes the two new history/output regressions, all four
  languages, unchanged/lower PB observations, hidden results, source replacement
  and cross-tab Forget. Workspace: `20260921T172343769-7b3532c6`.
- The final harness passed a network-free 6,443-PB run with its enforced short
  DevCache temp path in `20260921T172655896-d20ff84b`. Its production-module digest
  matches the four reported measurements. A trial using a deeper workspace temp
  directory returned a runtime 502; the short path resolved it, consistent with
  a Windows staging-path issue. That failed attempt is not counted as acceptance.
  The final path follows the already working wrapper layout.
- No shared Python, portable dataset, chart-mapping or Session Report code changed
  in this pass; their earlier validation is linked above. No new UI wording or
  layout was introduced, so no replacement screenshots were generated.
