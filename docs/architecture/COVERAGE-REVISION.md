# Coverage revision: policy, acquisition, and durable progress

This revision preserves canonical song/chart IDs and existing accepted artwork. It adds no score authority to artwork providers. Public-source assessment is separate from website publication and has no deployment operation.

## Boundaries

- `coverage_policy.py` contains complete-identity artwork decisions and scoped review decisions. `coverage_queue.py` contains deterministic eligibility, fair ordering, and retry decisions. `provider_reconciliation.py` contains public Kamaitachi decisions. Their source/runtime dependencies are checked by the architecture gate.
- `coverage_sources.py` parses captured public source metadata and Wiki evidence. `catalog_capture.py` performs bounded allowlisted public requests and immutable capture/replay. A source failure is a typed outcome; invalid reviews and corrupt retained evidence are blockers.
- `artwork_store.py` verifies, decodes and stores images. `enrichment.py` classifies titles and projects selected song capabilities without importing artwork storage. The official inventory and numeric metadata contracts now have independent leaf modules; algorithms and constants were moved unchanged.
- `coverage.py` runs one batch. `coverage_store.py` validates and persists completed batches. `scripts/assess_coverage.py` runs a finite assessment without building or publishing a website. The existing updater checkpoints coverage before package generation and publication planning.

## Queue and failure rules

A batch selects at most 300 songs. Its first 100 positions are reserved for the oldest eligible pending work. Successfully attempted jobs move to the end of that queue, including negative results. New and changed evidence can use the other positions. Consequently daily due retries cannot permanently occupy the same first 300 positions. A synthetic 1,694-job test also injects 400 new jobs per batch and verifies the original work still progresses.

Only a song's relevant source assertions invalidate its negative result. A change to another song in a provider catalog does not requeue this song. Budget deferral acknowledges no evidence and does not increase its attempt count or move its queue position. Deferred work remains pending.

Transport, TLS verification, rate limiting, actual HTTP absence, invalid source schema, ambiguous identity, unsupported image, and budget deferral remain distinct outcomes. Retry-After is respected. Verified TLS failures and rate limits also impose a host cooldown, so other providers remain usable. Corrupt retained captures and artwork block preparation rather than becoming ordinary source outages. Stale/conflicting review decisions likewise block preparation rather than retaining a misleading successful mapping refresh.

## Sources and reviews

Priority for a missing jacket is accepted official regional evidence, pinned OTOGE metadata/artwork, public LXNS metadata/artwork, then an identity-bearing Wiki table. Existing selected artwork remains retained on failed refresh. Existing default artwork is preserved when a new regional selection becomes available.

OTOGE is pinned to `751705e5710a4c8bce3dc50573c6912e55283dd2`; its JP, International and deleted metadata lists are captured separately. LXNS uses its public song list and public resource CDN. All captures retain byte hashes and response identity. Image decoding, format/dimension limits and content-addressed output checks apply to every new selected image. LXNS production requests are serial and limited to one request per second per host.

Automatic selection requires a complete normalized title and artist, a unique accepted canonical song with that pair, and one consistent provider image URL. Blank titles, missing credits, duplicate canonical identities and conflicting image candidates do not auto-match. A focused artwork review must specify purpose `artwork`, canonical `song_id` and metadata assertion, provider-qualified `source_id`, source assertion, and supporting evidence. The review is invalid if those assertions change. This authority cannot add or modify a Kamaitachi score mapping.

`config/coverage-reviews.json` declares separate `titles`, `providers`, and `artwork` collections. New OTOGE revisions require an explicit policy change; neither a moving branch nor a jacket filename becomes canonical identity.

## Checkpoint and replay contract

The private coverage cache contains immutable `checkpoints/<sha256>/` directories and one atomic `checkpoint.json` pointer. Each completion manifest binds the accepted base, resulting registry, starting registry, work state, audit, capture receipt and every selected artwork asset. Payloads are flushed and synchronized. File bytes, individual registry table bounds, semantic registry digests and assets are verified before `complete.json` is written; the pointer is updated last.

