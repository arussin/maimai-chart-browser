# maimai.party Search Visibility + Private Usage Measurement

## Mission

Implement one coordinated architectural upgrade to `arussin/maimai-chart-browser` with two required outcomes delivered together in one production feature release:

1. **Search visibility:** make the public maimai catalog genuinely crawlable through canonical song pages and version landing pages.
2. **Anonymous product usage measurement:** add sparse first-party counts of broad pages and meaningful feature actions without visitor/session identifiers and without depending on Google Analytics consent.

These projects share routing, page-lifecycle, performance and regression concerns, so design them together.

Implementation changes must remain separately reviewable and independently reversible for emergency recovery. **They must launch together.**

### Combined launch requirement

The production release must include canonical song pages, version-prefiltered landing pages, **active first-party page/action logging**, and the working private reporting tool.

Logging is not complete merely because its code is merged or its collector is deployed. Before the feature is declared launched, verify that the deployed browser sends the intended events, the dataset receives them, and the owner report correctly reads those counts.

SEO, logging correctness, privacy/account checks, and **no material performance regression** are all acceptance gates for the combined release. If a required gate remains unresolved, hold the combined launch rather than quietly shipping SEO without logging. Any reduced-scope launch requires Adam’s explicit approval.

Repository:

`arussin/maimai-chart-browser`

Existing umbrella issue:

`#38 — SEO: add indexable song + version landing pages with zero material performance regression`

Do not create another issue merely because telemetry is being integrated into the plan.

---

# 0. Previously verified repo state

The following observations were recorded during the original handoff’s repository review; they were not rechecked for this release-requirement revision. Reinspect before editing:

- Issue #38 is open and has no comments.
- The current public release treats maimai.party as **one canonical document**.
- `sitemap.xml` currently contains only `https://maimai.party/`.
- `robots.txt` already references the sitemap.
- `public_release.py` currently enforces the Cloudflare Pages public-file ceiling of **20,000 files**.
- Current navigation consists of the broad views:
  - catalog/charts
  - patterns
  - compare
  - about
- `view-navigation.js` changes `?view=...` with `history.replaceState()` and emits:
  - `maimai:viewchange`
- `analytics.js` listens for that event and emits GA page views only after opt-in.
- GA deliberately exposes only four synthetic locations:
  - `/charts`
  - `/patterns`
  - `/compare`
  - `/about`
- GA deliberately does **not** send the real URL, query, hash, selected chart, searches, player identifiers or other application data.
- The current SEO documentation explicitly says the existing app still supplies catalog content through JavaScript.
- The current publication architecture is static Cloudflare Pages Direct Upload using an accepted catalog.

Do not undo those privacy properties accidentally while adding SEO routes.

---

# 1. Non-negotiable product constraints

## Homepage

Do **not** add visible SEO copy to the homepage.

No:

- introductory SEO paragraph
- keyword block
- fake footer content
- hidden keyword content
- homepage redesign solely for search engines

Head metadata may be improved where appropriate.

## Performance

There must be **no material performance regression** to the existing browser.

In particular:

- new SEO pages must not inflate the normal homepage bundle because they exist
- the entire catalog must not be duplicated into every song page
- lightweight SEO routes must not boot the full application merely to record telemetry
- telemetry must never block rendering or a user action
- runtime SSR must not be introduced if static/build-time generation solves the problem
- search-engine architecture must not convert normal browsing into thousands of runtime requests

Performance is an acceptance gate.

## User experience

Preserve current behavior unless a change is strictly necessary to support stable routes.

Do not redesign:

- search
- filters
- imports
- player data
- compare
- reports
- sharing
- support/payment flows

## Data/privacy

No private user, score, imported-player, report, token or session content may become:

- generated HTML
- metadata
- sitemap content
- telemetry
- logs
- public static artifacts

---

# 2. Target public URL architecture

## Song pages

Every canonical public song receives one stable indexable route.

Preferred conceptual shape:

`/songs/<stable-song-slug>/`

The exact trailing-slash convention should follow one deliberate canonical policy.

Examples conceptually:

`/songs/oshama-scramble/`

`/songs/garakuta-doll-play/`

