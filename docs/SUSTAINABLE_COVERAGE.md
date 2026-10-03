# Sustainable identity and artwork coverage

The ordinary catalog update pipeline owns enrichment. Every online registry preparation, including package-based preparation and `refresh`, runs the same metadata refresh, public Kamaitachi reconciliation, and bounded artwork stage before it builds the next package. Online legacy preparation resolves the checked-in registry only when every retained chart ID is bound to it; otherwise callers must supply the correct registry. Historical offline package preparation remains available.

## Durable state and public contracts

The six `maimai-registry-1` tables remain unchanged. Optional `song-enrichment-1` records on songs hold title classifications and artwork selections/history; optional `chart-enrichment-1` records hold provider reconciliation outcomes. UUIDs, canonical/raw titles, existing mappings, transcription selections and analysis identity remain authoritative.

Titles are `present`, `intentional_blank`, or `missing`. A blank string alone proves only missing metadata. An intentional blank needs a reviewed assertion against the exact raw song metadata. `config/coverage-reviews.json` retains the documented x0o0x_ blank-title evidence from accepted official records. Generated display labels never become identity or matching inputs.

Artwork is selected by song and optional JP/INTL scope. Each selection binds a same-site content-addressed path, byte count/hash, policy and provenance. Migration resolves existing chart/legacy aliases once, verifies retained bytes and preserves separate default/JP/INTL selections. A retained default remains the cross-region fallback while regional selections evolve independently. Publication projects selected references only; it omits selection history, source captures and the work queue. A retained package can hydrate accepted artwork into a fresh cache without a legacy analysis row.

Public additions are optional `title_state`, `artwork.songs[id].regions`, and compact `catalog-coverage-1` provider outcomes. `mapping-v2` gains the explicit `policy_exact` acceptance basis. Player file/offer v1 and stored personal records keep their existing contracts. Subsequent mappings can expose previously unmapped records without another import.

## Public provider reconciliation

Each online run resolves the configured Tachi public repository revision once and captures songs/charts from that immutable SHA. The receipt binds revision, source bytes and timestamps; accepted metadata is deduplicated by content and policy. Schema, reference, alias collisions and meaningful count changes are checked before matching. A source outage or schema failure preserves accepted mappings and records `failed_refresh`; contradictory existing assignments block candidate preparation.

New automatic mappings require one canonical ordinary chart and one provider chart for the complete normalized title, artist, format and difficulty. Empty normalized titles never auto-match. Scoped reviews bind an exact provider song/chart assertion, the accepted target and evidence; song reviews fill only existing supported ordinary chart slots. A Maishift review cannot authorize Kamaitachi. Provider reconciliation neither admits identities nor fabricates charts or analysis.

## Bounded artwork work

Every accepted song participates, including metadata-only and historical entries. Valid retained assets are reused first. Eligible regional official references come from accepted source observations. Wiki fallback requires an identity-bearing metadata table with matching complete title/artist and exactly one supported jacket reference. Arbitrary page images and ambiguous accepted song identities are rejected. Fixed HTTPS origins, no redirects, public DNS addresses, path checks and bounded reads apply before decoding. PNG/JPEG/WebP inputs must satisfy decoded pixel and byte bounds. Conversion uses pinned Pillow 12.3.0 and the existing 128-pixel WebP thumbnail format; conversion results are content-addressed and cached by input bytes/policy. Minimalist artwork is not rejected heuristically.

A run handles at most 300 songs and shares a 300 song-page Wiki budget with metadata discovery, reserving 100 for coverage. The oldest 100 eligible jobs precede new evidence, so repeated additions cannot starve old gaps. Pending evidence becomes processed only when attempted; a batch limit or offline pass cannot consume it. Negative results use reason-specific retry deadlines, exponential outage backoff and HTTP Retry-After. Changed relevant evidence invalidates ordinary negatives, while active 429 deadlines remain respected. Failed changed artwork retains accepted bytes and remains eligible after its retry deadline. Review fingerprints deduplicate unchanged unresolved evidence.

`CONFIG.placeholder_sha256` is an explicit reviewed denylist, initially empty. Unknown placeholders and unsupported Wiki layouts remain review gaps; they are not silently treated as a successful jacket match.

## Receipts and validation

Each candidate includes `coverage-start.json`, `coverage-inputs.json`, `coverage-state.json`, `coverage-audit.json` and `source-captures.json`. Inputs bind starting registry, configuration, title/provider reviews and selected work; captures retain immutable blobs and recorded HTTP failure details. Exact replay uses those bytes and selected work, even if newer URL pointers exist. Offline preparation validates and reuses accepted enrichment without network.

The coverage audit gives identity-level added/removed/replaced/unchanged mappings and artwork, remaining gaps, provider outcomes and JP/INTL/historical inventories. Unexplained accepted coverage loss or missing/tampered accepted asset bytes blocks preparation. `ready.json` binds candidate registry, public files, implementation/configuration and coverage receipts; it is written last. The updater additionally binds `previous-public.json` when retaining prior startup references and permalink identities; source replay requires the same preceding publication inputs. Operational queue progress stays outside accepted registry state. Preparation creates a review candidate only; publication remains a separate owner action.

Run tests through the approved DevCache environment. `tests/test_sustainable_coverage.py` covers scoped source matching, durable regional migration, repeat/offline/exact replay, changed-artwork outage/recovery, bounded queue overflow, backoff and source-cache integrity. Existing catalog update, package/distribution, waterfall and browser tests cover compatibility at their boundaries. Real acquisition evidence belongs in retained DevCache outputs with exact source receipts and observed counts; synthetic fixture gains are not live coverage claims.
