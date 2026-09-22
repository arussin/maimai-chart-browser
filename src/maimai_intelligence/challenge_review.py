"""Public chart browsing, pattern reference and chart comparisons."""

from __future__ import annotations

import json
from importlib.resources import files

from .catalog_preparation import PreparedCatalog, prepare_catalog
from .localization import localization_script
from .song_search import song_search_script


def _encoded(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        .replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
    )


def review_scripts(*, player_pilot=False):
    assets = files("maimai_intelligence.assets")
    theme = assets.joinpath("chart-theme.json").read_text("utf-8")
    lessons = _encoded(json.loads(assets.joinpath("pattern-lessons.json").read_text("utf-8")))
    return (
        localization_script()
        + "\n"
        + song_search_script()
        + "\n"
        + "\n".join(
            assets.joinpath(name)
            .read_text("utf-8")
            .replace("__MAIMAI_CHART_THEME__", theme)
            .replace("__MAIMAI_PATTERN_LESSONS__", lessons)
            for name in (
                "view-navigation.js",
                "settings-menu.js",
                "player-import-config.js",
                "player-ranges.js",
                "player-data-core.js",
                "player-maishift.js",
                "player-sources.js",
                "player-storage.js",
                "player-session.js",
                "player-data.js",
                "feature-announcements.js",
                "support-config.js",
                "support-client.js",
                "support-stripe.js",
                "chart-visuals.js",
                "pattern-library.js",
                "challenge-matching.js",
                "chart-links.js",
                "chart-artwork.js",
                "chart-filters.js",
                "chart-overview.js",
                "pattern-filter.js",
                "catalog-query.js",
                "registry-browser.js",
                "chart-comparison.js",
                "challenge-review.js",
            )
            if not player_pilot
            or name
            not in {
                "feature-announcements.js",
                "support-config.js",
                "support-client.js",
                "support-stripe.js",
            }
        )
    )


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


def render_prepared_review(prepared: PreparedCatalog) -> str:
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
    html = assets.joinpath("challenge-review.html").read_text("utf-8")
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
        .replace("__CREATOR_SUPPORT__", assets.joinpath("creator-support.html").read_text("utf-8"))
        .replace(
            "__ANALYTICS_CONTROLS__", assets.joinpath("analytics-controls.html").read_text("utf-8")
        )
        .replace("__PATTERNS__", _encoded(patterns))
        .replace("__DATA__", _encoded(data))
        .replace("__JS__", review_scripts())
    )
