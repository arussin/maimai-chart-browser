# Site sharing

The last action in `settings-actions` is **Share this site**, with an inline share
icon. It precedes the player badge and its divider. Implementation stays in the
existing `settings-menu.html`, `settings-menu.js` and `analytics.css` assets, so
existing content-hash asset versioning covers the change.

## Interaction

On mobile devices, the click invokes `navigator.share` immediately when present;
unsupported or rejected requests open the local dialog. Canceling a native share
does not open another picker. Desktop opens the dialog first, with an optional
**Share with device…** action when the browser exposes native sharing.

The dialog follows the selected site language, falling back to browser language
when the site's localization layer is unavailable. Japanese suggests LINE, X and
Hatena; Korean suggests KakaoTalk and Naver; Simplified Chinese suggests WeChat,
Weibo and Qzone; English suggests Facebook, WhatsApp, Reddit, X and Messenger.
English serves both US and Australian visitors. Copy link and More… are always
available. Clipboard rejection selects the visible URL for manual copying.

Provider links use AddToAny's documented service URLs; Naver uses its official
web-share endpoint. More… opens AddToAny's full picker in a new tab. WeChat's QR
handoff belongs to AddToAny, not a locally generated QR implementation. No app
SDK, API key, AddToAny script or provider request is needed to open this dialog.

## Share-sheet appearance

The fallback uses bundled brand SVGs in rounded app tiles, with localized labels
underneath. Small screens use a bottom sheet; desktop uses a centered sheet.
Copy, device sharing, More and Close use compact utility icons with accessible
names. The provider artwork comes from pinned Simple Icons data, with source
hashes in `assets/share-icons-source.json` and its license in
`SHARE_ICONS_LICENSE.md`. No icon is fetched from a third party at runtime.

## Data and accessibility

All shares use only the literal public homepage `https://maimai.party/`, the
site title, and (for native sharing) a generic localized invitation. The current
route, query, fragment, player records and import tokens are never read for the
share payload. External links suppress referrers and opener access. This feature
adds no analytics event or persistent preference.

The menu retains its arrow-key navigation. The modal provides labeled controls,
keyboard focus containment, Escape dismissal and focus return to Settings. Its
initialization is idempotent because progressive pages may load settings twice.

## Validation and translation maintenance

`tests/browser/share-site.spec.js` covers ordering above an imported synthetic
player badge, responsive layouts, all four UI languages, accessibility, native
success/cancellation/failure, clipboard rejection, clean outgoing parameters,
referrer/opener isolation, keyboard access and repeated asset initialization.
Social destinations are intercepted; no test posts to a service or uses a real
player account. Native-share results are mocked and are not proof of delivery
inside installed social apps.

Run checks in a fresh disposable workspace using `tools/Test-Development.ps1`,
as documented in `DEVELOPMENT.md`. Never install browser dependencies in source.
The new copy is in `assets/locales/share.json` and is included in the review
exporter. The actual AI self-review is recorded separately in
`localization-review/share-review-20260920.json`; earlier review records and
fingerprints retain their original attribution and scope.

References: AddToAny service codes at https://www.addtoany.com/services/;
no-script picker at https://www.addtoany.com/buttons/for/website;
WeChat handoff at https://www.addtoany.com/ext/wechat/share/;
Naver endpoint at https://developers.naver.com/docs/share/navershare/.
