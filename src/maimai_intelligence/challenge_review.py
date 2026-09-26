"""Public chart browsing, pattern reference and chart comparisons."""

from __future__ import annotations

import base64
import json
from importlib.resources import files

from .browser_bundle import browser_configuration, offline_script
from .catalog_preparation import PreparedCatalog, prepare_catalog


def _encoded(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )


def review_scripts(*, player_pilot=False):
    """Compatibility name for the single self-contained browser build."""
    return offline_script()


def render_review(
    package,
    catalog,
    review,
    snippets,
    benchmark,
    navigation=None,
    overview=None,
    artwork=None,
    mai_notes=None,
    provider_mapping=None,
    browser_metadata=None,
    maishift_mapping=None,
):
    """Compatibility facade for existing standalone catalog callers."""
    prepared = prepare_catalog(
        package,
        catalog,
        review,
        snippets,
        benchmark,
        navigation,
        overview,
        artwork,
        mai_notes,
        provider_mapping,
        browser_metadata,
        maishift_mapping,
    )
    return render_prepared_review(prepared)


def render_prepared_review(prepared: PreparedCatalog, *, hosted=False) -> str:
    """Render the existing presentation from an already prepared public catalog."""
    if not isinstance(prepared, PreparedCatalog):
        raise ValueError("Expected a prepared public catalog")
    data, patterns = prepared.data, prepared.patterns
    assets = files("maimai_intelligence.assets")
    css = "\n".join(
        assets.joinpath(name).read_text("utf-8")
        for name in (
            "challenge-review.css",
            "localization.css",
            "chart-visuals.css",
            "pattern-lessons.css",
            "chart-overview.css",
            "chart-filters.css",
            "support-footer.css",
            "support-checkout.css",
            "site-brand.css",
            "analytics.css",
            "player-data.css",
        )
    )
    creator_support = assets.joinpath("creator-support.html").read_text("utf-8")
    if not hosted:
        wordmark = base64.b64encode(assets.joinpath("stripe-wordmark.svg").read_bytes()).decode()
        creator_support = creator_support.replace(
            'src="stripe-wordmark.svg"', f'src="data:image/svg+xml;base64,{wordmark}"'
        )
    html = assets.joinpath("challenge-review.html").read_text("utf-8")
    if not hosted:
        html = html.replace(
            '<script id="challenge-data"',
            '<script id="browser-configuration" type="application/json">'
            + _encoded(browser_configuration())
            + '</script><script id="challenge-data"',
        )
    return (
        html.replace("__CSS__", css)
        .replace("__FAVICON__", assets.joinpath("favicon.html").read_text("utf-8"))
        .replace("__SETTINGS_MENU__", assets.joinpath("settings-menu.html").read_text("utf-8"))
        .replace("__SITE_BRAND__", assets.joinpath("site-brand.html").read_text("utf-8"))
        .replace(
            "__SUPPORT_FOOTER__",
            assets.joinpath("support-footer.html")
            .read_text("utf-8")
            .replace('<details class="footer-credits">', '<details class="footer-credits" open>'),
        )
        .replace("__CREATOR_SUPPORT__", creator_support)
        .replace(
            "__ANALYTICS_CONTROLS__", assets.joinpath("analytics-controls.html").read_text("utf-8")
        )
        .replace("__PATTERNS__", _encoded(patterns))
        .replace("__DATA__", _encoded(data))
        .replace("__JS__", "" if hosted else review_scripts())
    )
