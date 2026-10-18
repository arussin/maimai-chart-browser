# Kamaitachi, Diving-Fish and LXNS imports

This change extends the production Import player data dialog with Kamaitachi,
Diving-Fish and LXNS. It retains Maishift and maimai.party Session Report, and adds
file imports for Tomomai, mai-tools, DXRating, JiETNG v2, AquaDX and Tachi.
File methods and direct connections have separate runtime visibility controls;
see [Import connector visibility](IMPORT_CONNECTOR_FLAGS.md).

## Player journeys

All three new paths read scores already stored by a tracker. Refreshing Party does
not retrieve a new arcade result from SEGA, Wahlap, or maimai NET.

| Service | Before opening Party | In Party | Data imported |
| --- | --- | --- | --- |
| Kamaitachi | Existing account with maimai DX personal bests | Enter username, numeric ID, or canonical profile URL; preview; import once or remember | Public maimai DX PB snapshot, without sign-in or API key |
| Diving-Fish | Account verified; tracker agreement accepted; scores visible; score masking disabled | Connect, sign in on Fish, approve read-only access, preview, import once or remember | China-region ordinary-chart PB snapshot |
| LXNS | Verified account with linked China-region game data and scores already synchronized to LXNS | Connect, sign in on LXNS, approve read-only access, preview, import once or remember | China-region ordinary-chart score snapshot |

Kamaitachi's public API lookup does not prove account ownership. Its website may
require sign-in even though this API is public. Do not promise that a random new
player can register immediately: current configuration disables ordinary signups,
and the registration interface presents an invitation field. Its upstream score
acquisition tools have their own requirements.

Diving-Fish's account creation and score acquisition are separate. Its current
registration/sign-in UI is Chinese. The official acquisition guide involves
additional WeChat/proxy or iOS setup, outside Party's import flow. In
**编辑个人资料**, disable **对非网页查询的成绩使用掩码**. Public-query privacy may remain
enabled. Party cannot independently verify the masking setting, so it asks for
acknowledgement and retains a preview warning.

LXNS account creation does not synchronize game data. The player must complete
LXNS's own score-sync setup and confirm that their scores are visible there first.
The Party connection needs no personal API key, friend code, QQ number, or public
profile setting. Its read-only permission applies to the signed-in player.

The connection panel uses a short prerequisite checklist: scores updated for both
trackers, plus score masking off for Fish. Explanations sit behind question-mark
buttons. The tracker link opens the service for setup; **Connect** opens its own
sign-in and approval page, then returns to Party's score preview. Confirmations
are required for a new account connection, not for previewing an existing grant.

No manual Fish or LXNS API-response upload is offered. Session Report and the
additional file formats have their own service sections. Never ask
players for provider API keys, application secrets, or passwords inside Party.

## Recovery and data boundaries

Missing users, absent maimai DX profiles, empty score responses, and the Fish
agreement requirement have distinct guidance. Failed reads preserve local data.
The documented Fish agreement error preserves an existing remembered grant;
new, uncommitted grants still follow cancellation cleanup. Complete Fish setup
before connecting again.

PBs are not invented plays. Missing charts do not erase retained PBs. Unmatched
and unsupported chart counts remain visible. The last-imported date records
Party's retrieval, not the last arcade play or tracker synchronization.

China-region imports do not imply a complete China-version catalog or verified
China Best 50 reconstruction. Fish constants and LXNS rating contributions are
preserved only when supplied; missing values are not filled from Japanese catalog
constants. Unknown/China-only records remain unmatched. Matching cannot detect a
regional chart revision with identical title, artist, format and difficulty.
The existing export version pools are not a verified China release model, so do
not present their Best 50 output as an exact China B35/B15 result. Regional chart
equivalence and China release/rating policies remain separate acceptance work.

## Operator setup and activation gates

Kamaitachi needs no application registration for the public reader. The two
documented requests are `/api/v1/users/{username-or-id}` and
`/api/v1/users/{numeric-id}/games/maimaidx/pbs/all`. Browser requests omit credentials.

Fish uses a confidential OAuth application with authorization code, S256 PKCE,
and `openid profile prober.records.read`. Register the exact callback
`https://maimai.party/api/player-import/oauth/diving-fish/callback`.

LXNS uses authorization code, S256 PKCE, a confidential client secret, and
`openid read_player`. Register exactly
`https://maimai.party/api/player-import/oauth/lxns/callback`.
Read stable identity from UserInfo `sub`; do not use a display name or friend
code as account identity. Personal player/score endpoints use the consenting
player's Bearer token. Refresh tokens rotate, so persist the replacement grant.

Use the approved owner workflow to install these secret bindings, without
retrieving or committing their values:

- `PROVIDER_OAUTH_ENCRYPTION_KEY` (32-byte AES key)
- `DIVING_FISH_OAUTH_CLIENT_ID`
- `DIVING_FISH_OAUTH_CLIENT_SECRET`
- `LXNS_OAUTH_CLIENT_ID`
- `LXNS_OAUTH_CLIENT_SECRET`

