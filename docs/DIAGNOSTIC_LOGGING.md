# Privacy-safe operation diagnostics

The diagnostics foundation shipped separately in PR64 (`30de8cd`). PR63 now
reconciles the import connectors with production `d732212` (PR65), preserving
the production diagnostics, export behavior and song-discovery changes. The
connector additions extend the finite contracts; they do not activate services
or establish real-account acceptance. Deployment, database changes and provider
access remain separate release steps.

## Baseline and historical interpretation

On 15 October the public site's entry references were
`browser-entry-JD3RZZ3L.js` and `application-QMMHUN26.js`, matching the production
baseline. A read-only GitHub check found PR63 open/draft at `6eaea32`, based on
`8b26d32`. The connector checkout was clean before this task. Other workspaces,
including the independently maintained registry and historical browser checkout,
had unrelated local changes and were left alone.

The October 8–14 report has nine Maishift `unavailable` events: seven on October 9,
two on October 13. They are event counts, not users or proven outages. Version 1
rows and their interpretation are unchanged; this patch never backfills reasons.
The September 22 hosted pilot record is historical. Public browser references do
not verify the current import Worker or collector deployment/configuration; those
require a fresh readback through the existing authorized release workflow.

## What is measured

Version 1 remains the existing product-action contract. Version 2 is a separate
diagnostic batch sent to the same exact endpoint, with the same 4 KiB, 16-row and
1–100 count limits. It is written to a separate daily aggregate table. A terminal
diagnostic belongs to one operation, not to a visitor, session or linked funnel.
Storage transactions and an enclosing import are different operations and must
not be summed as independent incidents.

| Priority | Boundary | Meaning |
|---|---|---|
| P0 | Worker, bounded browser transport, normalization, coordinator | Explicit Worker timeout versus client timeout; network, rate limit, upstream busy, unavailable profile, region, schema, malformed/oversized response, changed snapshot, local normalization/identity, storage and unknown |
| P0 | Manual and automatic refresh | Changed success, successful unchanged/older snapshot, intentional cooldown skip, failure and supersession; existing retry deadlines and saved-data behavior remain |
| P1 | Restore and storage transactions | Temporary/persistent source and read/decode/reconcile/identity/commit stages; quota/denied where the platform supplies a DOMException; no values, keys or raw error text |
| P1 | Optional export preferences | Bounded degraded persistence per stage/reason until a successful write; in-memory choices remain usable, not a failed export |
| P1 | Catalog and shared detail repository | One terminal per fetch job, even when several widgets await it; retry recovery; integrity/schema/identity and transport remain distinct; unavailable prepared analysis is not a transport failure |
| P1 | Image render | Renderer-module, canvas/context, PNG encoding and preview preparation failures; completed with failed expected artwork is degraded; absent optional artwork does not count as a failed expected image; close/options/data replacement cancel or supersede |
| P1 | Sender and owner reports | Local bounded delivery status, server acknowledgement only after storage, strict version compatibility and latest known diagnostic receipt; current write availability and missing delivery remain unknown |
| P2 | Comparison and similar matching | Actual computation/render exceptions are failures; missing coverage and empty matches are not. Same-chart or missing linked-chart selections are not errors |
| P2 | Search | Existing `search_used` is labeled **Search interactions**, including input/composition changes. Debounced result buckets are deferred: a settled keystroke is not an agreed completed-search boundary, and adding it would increase volume without resolving that semantic question |

`compare_loaded` still means comparison UI loaded, and `chart_opened` means an
opening action. Neither establishes that lazy evidence loaded; inspect the shared
detail repository's diagnostic outcomes. PNG download clicks remain clicks; no
download-completed metric is introduced.

The diagnostic instrumentation preserves the import controls and export styling.
The preview-readiness check waits for image decoding before offering a download;
that behavior was reviewed separately and accepted. Diagnostics add no public
panels, labels or explanatory prose. Existing actionable validation messages,
including file-format, browser-update and size-limit guidance, remain visible;
only finite categories reach the collector. Generic transport failures use the
existing short source-recovery messages rather than exposing technical categories.

## Finite contract and privacy

`web/src/diagnostic-contract.ts` is the shared authoritative allowlist. Every row is
reconstructed after rejecting unknown keys and categories. One invalid row rejects
the whole batch. Symbols identify locally classified exceptions; arbitrary JSON
properties or error strings cannot supply diagnostic tags.

| Dimension | Purpose and bound |
|---|---|
| operation | Fixed operation families in the shared contract; keeps storage/restore and provider authorization/cleanup separate from imports |
| stage | Fixed boundary names; identifies the failed boundary without a trace |
| reason / outcome | Fixed enums, including nonfailure outcomes; no strings derived from exceptions |
| source | Twelve import methods, temporary/persistent storage, three image kinds, or `none`; checked against operation |
| mode | Manual/automatic; refresh preserves this distinction, internal storage/restore work is automatic |
| duration | Under 1 second, 1–10 seconds, or over 10 seconds; no exact client timestamp |
| instrumentation | One reviewed value, `diagnostics-1`; bump through a coordinated contract change |
| count | 1–100 per transmitted aggregate; daily aggregation retains existing retention semantics |

No HTTP dimension is added: the reviewed mappings already separate useful status
outcomes, so another cross-product is unnecessary. No release hash from the
runtime, IDs, handles, names, URLs, IPs/hashes, tokens, cookies, scores, payloads,
filenames, search text, stacks or persistent identifiers are accepted. Server
first/latest receipt bounds apply to daily action and diagnostic aggregates and
are not individual event times. Historical action rows may have null receipt
bounds; adding migration 0002 does not reconstruct their delivery history.

