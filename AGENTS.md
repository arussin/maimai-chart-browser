# Scope continuity and delivery

- Treat follow-up requests as additions or corrections to the full agreed task,
  unless Adam explicitly replaces or cancels earlier scope.
- Before preparing a release, committing, pushing, or declaring work complete,
  reconcile the implementation and tests against every agreed request in the
  task, including earlier turns and work from earlier in the day.
- Include the complete agreed scope in the delivery. Do not silently omit earlier
  changes because the latest request focuses on one detail. Explicitly identify
  anything incomplete, excluded, blocked, or deferred and explain why.
- Verify the actual tree being delivered, not only an earlier preview or another
  branch. Preserve unrelated work and do not include another task's unpublished
  changes merely because they share the checkout.
- For responsive or localized UI changes, test the affected controls with all
  supported languages, relevant states and narrow widths. Check text clipping and
  overlap within controls as well as whole-page overflow.


# Architecture and validation boundaries

- Keep canonical catalog and player identities separate from display projections.
  Regional labels, artwork and generated routes must not become matching keys.
- Assemble catalog/report data through their preparation interfaces; presentation
  must not be parsed back into application data. Installed Python libraries must
  not import owner scripts or require Node.
- Edit typed browser domain/usage sources under `web/src`, build in the approved
  DevCache workspace, and explicitly promote generated assets and their manifest.
  Run `tools/Test-Web.ps1` plus the relevant Python/browser checks before delivery.
- Keep usage hooks explicit and finite. Never pass URLs, DOM text, app state,
  player data, identifiers or searches to the collector; restored state and
  automatic refresh are not deliberate user actions.
- Build publication through `plan_public_release`, retaining verified previous
  manifest references. The 20,000-file guard remains mandatory. An over-capacity
  review bundle is evidence only and is deliberately not a deployable release.
- SEO, active usage and owner reports share a combined launch gate. Local tests
  and configuration do not authorize account changes, provisioning or deployment.
