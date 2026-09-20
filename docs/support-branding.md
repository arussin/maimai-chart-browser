# Support checkout branding

The dialog reuses the site's official wordmark from `site-brand.html` and `site-brand.css`. It clones the existing wordmark into a non-interactive heading with the accessible name “Support maimai.party”; it does not redraw the logo or add a navigation link inside checkout.

Stripe's embedded payment panel supplies its own attribution. The duplicate local attribution inside that panel remains removed. At Adam's request, a small “Powered by Stripe” line now sits below the Support button, using `src/maimai_intelligence/assets/stripe-wordmark.svg` remains an unchanged **Stripe wordmark - Slate.svg** from Stripe's [official logo kit](https://assets.stripeassets.com/fzn2n1nzq965/7q0dJGs6fRS1LRmMpChoAF/87def4edfbb7fd5aef4ab9baf904b2db/Stripe_logo_kit.zip), linked by the [Stripe newsroom](https://stripe.com/newsroom/information); it is displayed below the opener, outside the dialog.

SVG SHA-256: `c243d6a693df3a3678a8353d89199d0c7fdb5efc7d93983dea77166c5ba75f36`.

The site logo and exact hosting/domain introduction sit above the provider-owned frame. Local automated browser fixtures are synthetic; the HTTPS sandbox uses Stripe's real native controls. See [sandbox verification](stripe-sandbox-verification.md) for observed currencies and payment flows. The actual configuration must use **maimai.party** as its customer-facing business name, including default checkout text and receipts. Adam also approved this brand across **Session Report**.