DNT, GPC, both disable controls, exact origins, offline/preview suppression,
request bounds, retention and owner Access checks remain in place. No Cloudflare
Logs, Traces or Logpush changes, new credentials, endpoints, or health probes are
introduced. Privacy-disabled paths neither send nor retain local delivery status.

## Delivery and reporting health

`usage.delivery()` returns a frozen in-memory snapshot. `last` is idle, disabled,
recorded, unconfirmed, network, timeout, rejected or unavailable. `schema` is
unknown, compatible or incompatible. Saturation and discarded/unconfirmed count
indicators cap at 1,000 and reset on disable; they are not persisted or sent.
`dropped` includes attempts removed without acknowledgement: a network timeout or
503 does not prove the write failed. Never interpret it as exact missing records.

The collector advertises accepted versions in `X-Maimai-Usage-Schema`. Only a
successful database batch adds `X-Maimai-Usage-Receipt: stored`. Privacy/disabled
204 responses and older 204 responses are unconfirmed. HTTP 400 is rejected; 503
is unavailable. There is no replay or retry, and telemetry failures never recurse
through telemetry. Future retries require a separate bounded deduplication design.

The owner dashboard and CLI read the new table using existing database access.
A successful read establishes readable schema compatibility, not deployed browser
coverage or current write availability. The latest known receipt establishes a
past successful write. Missing/rejected sends and opted-out operations cannot be
reconstructed. A failed/missing/truncated query produces an error, never zero.
The old action coverage ledger does not certify diagnostic coverage.

## Connector reconciliation and compatibility

The diagnostic source vocabulary includes every file and direct import method.
Provider authorization, disconnect and cleanup are separate operation families:
authorizing a connection is not evidence that scores were saved. A runtime
visibility-manifest read is an automatic configuration operation, not an import
attempt. Failed initial provider-readiness checks also produce one configuration
diagnostic; successful readiness checks and authorization status polls stay
silent. Configuration successes therefore are not a readiness-success denominator.
Finite reasons distinguish blocked popups, failed authorization, expired
connections, missing agreements, empty scores and cleanup/configuration failures.
The existing stage, cancellation, committed-success and privacy boundaries apply
to these paths too. Automatic restore and refresh produce diagnostics without
inventing version-1 user actions.

Both versions and `diagnostics-1` remain readable. The vocabulary is additive,
but an older collector rejects unknown sources/operations/reasons. Therefore the
extended collector and report readers must precede the connector browser. Old
diagnostic receipts prove only earlier accepted writes, not coverage of these new
methods. Never reinterpret historical unknown failures or sum nested operation
families as a linked incident count.

The OAuth Worker keeps reconnect-required guidance after an uncertain rotating
token exchange. Its optional `diagnosticCode` contains only a small reviewed
allowlist of the immediate failure cause; the browser reconstructs a finite
reason and never sends that field verbatim. It is not stored with the grant.
Without that cause, `connection_expired` means reauthorization is required, not
proof that expiration caused the failure. A failed renewal never replays the old
refresh token to improve telemetry.

## Release ordering

1. Recheck current production and the exact reconciled connector candidate.
2. Through the existing approved release workflow, verify current Worker/Pages/
   collector/dashboard versions and settings. Verify the already released
   `0003_diagnostics.sql` and apply pending `0002_import_receipts.sql` if needed.
   These additive migrations are independent, do not rewrite historical counts,
   and remain in place on rollback. Check recorded migration state rather than
   assuming numeric order implies that both are installed.
3. Release collector support for both versions, plus CLI and hosted dashboard
   readers for the new table. Old version 1 clients continue to work. Legacy
   `usage-export-1` files remain readable with unknown diagnostic coverage.
4. Verify the reviewed collector configuration and privacy no-op behavior before
   releasing the browser and updated import Worker. Old import Workers remain
   usable; unclassified `source_unavailable` stays unknown. New Worker errors are
   finite and old browsers can still display their generic failure message.
5. Verify fictional/consenting acceptance through the approved release process,
   record actual activation, and distinguish successful storage from no-op 204s.
   Local tests do not constitute hosted acceptance.

An old collector rejects a version 2 batch, so **do not publish the browser first**.
Version 1 and version 2 are separate requests; a diagnostic rejection cannot
invalidate an action batch. Roll back the browser before removing collector
support. Retain the additive table and accepted counts; no destructive rollback.

The reconciliation retains provider/file lifecycle counters, receipt migration
0002, committed-result callbacks, cancellation fixes and production delivery
health. Old-client and both-version tests must pass on the delivered tree. Do not
deploy PR63's historical collector over the diagnostics-capable production version.

## Validation and bounded workspaces

Fictional tests exercise real Worker responses, transport/normalization boundaries,
coordinator storage and cancellation, shared detail work, sender status and privacy,
real local D1 aggregation, strict report validation and browser export outcomes.
No live player import is part of validation. Run `tools/Test-Web.ps1 -Build` and
the relevant Worker/browser/Python checks; retain exact source and result receipts.

Where storage is constrained, `-DependencyManifest` permits read-only reuse of
DevCache dependencies with byte-identical package locks. Node resolves missing
packages through that explicit manifest; no dependency links, copied dependencies,
new install locations or source changes in disposable workspaces are needed.
Generated browser assets are built in the prepared workspace and explicitly
promoted after review. The usual path still installs locked dependencies when no
manifest is supplied.
