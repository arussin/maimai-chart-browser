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

# Bounded local verification workspaces

- Read `C:\Dev\maimai\WORKSPACE-RETENTION.md` before creating build/test copies. Reuse one unchanged prepared source revision for its checks. Finish manual preparations and keep compact receipts rather than every expanded intermediate build.
- Use the lifecycle-aware `tools/Test-Development.ps1` and `tools/Test-Web.ps1`. The latter completes its preparation on success or failure. Use `-KeepWorkspace` only for the selected current environment or unique retained evidence.
- Retain one production baseline and one current complete candidate. After two-build reproduction succeeds, retain the complete inventory/receipt and one artifact; remove only the verified duplicate copy. Stop additional allocation when ordinary workspaces exceed 20 GiB or two manual preparations are unfinished.
- Historical deduplicated directories are evidence remnants, not runnable workspaces. Their keep markers and `C:\Dev\maimai\cache-cleanup-20260923` mappings protect unique reconstruction anchors. Never feed a partial historical tree to a build.