A uniquely completed child left behind by an interrupted pointer write is verified and recovered. Incomplete directories are never treated as completed work. Ambiguous completed branches block recovery. A changed accepted base cannot import unpublished mappings; only verified artwork for an unchanged, nonredirected canonical metadata assertion can carry forward. Publication failure therefore does not erase completed coverage, alter an accepted registry, or advance a publication pointer.

Private inputs and policy identities also bind actual policy source hashes, Python implementation/version, platform/machine and Pillow version. An exact replay rejects a different producer or policy. `--reassess-captured-policy` explicitly permits reassessment of retained source captures under the current implementation and records the original input hash. Reassessment is reported separately from exact replay.

## Validation evidence

Both audited regressions failed before fixes in the immutable `20260922T154358677-d232b22a` workspace (`coverage-regressions-before.log`). The focused final-policy suite in `20260922T163045449-4e436923` passed 73 tests (`coverage-updater.log`). It includes daily retry fairness, stale review rejection, source-specific cooldown/replay, per-song invalidation, budget deferral, checkpoint interruption/corruption, semantic digest checks, producer changes, and real updater publication-failure/resume/replay behavior. Synthetic fixtures contain no player data.

The bounded JP probe is retained at `C:/DevCache/maimai-coverage-v2/jp-tls-diagnostic.json`. One verified request failed with certificate verification code 20, `unable to get local issuer certificate`, under Python 3.11.14/OpenSSL 3.5.5 with hostname checking and CERT_REQUIRED enabled. No trust store, proxy, security setting or credential was changed. This identifies the observed verification failure; it does not establish whether the missing issuer chain originates at the server or in this machine's certificate environment.

The original live sweep and its draft-producer receipts are retained under `C:/DevCache/maimai-coverage-v2/assessment-20260922`. Final-source capture reassessments are retained separately under `C:/DevCache/maimai-coverage-v2/final-source-reassessment`. Final before/after totals, exact replay, package reuse, and all original-gap dispositions are recorded in the completion evidence appended after the sweep; draft capture receipts must not be relabeled as final-source runs.

## Completed public-source assessment (22 September 2026)

The comparison starts from the accepted 1,443-jacket registry in `20260922T102804355-3201db86/output/real-coverage-final`, not the older 1,425-jacket pre-refactor baseline. All six acquisition batches completed, followed by a continuous reassessment of their immutable captures using the final LF source bytes. Both produced the same complete registry.

| Measure | Before | After |
| --- | ---: | ---: |
| Active canonical songs | 1,694 | 1,694 |
| Songs with a verified jacket | 1,443 (85.18%) | 1,561 (92.15%) |
| Songs without a verified jacket | 251 | 133 |
| Accepted Kamaitachi chart mappings | 6,796 | 6,796 |
| Kamaitachi chart mapping gaps | 455 | 455 |
| Current-policy jobs assessed | 0 | 1,694 |

The 118 additions comprise 92 pinned OTOGE jackets, 19 identity-bearing Wiki jackets, and seven official International jackets. LXNS metadata was assessed but supplied no accepted additions in this corpus. All 97 planned exact OTOGE candidates were resolved: 92 selected OTOGE and five selected higher-priority verified official International artwork (Operation☆DOTABATA!, Usagi Flap, Break The Speakers, RE Aoharu, and ソテリア). The original 97 identities and all five selection decisions are bound to captured assertions in `C:/Dev/maimai/architecture-revision-20260922/otoge-opportunity-delta.json`. This exceeds the 1,525-song/90% target without relaxing identity checks. No jacket, canonical identity, or accepted mapping was removed. All 1,690 existing default/JP/INTL selections and their image bytes are unchanged. Accepted analysis is identical; all 292 metadata-only charts still lack analysis rather than receiving synthetic profiles.

