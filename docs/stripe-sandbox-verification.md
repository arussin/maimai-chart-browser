# Stripe sandbox verification

## Minimum removed — September 20, 2026

At Adam's request, the site-defined minimum was removed. The previous sandbox
price below had already been used and remains retained with its test payment
history. New sessions now use `price_1UHdtHDgIFP3C35taHqayKYY`, with a $5 preset,
an unset minimum and a $100 maximum. Stripe's own processing limits still apply.

The sandbox Worker was updated to require an unset optional minimum. Its exact
editor readback matched SHA-256
`0a33b6994feae3f84abf5fba32f82d30aadd0a1efd6d3fc903faa895bdebf447`
(42,193 characters), and code version `efc7c36a` became active. A subsequent
variable deployment selected the replacement price. Readback confirmed test mode,
the existing payment-method configuration, encrypted key and rate limiter were
preserved, with logs/traces still disabled.

A fresh real Stripe sandbox Checkout loaded successfully and accepted `$1.00`
in its native amount field after blur without the former $3 validation error.
No payment was submitted during this check. Prior tabs may retain an old Checkout
Session and its original Price; open a fresh tab for the new-price check.

This deployment changes only the minimum validation and sandbox price selection.
The newer standalone shared checkout page for Session Report is implemented and
browser-tested locally; it is not yet deployed to this sandbox or production.
The historical observations below describe the earlier $3-bound configuration.

Verified September 20, 2026. The HTTPS sandbox works with real Stripe test-mode Checkout. Production support remains disabled; no real funds were charged.

## Current sandbox

- Preview: https://maimai-support-sandbox.adam-russin.workers.dev
- Stripe: `Russin sandbox` (`acct_1UHZZ7DgIFP3C35t`), separate from live. The owner approved and completed secret rotation. No secret is included in source or public output.
- Product: `Support maimai.party` (`prod_VIBjRgJuI9jf6o`). Price: `price_1UHbLZDgIFP3C35t55aGFA6p`, active one-time customer-chosen USD amount, suggested 500, minimum 300, maximum 10000 cents. The actual Price, expanded product and currency options were verified through Workbench.
- Payment configuration: `maimai.party support sandbox` (`pmc_1UHbPZDgIFP3C35tw2z6MTOW`). Stripe initialized Cards, Cartes Bancaires and Link. Apple Pay, Google Pay, Korean cards, Kakao Pay, Naver Pay, PAYCO and Samsung Pay were enabled during setup. Adam subsequently added methods; his changes were preserved. This is not an exhaustive final inventory or proof of live eligibility.
- Preview payment domain is Enabled (`pmd_1UHbv4DgIFP3C35tnZ4elfSO`). A rendered wallet button does not prove a real-device payment works.
- Cloudflare Worker: `maimai-support-sandbox`; no production routes or custom domains. Test mode, support and sandbox eligibility flags true, fixed Price/configuration, encrypted secret binding, rate limiter namespace `202609200001` (30 requests per 60 seconds).
- `TEST_LOCATION_COUNTRY=US` restored after regional testing. This deliberately supplies a fake US email. Leave it empty for normal visitor behavior; it is rejected in live mode.
- Temporary `SUPPORT_DIAGNOSTICS=false`. Worker logs and traces disabled. Final settings verified through the read-only Cloudflare API.

## Deployed source and interface

`support-worker/build-sandbox-preview.mjs` builds existing support assets into DevCache, accepting only a test publishable key and substituting the sandbox origin. Its wrapper rejects other origins, live mode and live keys. A fixed asset allowlist uses no-store/noindex headers; the return page has restrictive CSP and no analytics.

Reviewed single module: 43,917 characters, SHA-256 `b49914b64b6ecd207b5d325c19174857d7e9a83473a984b7a1ed81fc365439a8`. Full editor contents matched this hash before deployment; source version `ad91e868` became active. Subsequent deployments changed only test settings. Read-only retrieval confirmed the deployed resume logic, manual redirects and matching buttons.