The slug system must be designed before mass generation.

Requirements:

- deterministic
- stable over time
- Unicode-safe
- collision-safe
- punctuation-safe
- supports Japanese/non-Latin titles
- handles duplicate song names
- avoids arbitrary URL churn when mutable metadata changes

Do not assume ASCII romanization is necessarily the right answer.

If stable internal catalog identity needs to participate in collision handling, keep the visible URL reasonably human-readable.

Document the algorithm and test it.

## Version landing pages

Every supported release/version receives one canonical landing route.

Conceptually:

`/versions/magical/`

`/versions/prism-plus/`

These routes should be generated from authoritative version data rather than a parallel hand-maintained SEO list.

Fresh navigation to the route must:

1. make the page meaning clear in initial HTML
2. contain ordinary crawlable links to songs in that version
3. open/integrate with the existing application in the corresponding version-filtered state

Automatic route initialization is **not** a user filter action.

## Optional song index

A lightweight:

`/songs/`

is useful if it can be generated cheaply.

It is not mandatory if the version graph plus sitemap already gives adequate discovery.

It does not need prominent homepage placement.

Do not create one gigantic expensive interactive page solely for SEO.

## Do not expose arbitrary filter permutations

Do not generate indexable URLs for every combination of:

- level
- genre
- chart type
- region
- personal status
- search text
- comparison
- arbitrary filter state

Curated version pages are intentional.

Faceted-navigation explosion is not.

---

# 3. Initial HTML contract

A search crawler must understand a song/version page without booting the entire existing application.

Representative raw response for a song must contain, where available from existing public data:

- unique `<title>`
- meta description
- canonical URL
- semantic song title
- artist
- version
- genre/category
- BPM
- available chart/difficulty summary
- appropriate chart metadata already considered public
- existing pattern/tag information where sensible
- ordinary crawlable links
- version relationship

A version page must expose:

- version name
- factual metadata/title
- canonical
- list/links for songs belonging to it

Do not generate made-up content merely to make pages longer.

Use the authoritative existing catalog.

---

# 4. Generation architecture

The preferred shape is:

**accepted canonical catalog
→ build-time SEO generator
→ compact static song/version documents
→ shared static assets where required**

Do not create another independent SEO database.

The existing catalog remains the source of truth for:

- application data
- SEO pages
- sitemap
- version membership

## Important scale check

`public_release.py` currently caps public output at **20,000 files**.

Before implementing the full corpus, calculate:

- current public file count
- generated song count
- generated version count
- any per-page assets
- sitemap artifacts
- expected future catalog growth

A single HTML document per song is likely manageable, but prove it against the release builder rather than assuming.

Do not generate duplicate JS/CSS/data files per route when shared immutable assets suffice.

---

# 5. Shared navigation contract

This is the main architectural bridge between SEO and usage measurement.

Introduce or evolve a **single semantic navigation lifecycle**.

The routing layer may internally know the actual route/song/version identity, but telemetry must receive only a broad category.

Approved page categories:

- `charts`
- `patterns`
- `compare`
- `about`
- `song`
- `version`
- `song_index` only if `/songs/` exists

## Counting behavior

### Direct song arrival

One:

`page_view: song`

### Direct version arrival

One:

`page_view: version`

### Hydration / JS initialization of that same page

No second view.

### Song A → Song B

Another:

`page_view: song`

even though the broad category is unchanged.

Therefore:

**Do not deduplicate telemetry solely by page type.**

The router may use a route identity internally to know that a genuine navigation happened.

That identity must be stripped before the telemetry boundary.

### Browser Back / Forward

Count one genuine reactivation/navigation.

Do not double-fire because both router logic and `popstate/pageshow` noticed it.

### BFCache restore

Define one tested behavior for a real return.

Do not count both `pageshow` and another router callback.

### Version route applies its filter

No `filter_first_used`.

It was initialization, not deliberate filter interaction.

### Remembered filters or player data restore

No filter/import action.

### Rerender

No page view.

### Search/filter state mutation

No page view merely because state or the URL changed.

### Redirect

Count the final active canonical page, not the compatibility/intermediate document.