`C:/DevCache/maimai-coverage-v2/gap-dispositions.json` records every original gap: 118 resolved, 14 unresolved duplicate canonical identities, and 119 without a verified complete match. The 16-case `focused-artwork-review.json` separately records the fourteen duplicate identities, the intentional blank title, and the missing-credit POPIPO record. Existing official regional evidence supplies the latter two jackets while their canonical metadata stays unchanged. No manual exception or score-mapping authority was invented. Title-only discoveries remain discovery evidence.

All 1,694 songs made progress in six finite batches of 300, 300, 300, 300, 300 and 194. The original live captures and draft-producer receipts remain intact. The final LF run used only their retained immutable source bytes, with a fetcher and socket guard prohibiting network acquisition. Its 167.062 seconds are a local captured-source reassessment measurement, not a live-network performance claim. Previous CRLF and intermediate reassessments are preserved under their own producer identities.

Final evidence:

- Frozen source workspace: `C:/DevCache/projects/maimai-chart-browser-registry/50b28fa463dbfb9a/workspaces/20260922T165144277-c9187a68`.
- Final LF policy producer: `c430f4078a63d673b17b759396ed105b2637401a6b48d14f994aaea0ac7be7cd` (source hashes plus CPython 3.11.14, Windows AMD64 and Pillow 12.3.0).
- Complete result registry: `a6fc949ec76c98106a7444284233a88150d294ec980416acc2b5b54f1f490920`.
- Final checkpoint: `42b1ab99ba3a050a1fc55473771625c236b4c5da213269552109adc7c0c716a0`.
- Continuous assessment: `C:/DevCache/maimai-coverage-v2/final-policy-assessment-lf/summary.json`; the adjacent capture origins bind all six original receipts. The `runs/batch-06/registry` directory is the assessed registry.
- Unchanged repeat, strict replay and fresh-cache offline proof: `C:/DevCache/maimai-coverage-v2/final-policy-assessment-lf/repeat-proof.json`.
- Enriched package and full file inventory proof: `C:/DevCache/maimai-coverage-v2/final-package-lf/summary.json`, `package-inventory.json`, `package`, and `public-data.json`.

The unchanged repeat selected zero jobs and preserved the registry (5.438 seconds). Strict replay reproduced the registry and all five receipt files byte-for-byte (7.047 seconds). A fresh-cache offline preparation reused the retained package with zero acquisition or image conversion (10.547 seconds). The first enriched package built in 15.594 seconds; rebuilding from that package took 14.484 seconds and reproduced all 1,602 files and projected data exactly. These local timings are descriptive observations, not performance budgets.

The 73-case focused suite and separately added per-table-bound regression passed before the LF-only source-byte normalization. The final LF source then passed the real continuous, repeat, exact-replay, offline and package proofs above; the root validation matrix owns the complete frozen-source suite. The original failing-before tests, intermediate runs and logs were not overwritten.

Remaining limitations are explicit: 133 songs still lack verified jackets; 455 charts still lack accepted Kamaitachi mappings; the JP verified-TLS path remains blocked by the observed issuer verification failure. Coverage completion does not certify that unavailable artwork exists, resolve ambiguous identities, or authorize publication. Paid-capacity entitlement and the retained-history publication plan remain separate release gates.

## Typed-failure checkpoint and retained evidence

Independent review added a failing-before regression for a `TypeError` raised by
an acquisition adapter. Such a programming defect must abort; it must not become
an ordinary malformed-provider response. Commit `c465f0db1b3be28517fcf76d2d4b9bf527487943`
limits schema handling to invalid JSON/encoding and explicit response shape checks.
The 33 policy, persistence and acquisition boundary tests passed after this change.

All 1,694 jobs were then reassessed continuously from the original captures under
the new source identity, with networking denied. The six batches produced the
same complete registry and the same 118 new jackets. That replay's coverage producer:
`e64c13ae9de5438de62496c2ace468fcdcd545534df9384be8d70633dcb65de7`;
that replay's checkpoint:
`23ccb09c0211e00ecdcf2a07814b037e7fa5fc942888ab85f8544a32e3ce0ef5`.
The continuous assessment took 213.015 seconds under concurrent local validation.
The zero-job repeat, byte-identical five-file replay and fresh-cache offline proof
also passed (11.109, 4.891 and 7.875 seconds respectively). These are observations,
not a comparison with earlier timings. Receipts live in
`C:/DevCache/maimai-coverage-v2/final-policy-assessment-typed-failures`.
Earlier producer receipts above remain intact and are not relabeled.

