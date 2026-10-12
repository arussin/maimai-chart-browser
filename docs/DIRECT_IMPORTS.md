# Kamaitachi and Diving-Fish imports

This change extends the production Import player data dialog with Kamaitachi and
Diving-Fish. It retains Maishift and maimai.party Session Report. Other providers
remain deferred. The broader investigation and implementation are preserved on
`codex/import-connectors-20261011`; they are not part of this launch.

## Player journeys

Both new paths read scores already stored by a tracker. Refreshing Party does
not retrieve a new arcade result from SEGA, Wahlap, or maimai NET.

| Service | Before opening Party | In Party | Data imported |
| --- | --- | --- | --- |
| Kamaitachi | Existing account with maimai DX personal bests | Enter username, numeric ID, or canonical profile URL; preview; import once or remember | Public maimai DX PB snapshot, without sign-in or API key |
| Diving-Fish | Account verified; tracker agreement accepted; scores visible; score masking disabled | Connect, sign in on Fish, approve read-only access, preview, import once or remember | China-region ordinary-chart PB snapshot |

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

No manual Fish API-response upload is offered: a simple user-facing JSON export
was not verified. Ordinary file upload remains under Session Report. Never ask
players for provider API keys, application secrets, or passwords inside Party.

## Recovery and data boundaries

Missing users, absent maimai DX profiles, empty PB responses, and the Fish
agreement requirement have distinct guidance. Failed reads preserve local data.
The documented Fish agreement error preserves an existing remembered grant;
new, uncommitted grants still follow cancellation cleanup. Complete Fish setup
before connecting again.

PBs are not invented plays. Missing charts do not erase retained PBs. Unmatched
and unsupported chart counts remain visible. The last-imported date records
Party's retrieval, not the last arcade play or tracker synchronization.

## Operator setup and activation gates

Kamaitachi needs no application registration for the public reader. The two
documented requests are `/api/v1/users/{username-or-id}` and
`/api/v1/users/{numeric-id}/games/maimaidx/pbs/all`. Browser requests omit credentials.

Fish uses a confidential OAuth application with authorization code, S256 PKCE,
and `openid profile prober.records.read`. Register the exact callback
`https://maimai.party/api/player-import/oauth/diving-fish/callback`.

Use the approved owner workflow to install these secret bindings, without
retrieving or committing their values:

- `PROVIDER_OAUTH_ENCRYPTION_KEY` (32-byte AES key)
- `DIVING_FISH_OAUTH_CLIENT_ID`
- `DIVING_FISH_OAUTH_CLIENT_SECRET`

The separate Worker route is `maimai.party/api/player-import/oauth/*`. Keep the
existing Durable Object namespace, secret bindings, rate limiter, same-origin
checks, and disabled request logs/traces. Localhost and Pages preview origins
cannot complete the production OAuth callback. The default global and Fish
feature flags remain false in this CL.

Before activation, deploy the reviewed privacy/help text and compatible usage
collector/report contract. Live acceptance requires a controlled production-origin
activation window: start, callback and read all fail while either flag is false.
Both flags enable the service for eligible users, not just a test account; this is
not a private test mode. Coordinate that activation before general availability,
and return both flags to false if acceptance fails.

Verify an actual consenting account: sign-in and
consent, exact PB comparison with masking off, unchanged/new-score refresh,
renewal, cancelled account replacement, import once, disconnect, and revoked
access. Local fixtures and an installed secret do not establish these gates.
Leave the global and Fish flags enabled for general availability only after this
acceptance; deferred providers must remain unavailable. Preserve compatible
encrypted-session recovery material.

Explicit connect/read/refresh/disconnect/cleanup and setup-link actions use finite
usage counters. No account names, URLs, tokens, score values, or provider error
bodies enter reports. Background polling and automatic refresh emit no action
counters. See `usage-worker/README.md` for event meanings and rollout ordering.

## Primary references

- [Fish OAuth documentation](https://maimai.diving-fish.com/manual/docs/developer/oauth-api-document/)
- [Fish score-import guide](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/)
- [Tachi public PB implementation](https://github.com/zkldi/Tachi/blob/b38e07245b629237ce7041db9e95d603a1299694/typescript/server/src/server/router/api/v1/users/_userID/games/_game/_playtype/pbs/router.ts)
- [Tachi maimai DX configuration](https://github.com/zkldi/Tachi/blob/b38e07245b629237ce7041db9e95d603a1299694/typescript/common/src/config/game-support/maimai-dx.ts)