### Prefetch/prerender

No visitor event until activation.

---

# 6. Preserve the existing GA boundary

Do not convert the new route architecture into raw GA page paths.

The existing four-page GA model is intentionally sanitized.

Do not accidentally:

- enable GA automatic page views
- send `location.href`
- send canonical URLs
- send `/songs/foo`
- send titles containing the song name
- enable a second Google tag
- turn enhanced measurement back on

Unless separately approved, GA should continue representing the broad existing application views only.

The new first-party usage system is separate.

---

# 7. First-party usage measurement architecture

The intended flow is:

**explicit application semantic action
→ small client validator/counter
→ same-origin `/__usage`
→ dedicated Worker
→ dedicated aggregate-oriented dataset
→ owner-only report**

Do not route this through GA.

Do not add another browser analytics SDK.

## Client

Create one small first-party module, conceptually:

`usage.js`

It receives only known event types and finite enums.

No generic analytics object.

No generic `metadata`.

No arbitrary context dictionary.

Feature code should call semantic hooks such as:

`import_completed(file)`

rather than passing a file/import object.

## Collector

A dedicated Cloudflare Worker, isolated from:

- payments
- private reports
- catalog generation

Exact route:

`/__usage`

or another equally narrow dedicated path.

Do not place the Worker in front of all site traffic.

Before production configuration, recheck current Cloudflare:

- routes
- bindings
- permissions
- quota sharing
- account plan
- Analytics Engine availability/retention
- logging settings

Inherited September 21 assumptions are not a substitute for checking the actual account.

---

# 8. Telemetry schema

Use a versioned finite contract on both ends.

Conceptually a stored counter contains only:

- schema version
- event
- broad page category
- approved finite detail
- validated count
- platform receipt timestamp

No arbitrary strings.

Unknown fields should cause rejection.

## Strictly prohibited

Never transmit/store:

- song name
- artist
- song ID
- chart ID
- pattern ID
- SEO slug
- canonical route
- real URL
- query
- fragment
- referrer
- search text
- selected level
- selected version
- selected filter value
- username
- Maishift ID
- Kamaitachi ID
- profile ID
- filename
- scores
- achievements
- history
- imported-record count
- recommendations
- raw errors
- arbitrary exception text
- geography/device dimensions
- client action timestamp
- visitor ID
- session ID
- batch ID intended for correlation
- fingerprint
- hashed network identifier

Public song information appearing in SEO HTML does **not** mean it is approved for telemetry.

---

# 9. Initial action dictionary

Instrument actual existing features only.

Do not create a feature simply because an event is listed.

## Navigation

`page_view`

Detail: none beyond broad page category.

## Discovery

`settings_opened`

`filters_opened`

## Filters

`filter_first_used`

Allowed detail = fixed filter category only.

Examples:

- level
- version
- region/international
- genre
- whatever categories actually exist after code inspection

Never value.

Emit once per category per loaded document.

`filters_reset`

Only explicit reset.

## Search

`search_used`

Allowed detail = fixed search surface only.

No search text or results.

## Chart exploration

`chart_opened`

No chart identity.

`chart_section_opened`

Finite section enum such as:

- flow
- patterns

only where actual controls exist.

## Comparison

`compare_requested`

`compare_loaded`

`similar_requested`

Use finite mode/surface enum only where needed.

## Imports

`import_opened`

`import_started`

`import_completed`

`import_failed`

`import_cancelled`

Allowed detail:

- finite method enum
- coarse finite failure category

`import_completed` means validated data was successfully applied.

Closing a dialog is not success.

Restoring remembered results is not an import.

Do not infer cancellation from absence of success.

Add Maishift or hosted-session methods only when those actual integrations exist.

## Personal-data controls

`data_action`

Allowed detail:

- show
- hide
- forget

## Sharing

`share_opened`

`share_destination_clicked`

Allowed provider enum.

This means a handoff was clicked, **not** that the user published a post.

`share_native_result`

Allowed:

- resolved
- cancelled
- failed

`share_copied`

Only after clipboard operation succeeds.

## Resources

`resource_opened`

Finite provider enum such as:

- youtube
- mai_notes

