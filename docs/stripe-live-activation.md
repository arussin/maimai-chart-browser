# Live support configuration handoff

Updated September 20, 2026. The live Worker and public site are activated. Creating
and retrieving an unpaid live Checkout session both passed, and the owner confirmed
a successful real payment through maimai.party. The preview remains a separate sandbox.
This record contains public configuration and verification, never credentials.

## Verified live Stripe resources

| Setting | Value |
| --- | --- |
| Customer-facing account | maimai.party |
| Account | `acct_1UHZZ0DrG9Tq0ch5` |
| Product | `prod_VIEE3WHKV7ZRGg` — Support maimai.party |
| Price | `price_1UHdm4DrG9Tq0ch57pv542SK` |
| Pricing | One-time USD, customer chooses; preset 500, maximum 10000 cents, minimum unset |
| Payment configuration | `pmc_1UHZZWDrG9Tq0ch52p050ZCn` |
| Account status | Payments and Payouts active; no active account tasks |

The owner selected 18 enabled methods. Preserve those selections; Stripe filters
methods by currency, region, eligibility and Checkout compatibility. Some individual
methods remain paused or pending approval. Active account capabilities alone do not
establish approval of the support use case for every payment method.

## Activation evidence

- The owner created the restricted live key and submitted it directly to Cloudflare.
  Metadata-only verification confirms `STRIPE_SECRET_KEY` is `secret_text`.
- Worker `maimai-support` serves only `maimai.party/api/support/*`. Dev/preview URLs,
  logs/traces and diagnostics are disabled. Its rate-limit namespace is
  `202609200002`, with 30 requests per 60 seconds.
- Live payment domain `maimai.party` is enabled (`pmd_1UHeilDrG9Tq0ch5YN5FbHhV`).
  Stripe branding uses the official site logo, light background and teal accent.