The separate Worker route is `maimai.party/api/player-import/oauth/*`. Keep the
existing Durable Object namespace, secret bindings, rate limiter, same-origin
checks, and disabled request logs/traces. Localhost and Pages preview origins
cannot complete the production OAuth callback. The default global and Fish
and LXNS feature flags remain false in this CL.

The selected launch is an open public test with all 12 implemented import methods
proposed for availability. It still requires the owner's approval of the exact
tested candidate and screenshot review, plus verified production configuration.
This decision does not activate any method by itself. Prior success from a
recruited score-bearing tester is not a launch prerequisite; real-account OAuth,
authentic file exports and China catalog/Best 50 behavior remain disclosed
validation limits. Each OAuth user must still sign in and consent on the provider.

Before activation, deploy the reviewed privacy/help text and compatible usage
collector/report contract. Check the migration ledger, retain production
`0003_diagnostics.sql`, and apply additive `0002_import_receipts.sql` only if
pending through the existing owner release workflow. Deploy the updated collector
and report before the browser. Historical totals and unknown receipt times remain
intact. Verify the actual bindings, registered callbacks/scopes, encrypted grant
storage, privacy settings and runtime visibility manifest before enabling the
approved services. Start, callback and read fail while either the global or that
provider's flag is false. Enabling both makes the service available to eligible
consenting users, rather than only an owner test account. At the approved public
launch, enable the global, Fish and LXNS switches and the reviewed visibility
manifest; keep compatible encrypted-session recovery material. If a provider
needs to be withdrawn, disable its availability switch as well as its new-import
visibility flag, preserving saved scores and Disconnect/Forget controls.

Follow up with actual consenting accounts to verify sign-in and consent, exact
PB comparison with masking off, unchanged/new-score refresh,
renewal, cancelled account replacement, import once, disconnect, and revoked
access. Check LXNS's complete personal score response, missing-game/empty-account
guidance, refreshed grants and separate-provider isolation. LXNS has no documented
public OAuth revocation endpoint: disconnect deletes Party's encrypted grant;
players can additionally revoke access in LXNS's application settings.
Local fixtures and installed secrets do not establish these real-account results.
Record fixture, public-profile, consenting-account OAuth and authentic-file
evidence separately; availability is not proof that every provider flow works.

The app-owner Fish and LXNS accounts currently have no scores. They can verify
real sign-in/consent and empty-data handling, but score comparisons need a
consenting account with data. Kamaitachi's public-profile endpoint can verify the
public-reader path when reachable. Fish's anonymous B50 endpoint is partial;
LXNS's arbitrary-player API needs a separate developer key and player permission,
and its all-score response omits achievements. Neither substitutes for the
full-score OAuth acceptance above. Do not place another player's scores into
the app-owner accounts for testing.

Explicit connect/read/preview/confirm/import/refresh/disconnect/cleanup and
setup-link actions use finite usage counters. A successful connection or preview
does not establish import success: `import_completed` is emitted after the local
score commit, before remote grant cleanup. Failures have bounded categories such
as empty scores, expired connection, rate limit, timeout and browser storage.
The report shows received counts and first/latest server receipt times per daily
aggregate; these are not exact action times or a linked history of a person.
No account names, URLs, tokens, score values, or provider error bodies enter reports.
Background polling and automatic refresh emit no action counters. Automatic and
manual refresh do emit separate version-2 operation diagnostics, including
unchanged snapshots, cooldown skips, failures and supersession. Import diagnostics
record the failed boundary and a finite reason; a saved import keeps its success
even if a later display or grant-cleanup step fails. Storage transactions are a
separate operation family and must not be summed with imports as unique incidents.
See [Diagnostic logging](DIAGNOSTIC_LOGGING.md) for privacy and compatibility rules.

For owner functional smoke tests, set `window.maimaiUsageEnabled=false` before
application startup and verify no `/__usage` requests are sent. Verify hosted
logging separately with a documented non-personal canary and exact report
readback. The system does not otherwise identify or exclude the owner. Opt-outs,
blocked requests and dropped batches remain unknown; they cannot prove that nobody
attempted an import. See `usage-worker/README.md` for event meanings and rollout
ordering.

## Primary references

- [Fish OAuth documentation](https://maimai.diving-fish.com/manual/docs/developer/oauth-api-document/)
- [LXNS OAuth guide](https://maimai.lxns.net/docs/oauth-guide)
- [LXNS score API](https://maimai.lxns.net/docs/api/maimai)
- [Fish score-import guide](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/)
- [Tachi public PB implementation](https://github.com/zkldi/Tachi/blob/b38e07245b629237ce7041db9e95d603a1299694/typescript/server/src/server/router/api/v1/users/_userID/games/_game/_playtype/pbs/router.ts)
- [Tachi maimai DX configuration](https://github.com/zkldi/Tachi/blob/b38e07245b629237ce7041db9e95d603a1299694/typescript/common/src/config/game-support/maimai-dx.ts)