This does not mean watched/read.

`report_issue_opened`

Feedback activation only.

---

# 10. Transport/privacy rules

Client state is transient only.

No telemetry state in:

- cookies
- localStorage
- sessionStorage
- IndexedDB
- service-worker persistent queues

The module must not read:

- GA identity/cookies
- player storage
- imported profile contents

Use bounded in-memory counters.

Batch sparse events instead of a request per click.

Initial engineering budgets:

- ≤ roughly **5 KiB compressed** additional client instrumentation
- ≤ **4 KiB** request
- ≤ **16 counter rows**
- one bounded pending queue
- short sparse flush interval
- best-effort exit flush

Budgets are ceilings to test, not targets to fill.

Transport should explicitly use privacy-oriented request controls:

- same-origin
- credentials omitted
- no referrer
- no redirects
- no cache dependency

Never await telemetry from:

- navigation
- filtering
- import
- share
- rendering
- comparison

Failure means **drop telemetry**, not degrade the product.

---

# 11. Collector validation

Treat the endpoint as hostile public input.

Validate:

- exact production hostname
- exact path
- POST only
- expected content type
- supported schema version
- maximum bytes while reading
- maximum row count
- enum values
- integer count range
- allowed field combinations

Reject:

- unknown keys
- nested arbitrary objects
- invalid enums
- excessive strings
- fractional/negative/nonfinite counts
- query parameters on collector route
- malformed batches

Rebuild the storage record from validated fields.

Do **not** pass the browser request object directly into the dataset.

Do not echo submitted data.

Origin/Fetch Metadata checks are useful browser safeguards but are not authentication against bots.

---

# 12. Logging boundary

Audit Cloudflare invocation logging/tracing for this Worker.

Usage records must not intentionally persist:

- source IP
- user agent
- cookies
- request headers
- request IDs
- raw request body
- full URL

Do not `console.log()` payloads.

Do not disable unrelated Cloudflare security features merely to satisfy this design.

---

# 13. Privacy activation gate

The system is intended to be independent of Google Analytics opt-in.

That does **not** mean “cookieless = universally exempt from privacy requirements.”

Before enabling collection in production, explicitly review:

- applicable privacy basis
- existing disclosure text
- processor arrangements
- retention
- objection mechanism
- regional rules
- GPC/DNT behavior

GPC/DNT suppression remains the conservative intended behavior.

If production policy requires a user-facing control that conflicts with the current requirement of no new UI:

**do not silently add it and do not silently ignore the requirement.**

Leave the affected collection disabled, hold the combined launch, and surface the decision to Adam. Do not treat an unresolved telemetry policy gate as permission to launch SEO alone. Any reduced-scope launch requires Adam’s explicit approval.

Any required suppression should stop the request in the browser where appropriate, not transmit it first and discard server-side.

The privacy statement should promise only what is defensible:

the usage dataset is designed without visitor identifiers and does not contain user/player/search/song identities.

Do not promise mathematical anonymity or claim Cloudflare processes no network information.

---

# 14. Private reporting

Reporting is part of v1.

Do not build collection with no practical way for the owner to interpret it.

Provide an owner-run reporting path that can produce:

- readable Markdown or HTML
- CSV
- JSON

Include:

- date range
- UTC boundaries
- America/New_York reporting timezone
- telemetry schema/instrumentation version
- activation date
- coverage caveats
- sampling caveats
- query failures
- distinction between zero and unavailable/not-instrumented

Useful groups:

- broad page views
- feature adoption
- filter-category use
- chart exploration
- compare starts/loads
- import lifecycle
- coarse import failure reasons
- sharing handoffs
- resource-link use

Do not claim:

- unique people
- unique sessions
- per-person funnel
- retention cohort
- source attribution
- cross-device identity
- accurate owner exclusion

Do not divide GA users by first-party action counts and call that a conversion rate.

Do not schedule recurring exports without separate authorization.

---

# 15. Unified performance program

Measure **three distinct states**:

## A. Current production-equivalent baseline

Before SEO.

## B. SEO-only

New routes/generation, telemetry disabled/absent.

## C. SEO + telemetry

