# Rollout and recovery: local design, not deployment approval

The canonical origin stays https://maimai.party. Use complete Pages Direct Upload
deployments and the existing owner workflow; do not add DNS switching or a routing
service. Retaining two deployments does not make every tab switch atomically.

## Two distinct recovery targets

Preserve the exact accepted hotfix artifact and deployment from the current owner
release receipt. It is the emergency recovery target. Reverify its current status
before publication; historical launch IDs in OWNER_PUBLICATION.md are not current
account evidence. An exact hotfix rollback restores the known browser, but does
not preserve newly introduced song/version routes or candidate lazy assets.

A compatibility bridge is a separate, **unproven** complete artifact: old homepage
and runtime, both versions' verified immutable asset/data closures, an explicit
policy for conflicting mutable paths, and finite new-route recovery behavior.
It must not overwrite the accepted hotfix. An inventory union is not proof that
the bridge works. Do not prepare another expanded corpus merely for this design.

Preview deployments are not native production rollback targets. To use a bridge
as a native target it must first become a successful production deployment. That
temporary production step needs separate review and authorization. It must keep
the old visible experience, sitemap/robots behavior and collection state; it must
not prematurely announce or activate the combined SEO/usage launch. If those
conditions cannot be met, retain the bridge for a complete recovery upload
instead, and describe that operation as redeployment, not native rollback.

## Asset and route compatibility

The generated graph has content-hashed chunks, but the entry point, configuration,
browser shell, manifest, permalink ledger and public route HTML use stable paths.
Define the expected bytes for every observed request in both directions. Reject
missing paths and same-path different-byte conflicts until a reviewed policy
resolves them; never choose the newest file silently.

Preserve old files at paths required by the old UI. If both runtimes require
different bytes at one mutable path, prove a shared compatible representation or
give the candidate a mechanically versioned same-origin resource reference.
Hashed modules alone do not establish their dependencies' compatibility. A
deployment hostname is not an automatic substitute: current readers and CSP
enforce same-origin constraints. No release handshake is introduced by this plan.

New song pages already include old-browser links with canonical chart identity
and locale. A top-level redirect can use that mapping, but the current candidate
fetches route HTML with redirect:error; a soft navigation to such a redirect
fails. Rehearse either retained readable static documents or a controlled full
navigation before selecting recovery behavior. Preserve genuine 404s for unknown
routes. Do not promise seamless switching.

The pure release_transition.compare_request_inventory helper accepts explicitly
supplied observed request expectations and a complete target inventory, using
FileRecord fields bytes and sha256. It binds the supplied observation-receipt
hash and reports deterministic matched, missing and conflicting paths. Its
inventory_match status means **only those declared byte expectations match**.
The caller must verify inventory and observation evidence. This helper neither
infers runtime closure nor proves responses, headers, redirects, cache behavior,
storage, Worker configuration or rollback safety. It is not a release gate by
itself and currently has no observed-browser-trace adapter.

## Same-origin rehearsal and operational sequence

Before any hosted action, switch one local origin old -> candidate -> recovery
while keeping fictional player storage, caches and old/new tabs. Cover delayed
module/config/detail requests, song-to-comparison loading, direct and historical
links, BFCache restoration, concurrent import/refresh/Forget, and interrupted
imports. Both old and current implementations use IndexedDB version 2; that
inspection is not a cross-version rehearsal or permission to reset user storage.
Keep this experiment separate from the fresh-profile isolated human preview.

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
