# Rollout and recovery: local preparation, not deployment approval

The canonical origin stays https://maimai.party. Use complete Pages Direct Upload
deployments and the existing owner workflow; do not add DNS switching or a routing
service. Retaining two deployments does not make every tab switch atomically.

## Two distinct recovery targets

Preserve the exact accepted hotfix artifact and deployment from the current owner
release receipt. It is the emergency recovery target. Reverify its current status
before publication; historical launch IDs in OWNER_PUBLICATION.md are not current
account evidence. An exact hotfix rollback restores the known browser, but does
not preserve newly introduced song/version routes or candidate lazy assets.

A compatibility recovery package is a separate complete artifact: old homepage
and runtime, both versions' verified immutable asset/data closures, explicit
ownership of conflicting paths, and finite new-route recovery behavior. It must
not overwrite the accepted hotfix. The installed composition and assembly code
supports local file preparation; a complete production recovery package remains
unproven. Do not prepare another expanded corpus merely to explore this design.

Preview deployments are not native production rollback targets. To use a recovery
package as a native target it must first become a successful production deployment.
That temporary production step needs separate review and authorization. It must
keep the old visible experience, sitemap/robots behavior and collection state;
it must not prematurely announce or activate the combined SEO/usage launch.
If those conditions cannot be met, retain the package for a complete recovery
upload instead, and describe that operation as redeployment, not native rollback.

## Implemented resource and assembly boundaries

The candidate's generated module graph, including its entry, has content-named
paths. Every activating document embeds a validated resource descriptor binding
its configuration, shell, catalog directory, styles and optional permalink/SEO
resources to exact content hashes and lengths. Runtime reads use those immutable
references; the root browser-resources.json is diagnostic, not a startup lookup.
Logical root aliases remain for compatibility. Public route HTML, homepage and
platform configuration still use mutable paths and need explicit ownership.

Preserve the old runtime at its existing URLs with its accepted bytes. A query
cache version is not a separate static file. Keep candidate immutable assets for
already-open tabs even when recovery stops new candidate activation. Their
presence prevents missing-resource failures; it does not disable code already
running or prove a route-level rollback. A deployment hostname is not an automatic
substitute: current readers and CSP enforce same-origin constraints.

The installed release_composition planner requires an explicit source, hash and
reason for every path in both input inventories. It preserves both declared
runtime closures and enforces the 20,000-file/25 MiB default profile. The installed
release_assembly adapter verifies complete inputs, writes a fresh output, checks
its exact inventory and input stability, then installs a private completion receipt.
Neither discovers runtime closures or proves browser, route or hosted behavior.
Generated recovery replacements must enter preparation and explicit ownership
before assembly; never patch the assembled output after its receipt is written.

The release_transition.compare_request_inventory helper compares explicitly
supplied observed byte expectations with a complete target inventory and binds
the observation-receipt hash. Its inventory_match means only those expectations
match. Callers must verify the observations and inventory. It does not establish
headers, redirects, cache behavior, storage, Worker configuration or rollback safety.

## Remaining finite route recovery

The current miniature recovery package retains candidate song/version documents.
Those still activate candidate code, so it demonstrates homepage composition,
not recovery from a defect in the candidate application. Implement the following
policy before calling the package a route-compatible recovery target:

1. Derive a finite recovery record for each actually emitted song/version route
   from PreparedSEO and its validated ledger. Do not infer routes from arbitrary
   filenames or assume every historical ledger entry has a current document.
   Keep unknown paths as genuine 404s.
2. Generate localized static recovery documents at those exact routes. Preserve
   public song/chart facts, version song lists, artwork, canonical URLs and
   reciprocal language links. Omit candidate application activation and remove
   or disable controls that would otherwise be inert. This is an explicit
   temporary reduction in interactivity during recovery.
3. Bind browser links to the accepted baseline's real URL contract. The hotfix
   loader consumes ?version= for a retained catalog; its browser resolves
   ?view=catalog&chart= through canonical/legacy chart identities. Verify the
   selected catalog contains each target before emitting that link. Candidate-only
   or ambiguous identities remain static; never invent a fallback chart.
4. Do not rely on ?release= or ?lang= to reproduce a version filter or locale in
   the hotfix. Its version filter starts empty, and its locale comes from saved
   preference or browser negotiation. Keep version recovery lists and localized
   public information in the static documents rather than promising unsupported
   old-browser behavior. Existing ordinary links can still open the baseline.
5. Add a narrowly validated recovery marker that the navigation coordinator
   recognizes before loading or constructing browser/song components. It should
   perform one full navigation to the same known canonical recovery route, where
   no candidate application activates. Validate route identity and marker shape;
   preserve generation cancellation and same-origin/redirect restrictions.
   Arbitrary missing or malformed pages must not become recovery instructions.

The marker must cover a direct-arrival song page paused before re-fetching itself.
Currently ordinary pushed/restored route failures fall back to full navigation,
whereas this self-fetch exception shows catalogFailure. Do not generalize all
fetch failures into recovery or promise seamless transient-state restoration.
An already-running tab may keep executing until a navigation or reload; retaining
its resources and stopping new activation are separate requirements.

Test exact emitted/recovery route-set equality, all four languages, song and
version direct arrivals with/without JavaScript, valid baseline chart/catalog
links, candidate-only identities and unknown 404s. Assert no candidate activation
on fresh recovery documents. Exercise paused self-fetch, song-to-song navigation,
comparison loading, Back restoration, newer-intent cancellation, malformed markers
and bounded navigation without loops. Validate _headers, _redirects, robots and
sitemap ownership explicitly; preserving root bytes alone is insufficient.

## Same-origin rehearsal and operational sequence

The miniature local harness uses the accepted legacy runtime with authored
fictional catalog data, then switches one origin old -> candidate -> recovery.
It exercises Chromium, Firefox and WebKit without accessing personal profiles.
The current rehearsal is in progress; final results belong in exact-source
receipts. It is not a full-corpus or hosted acceptance result. Its static server
does not model Cloudflare headers, redirects, cache propagation or deployment time.

Before any hosted action, complete the route cases above and retain the existing
delayed runtime/resource, remembered-player and cross-tab Forget regressions.
Extend coverage to actual detail/comparison requests, direct/historical links,
BFCache restoration and interrupted import/refresh. Both implementations using
IndexedDB version 2 is not proof of cross-version storage compatibility or
permission to reset user storage. Keep the fresh-profile isolated human preview
and un-intercepted performance harness separate from transition rehearsals.

Then use owner-authorized restricted staging with separate collector storage.
Verify signed-out denial on base, preview and custom hostnames before exposure.
Production keeps its exact origin predicate. Record exact Pages, Worker code and
configuration, routes, D1 binding/schema, effective logging and owner reporting
inputs. The checked-in all-zero D1 binding is a placeholder, never deployable.

Pages and Worker changes are not one atomic transaction. Mark the controlled
cutover in progress until SEO, collection, a nonpersonal canary and owner reports
all pass. On recovery, use the independent server collection kill as necessary,
restore or upload the selected complete Pages artifact, and verify both new and
already-open tabs. Preserve accumulated D1 totals and additive schemas. Record
partial/off coverage honestly; a failed query is not measured zero.

Retain the 20,000-file default guard, 25 MiB asset limit and 20 GiB working-set
guard. Any paid capacity profile requires current verified entitlement, cost and
upload evidence bound into the release receipt. No hosting, account, security,
production, Worker, permission or automation change is authorized by this doc.