Both code paths enabled in the test environment.

This separation is important for attribution. **These are development and testing stages, not separate public launches.** Production acceptance requires the combined state to pass.

Measure at minimum:

### Main application

- homepage bytes transferred
- JS transferred
- JS executed
- main bundle sizes
- request count
- Lighthouse
- LCP
- CLS
- INP or available interaction equivalent
- TBT where relevant
- search timing
- filter timing
- chart-open timing

### Build/release

- build time
- public file count
- output bytes
- largest file
- generated page count
- sitemap size
- release validation time

### Lightweight SEO route

Measure:

- document bytes
- JS loaded
- number of requests
- LCP
- hydration/init work if any

The existence of SEO pages should ideally have near-zero cost for a user who opens `/`.

Record absolute changes and test variance.

Do not treat a percentage threshold as automatic permission for a regression.

Investigate any meaningful increase.

---

# 16. Proof-of-concept phase

Do not generate the entire catalog first.

Implement a representative POC:

## Songs

3–5 pages including:

- ordinary ASCII title
- Japanese/non-Latin title
- punctuation-heavy title
- duplicate/collision-risk case if available

## Versions

2 version routes.

## SEO infrastructure

- canonical handling
- initial HTML
- sitemap entries
- links
- version prefilter

## Telemetry synthetic integration

Add the navigation contract and test payloads **without enabling production collection**.

Test:

- direct song arrival
- direct version arrival
- song → song
- version → song
- browser back
- browser forward
- reload
- hydration/init
- BFCache where supported
- redirect
- prefetch/prerender if applicable
- automatic version filter
- remembered state

Before expanding to all songs:

1. inspect raw HTML
2. run functional tests
3. run privacy tests
4. run performance comparison
5. verify file-count scaling
6. verify no duplicate navigation events

Only then mass-generate.

---

# 17. SEO test matrix

Automate at least:

## Slugs/routes

- deterministic route
- punctuation
- Unicode
- duplicate names
- aliases
- changed mutable metadata
- canonical redirect behavior
- trailing slash
- case behavior
- query noise

## Raw HTML

Representative song/version response contains:

- title
- description
- canonical
- expected factual content
- crawlable links

Test with JS disabled where practical.

## Sitemap

- valid XML
- all intended canonical songs
- all intended versions
- no duplicate URLs
- no private routes
- no reports
- no support/payment routes
- no arbitrary filter combinations

## Existing features

Regression coverage:

- search
- filter
- chart opening
- compare
- patterns
- import
- sharing
- player state
- support/payment isolation

---

# 18. Telemetry adversarial tests

Use synthetic sentinels such as:

- `PRIVATE_PLAYER_123`
- `PRIVATE_SEARCH_日本語`
- `score=100.5`
- fake filenames
- fake song slugs
- fake canonical URLs
- thrown error messages
- fake provider IDs

Intercept every telemetry request.

Assert none of those values appear.

Verify requests have:

- no Cookie header from this system
- no Referer
- no identifying custom header

Verify:

- malformed schema rejected
- oversize rejected
- unknown enum rejected
- invalid count rejected
- partial malformed batch produces no partial writes
- failures do not affect UI
- collector offline does not affect UI
- collector slow does not affect UI
- collector 500 does not affect UI
- GPC/DNT suppression follows approved policy
- test/preview/local builds do not touch production telemetry

Keep synthetic reporting/testing out of the production dataset.

---

# 19. Development workflow

Before operating on Windows:

Read:

`C:\Dev\general\development-layout-plan\MIGRATION-REGISTER.md`

The migration register decides the authoritative local project location.

Do not revive old paths merely because they appeared in a previous conversation or document.

Honor the established layout:

- canonical ordinary source: `C:\Dev`
- per-project/worktree envs, node_modules, caches, disposable builds: `C:\DevCache`
- shared toolchains: `C:\DevTools`
- protected credentials/runtime controls: approved `C:\Protected` workflow

Never:

- use a shared global Python environment
- hide dependencies in `C:\Dev` with junctions/symlinks
- edit disposable Node copies
- automatically copy edits back from disposable copies

- record the actual deployment, activation, verification and rollback state