The earlier filled-heart button-theme build was 44,522 characters, SHA-256 `7235cc68eb0a9fbb390539caae6b8eeee6a9db97d984402abe7ac8d55967543b`. It changes only button HTML/CSS assets from the verified payment build above. The filled heart displays the five logo colors from left to right; forced-colors mode uses the system button-text color.

The selected option B build was 42,194 characters, SHA-256 `19cafa6f129689a8a84555ed6cd20ea632718afe2a891765d360518f253e172a`. Full editor readback matched before deployment and version `c4ad633c` became active. It uses discrete filled logo-color bands, a small official “Powered by Stripe” attribution below the opener, and no legacy-provider fallback. The preview’s buttons both measured 44px high with matching top alignment and font weight 600. Real Stripe’s editable $5 field loaded after the update.

The subsequent invitation-only build is 42,219 characters, SHA-256 `f84aae0a15796864b3dd8eb32733a7e19204564b3460d9270d2e6730ea831e24`. Exact editor readback matched; version `519e04a2` became active. The in-app preview visibly confirms: “maimai.party is free for everyone. If you’d like to help with hosting and domain costs, a few dollars is more than enough.” Syntax and whitespace checks passed; payment behavior is unchanged.

**View on GitHub** and **Support maimai.party** sit together in About, outside the credits footer, without a duplicate footer invitation. Their sizing and shape match; Support has a white background, black border/text and a rainbow heart using the five site-logo colors. The dialog retains the official wordmark and hosting/domain introduction. Stripe owns amount entry, payment controls and attribution. Our duplicate attribution inside the dialog and Payment details dropdown are removed; the requested small attribution sits below the opener.

The actual native dialog was visually inspected on desktop. Automated layouts passed at desktop, mobile and 320px widths with a synthetic Stripe fixture. The browser viewport capability did not change this Chrome session's actual width, so real-provider mobile rendering remains unverified.

## Resolved failures

1. The original Worker returned HTTP 502 before a successful Price lookup. Test-only diagnostics identified `price_lookup` / `transport`. Changing server fetch from `redirect: 'error'` to `redirect: 'manual'` made the same configured integration succeed. Redirect responses remain rejected as non-2xx and are never followed. The exact exception was not logged or exposed, so this establishes the before/after fix without asserting a more specific platform cause.
2. Switching global test location US to KR changed a repeated creation body under an existing idempotency key. Adam's already-open US checkout then showed unavailable. A fresh attempt worked with his added methods intact; restoring US recovered the existing attempt. The client now sends its known session when resuming, and the server retrieves it instead of creating it again, still validating ownership/project/mode. A real US session reopened after switching the server to KR and retained its USD amount. Tests also cover changed settings and invalid ownership/session references.

An initial response lost before the client learns its session ID still relies on an identical idempotent creation request. Avoid changing Price/configuration/test-country parameters during that ambiguous retry; the known-session fix does not automatically resolve this separate case.

The Cloudflare connector could read but not upload. Existing expired Wrangler authorization was not refreshed. The Dashboard opened older read-only code; selecting the latest version and focusing the actual editor allowed verified clipboard replacement and deployment. The owner's earlier manual paste completed the original deployment; further manual pasting is no longer needed. No account permission expansion was used.

## Actual Stripe browser observations

API version `2026-08-26.dahlia` accepted `embedded_page`, the customer-chosen Price, Adaptive Pricing, separate payment configuration and fixed return URL. The real Stripe.js form rendered:

| Test location | Initial editable amount | Observed controls |
| --- | --- | --- |
| US | $5.00 | Card, Apple Pay, Link, Amazon Pay, Cash App Pay, Google Pay, WeChat Pay |
| KR | ₩7,208 | Card, Apple Pay, Link, Samsung Pay, Kakao Pay, Naver Pay; more methods behind expansion |
| JP | ¥816 | Card and Google Pay; express wallet controls also present |
| CN | CN¥34.83 | Card, WeChat Pay and Google Pay; express wallet controls also present |

