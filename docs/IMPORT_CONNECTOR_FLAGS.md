# Import connector visibility

The import window reads a small runtime manifest. Each `true` method is eligible
to appear; a service disappears when all its methods are `false`. Direct methods
still need their existing provider setup and readiness checks.

These are visibility controls for choosing a new import. They do not revoke
OAuth grants, stop saved connections from refreshing, delete imported scores,
change parsers, or bypass any authorization check. Disconnect and Forget remain
available. An import already in progress is allowed to finish. Existing help pages
may describe methods that are temporarily hidden.

## One-time setup

The operator performs this as part of the reviewed release, using the existing
Cloudflare owner workflow. Source preparation does not provision any resource.

1. Create a dedicated Workers KV namespace for import visibility. Use a separate
   namespace for staging.
2. Bind it to the `maimai-provider-imports` Worker as `IMPORT_CONNECTOR_FLAGS`.
   Add the actual namespace ID to the owner-controlled deployment configuration;
   the checked-in configuration deliberately has an empty `kv_namespaces` list.
3. Review `config/import-connectors.json`, then store its complete JSON as the
   value of key `connectors:v1`. The seed enables all implemented UI methods; it
   is a proposed launch configuration, not evidence that any provider is live.
4. Deploy the reviewed Worker and browser once. The existing OAuth route includes
   `GET https://maimai.party/api/player-import/oauth/connectors`.
5. Check the returned manifest and the import window. Missing setup, missing KV
   data, or malformed data produces HTTP 503. The browser then offers only the
   local Session Report upload for offline recovery, with a short notice and Retry.
   It never silently restores an older allow list. A valid all-off manifest hides
   every choice, including Session Report upload.

Binding a namespace is a deployment change. After this setup, changing its stored
value does not require rebuilding or deploying the website or Worker.

## Toggle a method

In Cloudflare: **Workers KV → the import namespace → KV Pairs → `connectors:v1`**.
Edit the JSON, set the desired method to `true` or `false`, and save. Keep a copy of
the previous value so it can be restored. Do not set an expiration on this key.

| Method | Import option |
| --- | --- |
| `file` | maimai.party Session Report file |
| `report` | Hosted Session Report |
| `maishift` | Maishift public profile |
| `kamaitachi` | Kamaitachi public profile |
| `diving-fish` | Diving-Fish connection |
| `lxns` | LXNS connection |
| `file:mai-tools` | mai-tools file |
| `file:dxrating` | DXRating file |
| `file:tomomai` | Tomomai file |
| `file:jietng` | JiETNG file |
| `file:aqua` | Aqua / AquaDX file |
| `file:tachi` | Tachi file |

Omitted methods are `false`. Unknown method names, unknown top-level fields,
non-boolean values, another schema version, and JSON larger than 8 KiB are
rejected. The public response contains only normalized booleans, with no secrets
or provider account information. Configuration cannot supply URLs or new code.

KV uses a 60-second cache TTL. Changes can take **60 seconds or longer** to reach
every location. Close and reopen the import window to reload its choices. An
already-open window is not a live control panel. This is not an immediate
emergency shutdown mechanism; existing Worker availability settings remain
separate.

## Prepare a value locally

The helper only reads and writes local JSON. It does not retrieve credentials,
log in, or contact Cloudflare. It prints to stdout unless a new output path is
specified; an existing output file is never overwritten.

```powershell
node scripts/configure_import_connectors.mjs --off file:tomomai --off lxns
node scripts/configure_import_connectors.mjs --input C:\DevCache\import-flags-current.json --on file:tomomai --output C:\DevCache\import-flags-next.json
```

Start from a copy of the **current KV value** for subsequent edits. Starting from
the repository seed every time would overwrite other runtime choices. Review the
printed JSON or the new file, then paste it into Cloudflare's KV editor.

An operator already using the approved, authenticated Wrangler environment can
also apply the reviewed file with the pinned CLI. These commands are instructions,
not actions performed by the helper. Use the real approved config path and keep
the previous JSON for rollback:

```powershell
npx --no-install wrangler kv key get connectors:v1 --binding IMPORT_CONNECTOR_FLAGS --config C:\path\to\approved-worker.jsonc --remote --text
npx --no-install wrangler kv key put connectors:v1 --binding IMPORT_CONNECTOR_FLAGS --config C:\path\to\approved-worker.jsonc --remote --path C:\DevCache\import-flags-next.json
```

After propagation, verify the public endpoint and open a fresh import window.
For rollback, write the previous complete manifest to the same key. Restoring a
Worker version alone does not restore KV data.

## Verification

Local tests cover the real Worker/KV binding, runtime value changes without a
restart, strict parsing, missing values, bounded reads, deadlines, public endpoint
method/path restrictions, and unchanged OAuth readiness. Browser checks cover
method and service visibility, an unavailable manifest, and preserved saved data.
They do not establish production binding or worldwide propagation acceptance.

Cloudflare references: [KV setup and dashboard editing](https://developers.cloudflare.com/kv/get-started/),
[KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[Wrangler KV commands](https://developers.cloudflare.com/kv/reference/kv-commands/),
and [Worker versions and storage state](https://developers.cloudflare.com/workers/versions-and-deployments/).