The collector may be provisioned before the public release while browser collection remains disabled. That is rollout sequencing, not permission for a separate SEO-only feature launch.

Do not declare the combined feature launched until SEO, active logging and working private reporting have all been verified. If production verification fails, treat the release as incomplete and use the rollback procedure as needed; do not silently redefine the deliverable as SEO-only.

Do not run an unrelated catalog refresh solely for this publication.

---

# 21. Independent emergency rollback

Independent rollback remains an emergency safeguard, not permission to defer logging or launch the feature in stages.

## SEO

Keep a known-good prior Pages deployment.

If SEO routing breaks:

- revert/restore prior public deployment
- preserve stable URL mapping records so published URLs do not silently get reassigned later

## Telemetry

Telemetry rollback must not affect SEO.

Provide:

1. collector write-disable/kill control
2. client-side suppression/removal deployment to stop requests when necessary

A server write kill switch alone does **not** stop browsers from transmitting.

Disabling telemetry must not affect:

- site browsing
- SEO pages
- payments
- reports
- player data

An emergency logging shutdown may temporarily leave SEO online to protect the site or privacy. Record that state as degraded/incomplete and notify Adam. Retaining SEO-only as a reduced-scope release requires Adam’s explicit approval.

Do not delete datasets/evidence as part of routine rollback unless explicitly authorized.

---

# 22. Definition of done — SEO

The SEO workstream satisfies its component acceptance checks when:

- every canonical public song has one stable indexable URL
- every supported version has one stable indexable landing page
- version pages initialize the correct filter
- initial HTML is useful without full-app execution
- titles/descriptions/canonicals are unique and factual
- sitemap is generated automatically
- crawlable internal linking exists
- no private content is exposed
- slug/collision behavior is tested
- production routes are verified
- existing browser behavior still works
- homepage remains visually unchanged for SEO purposes
- no material performance regression is demonstrated

Passing these SEO checks alone is **not** sufficient to launch the feature. The telemetry requirements and combined production gate below must also pass.

---

# 23. Definition of done — telemetry implementation

Code can be called implemented when:

- finite event schema exists
- browser sender uses bounded memory
- meaningful action hooks are explicit
- collector strictly validates/rebuilds fields
- no identifiers are introduced
- reports work against synthetic data
- private sentinel tests pass
- failure/offline tests pass
- performance budgets pass
- GA behavior remains unchanged
- production collection is still distinguishable as enabled or disabled

Do not call it “live” merely because code was merged.

---

# 24. Definition of done — combined production launch

The combined feature is launched only when all SEO and telemetry implementation acceptance checks above pass **and**:

- policy gate is approved
- production Worker is deployed
- correct route is active
- production client sending is intentionally enabled
- real browser requests have been inspected
- dataset writes have been verified
- private report reads them correctly
- exclusions/suppression behave as approved
- there is no production-data pollution from tests
- activation time/version are recorded
- combined production verification confirms canonical song pages, version-prefiltered landing pages, active page/action logging and working private reporting in the same release
- combined performance measurements show no material regression

SEO with logging disabled, a deployed collector receiving no verified events, or logging without a working private report does **not** satisfy this launch requirement.

Use explicit state language:

- proposed
- implemented
- tested
- merged
- deployed
- enabled
- verified receiving production data

Never collapse those states into “done.”

---

# 25. Complexity assessment

Treat this as a **moderate-high architectural project, approximately 7/10 overall**, because it combines:

- static-route generation at catalog scale
- URL stability
- crawler semantics
- existing SPA/state integration
- careful navigation lifecycle design
- performance preservation
- strict privacy instrumentation
- Cloudflare Worker/data/reporting configuration
- production verification

The actual algorithms are not unusually difficult.

The risk comes from touching several boundaries that must remain correct simultaneously.

The staged POC is therefore mandatory.

Do not attempt a one-pass full-catalog rewrite.

---

# 26. Proposed update to GitHub issue #38

Do **not** create a second issue.

Add/replace the implementation checklist in #38 with an umbrella checklist along these lines:

## Architecture/baseline
- [ ] Re-read migration register / repo development guidance
- [ ] Inspect current dirty state before editing
- [ ] Capture homepage/build/performance baseline
- [ ] Calculate current and projected public file counts
- [ ] Approve song slug/collision strategy
- [ ] Approve shared semantic navigation contract
- [ ] Finalize first-party finite telemetry schema
- [ ] Record telemetry privacy/account activation gates
- [ ] Record that SEO, active logging and working private reporting must launch together; unresolved required gates hold the entire launch

## SEO proof of concept
- [ ] Generate 3–5 canonical song pages
- [ ] Cover non-Latin title
- [ ] Cover punctuation-heavy title
- [ ] Cover collision/duplicate-title case
- [ ] Generate 2 version landing pages
- [ ] Make version routes initialize correct filter
- [ ] Add representative sitemap entries
- [ ] Verify useful raw HTML
- [ ] Verify internal links/canonicals
- [ ] Verify no homepage visual SEO copy
- [ ] Pass SEO-only performance gate

## Shared lifecycle / synthetic usage tests
- [ ] Define one committed-navigation signal
- [ ] Direct song arrival counts once
- [ ] Direct version arrival counts once
- [ ] Hydration does not duplicate
- [ ] Song → song counts as new navigation
- [ ] Back/forward/BFCache behavior tested
- [ ] Redirect/prefetch behavior tested
- [ ] Automatic version filter does not count as filter use
- [ ] No route/song/version identity enters telemetry
- [ ] Existing sanitized GA model remains unchanged

## Full SEO generation
- [ ] Generate all canonical song routes
- [ ] Generate all supported version routes
- [ ] Resolve/report all slug collisions
- [ ] Generate complete sitemap
- [ ] Verify private routes excluded
- [ ] Validate Cloudflare Pages file limits/build scale
- [ ] Run full regression suite
- [ ] Pass SEO production-equivalent performance gate; hold publication for the combined release

## First-party usage implementation
- [ ] Add small bounded browser sender
- [ ] Add explicit semantic action hooks
- [ ] Add strict versioned schema
- [ ] Add dedicated path-limited Worker
- [ ] Add dedicated aggregate dataset
- [ ] Disable/raw-log audit completed
- [ ] Add private Markdown/HTML + CSV/JSON reporting
- [ ] Add adversarial privacy tests
- [ ] Add offline/blocked/slow/failure tests
- [ ] Confirm no new public UI
- [ ] Confirm telemetry remains production-disabled pending activation review

## Combined verification
- [ ] Compare baseline vs SEO-only
- [ ] Compare SEO-only vs SEO+telemetry
- [ ] Homepage bytes/bundle unaffected materially
- [ ] Web Vitals acceptable
- [ ] Search/filter/chart interaction timings acceptable
- [ ] Lightweight SEO page cost acceptable
- [ ] Build/file-count scalability acceptable
- [ ] Confirm SEO-only and SEO+telemetry builds are measurement stages, not separate public launches

## Combined production release — SEO + active logging + reporting
- [ ] Telemetry policy/objection decision complete
- [ ] Cloudflare quota/cost/routes/logging/bindings checked
- [ ] Telemetry kill switch tested
- [ ] All SEO, logging, reporting, privacy/account and combined performance gates pass before launch
- [ ] SEO pages and active first-party logging released together
- [ ] SEO production deployment verified
- [ ] Representative song URL verified
- [ ] Representative version URL verified
- [ ] Sitemap/robots verified
- [ ] Search Console inspection prepared/performed
- [ ] Production collection intentionally enabled
- [ ] Deployed-browser page/action requests inspected
- [ ] Real production dataset write verified
- [ ] Owner report verified against received production counts
- [ ] Activation/deployment/rollback state recorded
- [ ] Combined feature declared launched only after SEO, logging and reporting are all verified; no reduced-scope release without Adam’s explicit approval

---

# Central implementation rule

**Make the public catalog crawlable through static, stable routes; make those routes observable only through content-free semantic events; and make neither feature impose a meaningful performance cost on users who never need the other.**

SEO and telemetry should share lifecycle design and tests.

They should not share failure domains.

**They must launch together, with active page/action logging and working private reporting.**