KR/JP/CN showed Stripe's native local-currency/USD selector and conversion disclosure. These are session-specific test rates, not promised prices. Korean amount validation rejected a too-small amount with a ₩4,325 minimum based on $3, then accepted ₩8,000. USD entry rejected $2 and $100.01 with the configured bounds and accepted $7.

Stripe language uses default `auto` browser preference separately from payment location. This English-preference browser showed English labels with won, yen and yuan. Stripe documents Korean support and browser-language selection; a Korean-preference browser was not independently exercised. Adam plans a separate pass for site-controlled translations. References: [Adaptive Pricing and test locations](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=embedded-page), [Checkout language](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=embedded-page).

### Payment and return checks

- A documented test decline card produced Stripe's native decline message. Closing/reloading did not auto-open the dialog; explicit reopening preserved $7 and cleared card fields.
- A Visa test card completed $7 USD. Dashboard showed Succeeded (`pi_3UHc3RDgIFP3C35t4MLdoM3A`). Its initial thanks screen was not captured; the Dashboard is the evidence for that card test.
- Kakao Pay redirected to Stripe's test authorization page for ₩8,000. **FAIL TEST PAYMENT** returned to the fixed local page with an unfinished message. Return to checkout preserved ₩8,000.
- Retrying **AUTHORIZE TEST PAYMENT** returned with server-confirmed thanks. Back to maimai.party reopened the dialog with thanks and an explicit Support again button rather than creating another payment. This also exercised retrieval after further country-setting changes.
- Our return URL needed no session/secret parameters. Saving payer details was deselected. Automation honestly identified itself with Stripe's AI-agent checkbox without falsely checking that unrelated agent instructions had been followed.

## Local validation after final changes

- Worker: 10 passed.
- After legacy-provider removal and selected option B: 36 Stripe and affected About browser checks passed across desktop/mobile/narrow. Action-row screenshots were inspected.
- Earlier, before that removal: 39 Stripe/legacy-provider checks and 3 layout checks passed.
- Python: 489 passed, 7 configured skips (496 cases).
- `git diff --check` passed. Earlier broad browser, privacy and Ruff results are in [stripe-support.md](stripe-support.md).

### Amazon Pay corner mark

The tiny mark reported at the button’s top-left was traced to Amazon’s own `amazonpay-button-sandbox-logo` element and `sandbox_icon._CB452516595_.svg` asset, inside its provider frame. It is not a border from the site stylesheet. Verify its absence during the authorized live acceptance pass; no payment method was disabled or provider styling overridden.

## Remaining activation and follow-ups

1. Set actual Stripe customer-facing business name to **maimai.party** and verify default checkout text and receipts, along with official branding. The internal test account may remain `Russin sandbox`; it is not the desired public brand.
2. Confirm live use-case eligibility, especially Chinese wallets and financing methods enabled directly or through Link. Sandbox success is not live approval. Adam's added methods were preserved. Alipay donation restrictions must not be evaded by relabeling support.
3. Verify remaining method-specific paths: other Korean redirects, WeChat completion, JCB/3DS, pending status, real Apple/Google devices and real mobile layout. Enabled settings or visible controls do not establish completion.
4. Provision live credentials/domain/routing through the approved workflow and conduct separately authorized live verification. Production's flag is false and public key empty.
5. Buy Me a Coffee removal is complete in the current site source: no fallback, links, legacy checkout script, release allowlist or allowed payment/frame origin. Disabled or unconfigured Stripe hides support; active checkout errors offer retry.
6. Update **Session Report** with the same support experience and **maimai.party** brand. Adam confirmed its button should stay in the footer, with simpler surrounding support text and a matching “View on GitHub” button linked to https://github.com/arussin/maimai-session-report (verified canonical Git remote). The site's button instead belongs beside GitHub in About. Check Session Report's current location/instructions before edits; this record does not mean it has already been updated.