- This is voluntary support for the site's already provided service, with no
  charitable claim or payment on someone else's behalf. This matches Stripe's
  general [tips requirements](https://support.stripe.com/questions/requirements-for-accepting-tips-or-donations).
  Method-specific approval is distinct: Alipay and WeChat remain pending. No user
  payment selections were disabled, and this review does not certify those methods.
- Both server gates are enabled. A real session-create request returned HTTP 200,
  live mode and `open`; a separate status request verified `open`. No charge was made.
- Public activation uses the matching publishable key. Browser fixtures replace it
  with a synthetic key; the sandbox builder always substitutes a test key and origin.
- Production Pages release `1a6c07f0-6e3f-496a-a095-59c671fd9aa4` uses merged commit
  `cce1d5eda93fae3af58bb292434581dddb2d94a6`. CI and all 45 targeted browser checks
  passed. The immutable deployment and apex domain serve the reviewed support files.
  Cloudflare's pre-existing HTML beacon injection is blocked by the checkout CSP.
- All 14 catalogs, integration files and artwork are unchanged. The manifest SHA-256
  remains `9cb000b90b381f32a531651f6a321a22f418d0427185e45b97fdd25f227e7c73`.
  Previous Pages release `d75f2b13-5468-47f5-a31c-b9f6918a80b7` is retained for rollback.
- The native live checkout displays maimai.party and accepted an edited $1 amount
  without a site minimum. The agent submitted no payment; the owner's successful
  real-payment confirmation is reported separately from these automated checks.

## Completed Session Report integration

The live report at `https://adamrussin.com/maimai/` opens the same native Stripe
dialog directly in the page. Its project is `session-report`, its allowed origin
is exactly `https://adamrussin.com`, and its fixed wallet return is
`/maimai/#support-return`. It bundles byte-identical copies of the shared payment
client/controller. Report/player data is never read by the payment code.
Stripe payment domain `adamrussin.com` is enabled
(`pmd_1UHfURDrG9Tq0ch5oZJPxnxb`).

- Payment Worker source: merged commit `b9fa4aea977825bb2fc2bdab033a2c38faa67ec5`.
  Live version `88334faf-baf5-45a0-9bff-3f1a13fe9348`, deployment
  `3a01e33f-9d18-44a4-a113-9458e78bb1dc`. Previous version
  `36a22ac9-d311-4d9e-8a31-6c5b22a1d71c` remains rollback evidence.
- Unpaid live create/status requests passed for both projects, with open live
  sessions and exact-origin report CORS. The report preflight returned 204.
  Existing encrypted-key storage, payment configuration, rate limit and
  disabled logs/traces were preserved. No payment was submitted by the agent.
- Final Pages release `c2a3130c-7cf0-4faa-a3bb-37e144235d8b` uses that merged
  commit. [The immutable deployment](https://c2a3130c.maimai-party.pages.dev)
  and `https://maimai.party` both serve byte-identical reviewed
  `support-client.js` and `support-stripe.js`. These were the only two changed
  files among 14,848 release files. Both live manifest hashes remain the value
  recorded above. The prior `1a6c07f0` release is retained.
- Report renderer `7c06292bca5c8d7423fac6ddb4b77bcda1a53d5a` passed all CI jobs.
  Local validation passed 258 offline Python checks (one configured skip),
  ten adapter checks, eight history/installation checks and 30 targeted browser
  checks across desktop, tablet, narrow mobile and WebKit phone. The payment
  Worker passed 13 tests, including project/origin binding and both return paths.
- The personal report was published from retained HTML without a score import.
  All four embedded data blocks, B50, history/player rows, ten historical
  selections and both archives were preserved. Immutable historical report
  bytes were not rewritten. Private hashes, run IDs and rollback artifacts are
  recorded in the private installation repository.
- A live browser check confirmed the real Stripe panel inside the report without
  a new window. Close/reopen, retry, focus and return behavior passed synthetic
  browser tests. Individual live wallet transactions remain device/method-specific
  checks; the owner's confirmed maimai.party payment is separate evidence.

## Owner provisioning reference

**This crosses the protected security boundary and needs the security-sensitive / privileged workflow.**

1. Confirm the real support use case and live domain `maimai.party` in Stripe.
   Confirm branding uses the official maimai.party logo and customer-facing name.
   Do not change the legal business identity or enable a restricted method by
   relabeling this payment. Register/verify the live payment domain if absent.
2. Provision the independent Worker named `maimai-support` using the reviewed
   `support-worker/index.mjs`. The source example is `support-worker/wrangler.jsonc`.
   The Worker and its narrow route are now provisioned. Keep the sandbox separate.
3. Enter a live restricted Stripe key directly into Cloudflare's encrypted
   `STRIPE_SECRET_KEY` binding. It needs Price/Product read and Checkout Session
   write/read access. Credential creation/entry is completed by the owner; never
   paste a key into chat, source, DevCache, or a public build. Keep new protected
   local material in `C:\Protected` through the accepted owner workflow.
4. Set `STRIPE_MODE=live`, `SUPPORT_PRICE_ID` and `PAYMENT_METHOD_CONFIGURATION`
   from the table. Leave `TEST_LOCATION_COUNTRY` empty and
   `SUPPORT_DIAGNOSTICS=false`. Keep `SUPPORT_ENABLED=false` until verification;
   set `SUPPORT_ELIGIBILITY_CONFIRMED=true` only after the actual use-case review.
5. Add `SUPPORT_RATE_LIMITER` with a new, unused account namespace and a starting
   limit of 30 requests per 60 seconds. Keep Worker dev/preview URLs and request
   logs/traces disabled. Retain existing application headers and privacy controls.
6. Route only `maimai.party/api/support/*` to this Worker. The Cloudflare zone
   `62aa723b24ffe5f4db3d1eff5040b3f8` is active.
   Check the current Pages/DNS configuration before adding that route; other
   paths continue to the existing site.
7. Supply the matching public `pk_live_…` key in `support-config.js`, publish the
   reviewed site assets (including `/support.html` and `/support-return.html`),
   enable the server and then the public feature flag in the approved release.
   Verify real Checkout branding, amount editing below $3, localized presentation,
   and a return path. Any real charge requires the owner's separate payment action.
8. For a report host, register its exact origin and fixed return in the Worker,
   register the Stripe payment domain and supply matching public report config.
   Update future renderer assets and separately publish the preserved report
   using its private preservation record. The current personal host is complete.
   Do not run a score import or reset historical presentation selections.

See [integration and rollback](stripe-support.md) and
[real sandbox observations](stripe-sandbox-verification.md).