Every mapping gap is now exported with canonical chart identity, source revision,
source assertion and its exact disposition: 427 lack a complete matching provider
song identity, 20 lack the exact chart slot, and eight have incomplete canonical
identity. This classification did not modify any mapping. The retained report is
`C:/Dev/maimai/architecture-revision-20260922/mapping-gap-dispositions.json`.

The human artwork sheet at
`C:/Dev/maimai/architecture-revision-20260922/coverage-review.html` contains all 251
original gaps, all 118 verified new jacket images, the sixteen focused cases and
bound evidence. It embeds hash-verified images and makes no network requests;
251 rows and 320px layout were checked in an isolated browser. The original
captures, six LF checkpoint ancestors and original receipts are retained in
`retained-coverage-evidence.zip` beside it, with a complete hashed inventory and
verified archive contents. The later typed-failure checkpoint is retained in a
separate addendum, preserving both policy identities.


## Malformed-encoding checkpoint

The final acquisition boundary also handles invalid UTF-8 from optional artwork
providers as a schema failure while allowing programming errors to abort. Its
retained offline reassessment used source `6b00cf4fa9a5028e285a502b3d599c25ee515582`
and producer `14ff767bb8718834423ea0e88260bd075e7ea666556e3ba834fcdcaa08bfe54b`.
All 18 policy input files are byte-identical in product candidate `2ef92b7` and
Python-validation candidate `7eaf285`; the exact inventories are retained in
`C:/Dev/maimai/architecture-revision-20260922/registry-evidence/final-source-metrics/validation-and-policy-binding.json`.

All six batches completed with zero socket attempts. Unchanged repeat, exact
five-receipt replay, fresh-cache offline reuse and reconstruction of all 1,602
package files passed. The complete registry hash and all coverage/integrity
counts above remain unchanged. This run supersedes earlier final-policy claims
without rewriting the original receipts.

The retained `coverage-encoding-addendum.zip` contains only new evidence blobs;
`coverage-encoding-receipt.json` maps every required path to its hash-verified
archive member, including reused content in `coverage-typed-failure-addendum.zip`.
Keep these with `retained-coverage-evidence.zip` and all three receipts. The
retained `ENCODING-REASSESSMENT.md` documents the proof and its Windows-only limit.


## Final actual capture-store correction

A later review exercised the real `CaptureStore` rather than a substituted
provider adapter and reproduced programming/persistence exceptions being
converted into provider failures. Commit `137b539e256695fdc08f4808c52477d10c1c3811`
restricts retryable transport handling to the fetch operation; unexpected code,
cache-integrity and persistence failures abort. Six focused checks passed after
the retained failing-before cases. The complete combined source at `6f386b3`
then passed 644 Python tests with seven Windows symlink capability skips.

The corrected policy was replayed across all six batches with sockets denied.
Producer `d1de56e51b80bfb58b87f93aa9b3aaa4fa50e2eade97461505cc2258605bd279`
assessed all 1,694 jobs and produced the same registry digest and coverage totals.
Unchanged repeat, exact five-file receipt replay, fresh-cache offline reuse,
two identical 1,602-file package reconstructions, six checkpoint validations,
and all retained archive/member checks passed. Every one of the eighteen policy
inputs matches final product `6f386b301aea22334805d699c98168f31cc6c819` byte for byte.

The final retained `CAPTURE-BOUNDARY-REASSESSMENT.md` and
`registry-evidence/capture-boundary-policy/policy-binding.json` distinguish the
actual replay source from the final browser revision. The complete new receipt
is `coverage-capture-boundary-receipt.json`; its delta is
`coverage-capture-boundary-addendum.zip`. Retain all four original/addendum
archives and receipts. Earlier producer identities are not relabeled.
