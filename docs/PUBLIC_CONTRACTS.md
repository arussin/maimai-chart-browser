# Public downstream contract

The registry owns `maimai-public-contract-bundle-1`. It contains only the portable
player-data module, public comparison module, shared wordmark assets and MIT license.
Its data contracts remain `maimai-player-data-1` and `public-matching-1`; this bundle
is source distribution, not a replacement for public catalog integration artifacts.

Run from the accepted external development environment:

```console
python scripts/export_contract_bundle.py --source PATH_TO_REGISTRY --revision FULL_COMMIT_SHA --output DEVCACHE_ARTIFACT_PATH
```

The exporter resolves a full commit SHA and reads each allowlisted Git blob directly.
Dirty/untracked source, secrets, scores, timestamps and machine-specific paths never
enter the artifact. UTF-8 bytes are preserved exactly; hashes and output are deterministic.
The output must be a new artifact path, so an existing reviewed bundle is not overwritten.

Review and retain the resulting SHA256 with the source revision. Downstream consumers
verify the artifact digest, schema, file allowlist and individual digests before use.
Session Report's `scripts/check_party_contract.py` accepts the bundle, revision and
SHA256 and exercises its synthetic player-data corpus offline. Its existing interface
pin stays independent until an explicit reviewed update; there is no runtime dependency
from the browser to Session Report or from the report to the registry source package.

Keep the catalog v2-to-public-integration-v1 adapter. Inventory membership is not
recommendation qualification. New providers do not automatically change the report's
provider-specific calculation policy or its versioned public-catalog requirements.
