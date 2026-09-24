"""Static localized public routes derived only from an accepted catalog.

Permalinks are a separate identity-to-route ledger. Feed the preceding release's
ledger into subsequent builds; mutable metadata never reallocates a saved route.
The generator never reads personal files or performs network acquisition.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from html import escape
from typing import Any
from urllib.parse import quote, unquote, urlencode

from .public_routes import LOCALES, route
from .snapshots import canonical

ORIGIN = "https://maimai.party"
WORDS = {
    "en": [
        "Song",
        "Version",
        "Artist",
        "Genre",
        "BPM",
        "Charts",
        "Format",
        "Difficulty",
        "Level",
        "Constant",
        "Open in chart browser",
        "Back to results",
        "Use maimai international data",
        "Unknown",
        "Songs",
        "Language",
        "Chart details",
        "Open song page",
        "Available charts and public song information.",
        "Songs in this maimai version.",
        "Analysis remains experimental; unavailable information is not inferred.",
    ],
    "ja": [
        "楽曲",
        "バージョン",
        "アーティスト",
        "ジャンル",
        "BPM",
        "譜面",
        "種類",
        "難易度",
        "レベル",
        "譜面定数",
        "譜面ブラウザーで開く",
        "検索結果に戻る",
        "maimaiでらっくす国際版のデータを使用",
        "不明",
        "楽曲",
        "言語",
        "譜面詳細",
        "楽曲ページを開く",
        "収録譜面と公開楽曲情報。",
        "このmaimaiバージョンの楽曲。",
        "解析は試験段階です。不明な情報は推測しません。",
    ],
    "ko": [
        "곡",
        "버전",
        "아티스트",
        "장르",
        "BPM",
        "채보",
        "형식",
        "난이도",
        "레벨",
        "채보 상수",
        "채보 브라우저에서 열기",
        "검색 결과로 돌아가기",
        "maimai 국제판 데이터 사용",
        "알 수 없음",
        "곡",
        "언어",
        "채보 상세",
        "곡 페이지 열기",
        "수록 채보와 공개 곡 정보.",
        "이 maimai 버전의 곡.",
        "분석은 실험 단계이며 확인되지 않은 정보를 추정하지 않습니다.",
    ],
    "zh-hans": [
        "歌曲",
        "版本",
        "艺术家",
        "分类",
        "BPM",
        "谱面",
        "类型",
        "难度",
        "等级",
        "定数",
        "在谱面浏览器中打开",
        "返回搜索结果",
        "使用 maimai 国际版数据",
        "未知",
        "歌曲",
        "语言",
        "谱面详情",
        "打开歌曲页面",
        "收录谱面与公开歌曲信息。",
        "此 maimai 版本收录的歌曲。",
        "分析仍处于实验阶段；不会推断未知信息。",
    ],
}
KEYS = (
    "song",
    "version",
    "artist",
    "genre",
    "bpm",
    "charts",
    "format",
    "difficulty",
    "level",
    "constant",
    "open",
    "back",
    "international",
    "unknown",
    "songs",
    "language",
    "details",
    "song_link",
    "song_description",
    "version_description",
    "qualification",
)
DIFFICULTIES = {
    "en": ("BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER"),
    "ja": ("BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"),
    "ko": ("BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"),
    "zh-hans": ("初级", "高级", "专家", "大师", "宗师"),
}
ORDER = ("BASIC", "ADVANCED", "EXPERT", "MASTER", "RE:MASTER")

TITLE_LABELS = {
    "en": ("Untitled (intentional)", "Title unavailable"),
    "ja": ("無題（意図的な空欄）", "曲名不明"),
    "ko": ("무제 (의도적 공백)", "제목 정보 없음"),
    "zh-hans": ("无题（有意留空）", "曲名未知"),
}


def _title(chart, projection, locale, unknown):
    state = chart.get("title_state")
    if projection.get("title") != chart.get("title"):
        state = "present" if str(projection.get("title") or "").strip() else "missing"
    if state in {"intentional_blank", "missing"}:
        return TITLE_LABELS[locale][state == "missing"]
    return _text(projection.get("title"), unknown)


def empty_permalinks():
    return {"schema_version": "maimai-permalinks-1", "songs": {}, "versions": {}, "redirects": {}}


def _slug(label, identity):
    normalized = unicodedata.normalize("NFKC", str(label)).lower()
    value = "".join(c if unicodedata.category(c)[0] in "LN" else "-" for c in normalized)
    value = re.sub("-+", "-", value).strip("-")[:72].rstrip("-") or "song"
    return value + "-" + hashlib.sha256(identity.encode()).hexdigest()[:12]


def validate_permalinks(value):
    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "songs", "versions", "redirects"}
        or value.get("schema_version") != "maimai-permalinks-1"
    ):
        raise ValueError("Unsupported permalink ledger")
    for group in ("songs", "versions"):
        rows = value[group]
        if not isinstance(rows, dict) or len(rows) > 100_000:
            raise ValueError("Invalid permalink ledger")
        for identity, slug in rows.items():
            if (
                not isinstance(identity, str)
                or not identity
                or len(identity) > 512
                or not isinstance(slug, str)
                or not slug
                or len(slug) > 100
                or any(unicodedata.category(c)[0] not in "LN" and c != "-" for c in slug)
            ):
                raise ValueError("Invalid permalink identity or slug")
        if len(set(rows.values())) != len(rows):
            raise ValueError("Permalink collision requires explicit review")
    if not isinstance(value["redirects"], dict):
        raise ValueError("Invalid permalink redirects")
    for start in value["redirects"]:
        seen, current = set(), start
        while current in value["redirects"]:
            if current in seen or not isinstance(value["redirects"][current], str):
                raise ValueError("Invalid permalink redirect cycle")
            seen.add(current)
            current = value["redirects"][current]
        if current not in value["songs"]:
            raise ValueError("Unknown permalink redirect target")
    return value


def _projection(chart, navigation, international=False):
    nav = navigation.get(chart["chart_id"], {})
    entry = chart.get("regional", {}).get("INTL", {}) if international else {}
    meta = entry.get("metadata", {})

    def known(value):
        return value is not None and value != "" and value != "unknown"

    result = {key: chart.get(key) for key in ("title", "artist", "level")}
    result.update({key: nav.get(key) for key in ("genre", "version", "bpm", "chart_constant")})
    for key in ("title", "artist"):
        if known(meta.get(key)):
            result[key] = meta[key]
    if known(entry.get("level")):
        result["level"] = entry["level"]
    for key in ("genre", "version"):
        if known(meta.get("catcode" if key == "genre" else key)) and known(entry.get(key)):
            result[key] = entry[key]
    if international:
        for key, scopes in nav.get("regional_metrics", {}).items():
            if key in result and known(scopes.get("INTL")):
                result[key] = scopes["INTL"]
    return result


def _text(value, unknown):
    return str(value) if value is not None and value != "" else unknown


def _regional(tag, jp, intl, *, attributes=""):
    return (
        f'<{tag} data-seo-jp="{escape(str(jp), quote=True)}" '
        f'data-seo-intl="{escape(str(intl), quote=True)}"{attributes}>{escape(str(jp))}</{tag}>'
    )


def _document(locale, kind, slug, title, description, body, words, browser_csp=None):
    path = route(locale, kind, slug)
    alternates = "".join(
        f'<link rel="alternate" hreflang="{language}" href="{ORIGIN}{route(code, kind, slug)}">'
        for code, language in LOCALES.items()
    )
    alternates += (
        f'<link rel="alternate" hreflang="x-default" href="{ORIGIN}{route("en", kind, slug)}">'
    )
    language_labels = {"en": "English", "ja": "日本語", "ko": "한국어", "zh-hans": "简体中文"}
    languages = "".join(
        f'<a data-song-page hreflang="{language}" lang="{language}" '
        f'href="{route(code, kind, slug)}">'
        f"{escape(language_labels[code])}</a> "
        for code, language in LOCALES.items()
    )
    policy = (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"
    )
    if browser_csp:
        policy = browser_csp
    return (
        f'<!doctype html><html lang="{LOCALES[locale]}" class="seo-static"><head>'
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><meta '
        'name="referrer" content="no-referrer">'
        f'<meta http-equiv="Content-Security-Policy" content="{escape(policy, quote=True)}">'
        f'<title>{escape(title)} | maimai.party</title><meta name="description" '
        f'content="{escape(description, quote=True)}">'
        f'<link rel="canonical" href="{ORIGIN}{path}">{alternates}'
        '<link rel="stylesheet" '
        'href="/seo-pages.css"><link rel="stylesheet" href="/challenge-review.css">'
        '<meta name="maimai-browser-base" content="/">'
        '<script type="module" data-maimai-browser '
        'src="/browser/browser-entry.js"></script></head><body>'
        f'<a class="skip-link" href="#seo-content">{escape(words["details"])}</a>'
        '<header class="site-header"><a class="brand" href="/">maimai.party</a><nav '
        f'aria-label="{escape(words["language"])}">{languages}</nav></header>'
        f'<main id="seo-content" data-seo-page="{kind[:-1]}" data-locale="{locale}">{body}<'
        "/main></body></html>"
    ).encode()


@dataclass(frozen=True)
class EmittedPublicRoute:
    """Identity recorded while rendering, never reconstructed from HTML or a ledger."""

    path: str
    filename: str
    locale: str
    kind: str
    chart_ids: tuple[str, ...]
    html_sha256: str


@dataclass(frozen=True)
class PreparedSEO:
    assets: dict[str, bytes]
    ledger: dict[str, Any]
    summary: dict[str, int]
    song_bindings: list[dict[str, Any]]
    emitted_routes: tuple[EmittedPublicRoute, ...]


def prepare_seo(
    catalog: dict[str, Any],
    *,
    previous: dict[str, Any] | None = None,
    song_redirects: dict[str, str] | None = None,
    browser_csp: str | None = None,
    catalog_sha: str | None = None,
) -> PreparedSEO:
    """Return public assets, updated route ledger and a reviewable capacity summary."""
    ledger = json.loads(json.dumps(previous if previous is not None else empty_permalinks()))
    validate_permalinks(ledger)
    navigation = catalog.get("navigation", {}).get("charts", {})
    songs = defaultdict(list)
    for chart in catalog.get("catalog", []):
        if (
            isinstance(chart, dict)
            and isinstance(chart.get("song_id"), str)
            and isinstance(chart.get("chart_id"), str)
        ):
            songs[chart["song_id"]].append(chart)
    redirects = {**ledger["redirects"], **(song_redirects or {})}
    for old, new in redirects.items():
        seen = {old}
        while new in redirects:
            if new in seen:
                raise ValueError("Song redirect cycle")
            seen.add(new)
            new = redirects[new]
        if new not in songs:
            raise ValueError("Song redirect target is absent from accepted catalog")
        if old in songs:
            songs[new].extend(songs.pop(old))
        if old in ledger["songs"]:
            ledger["redirects"][old] = new
    versions = defaultdict(set)
    for sid, charts in sorted(songs.items()):
        title = charts[0].get("title") or "song"
        ledger["songs"].setdefault(sid, _slug(title, sid))
        for chart in charts:
            for international in (False, True):
                version = _projection(chart, navigation, international).get("version")
                if version and version != "unknown":
                    versions[str(version)].add(sid)
    for version in sorted(versions):
        ledger["versions"].setdefault(version, _slug(version, version))
    validate_permalinks(ledger)
    from .song_catalog import prepare_song_catalog, validate_song_binding

    assets, sitemap_paths = {}, defaultdict(list)
    emitted_routes: list[EmittedPublicRoute] = []
    catalog_sha = catalog_sha or hashlib.sha256(canonical(catalog)).hexdigest()
    song_references = {}
    for sid, charts in sorted(songs.items()):
        content = prepare_song_catalog(catalog, sid, charts)
        raw = canonical(content)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("Song catalog exceeds 8 MiB")
        digest = hashlib.sha256(raw).hexdigest()
        path = f"song-catalog/{digest}.json"
        assets[path] = raw
        binding = {
            "schema_version": "maimai-song-binding-1",
            "source_catalog_sha256": catalog_sha,
            "song_id": sid,
            "source_song_ids": content["source_song_ids"],
            "path": path,
            "sha256": digest,
            "bytes": len(raw),
        }
        validate_song_binding(binding, catalog_sha, content)
        song_references[sid] = binding
    for locale in LOCALES:
        words = dict(zip(KEYS, WORDS[locale], strict=True))
        for sid, charts in sorted(songs.items()):
            charts = sorted(
                charts,
                key=lambda c: (
                    c.get("format", ""),
                    ORDER.index(c["difficulty"]) if c.get("difficulty") in ORDER else 99,
                    c["chart_id"],
                ),
            )
            first = charts[0]
            jp, intl = _projection(first, navigation), _projection(first, navigation, True)
            title = _title(first, jp, locale, words["unknown"])
            browser = "/?" + urlencode(
                {"view": "catalog", "chart": first["chart_id"], "lang": LOCALES[locale]}
            )
            binding_json = escape(canonical(song_references[sid]).decode(), quote=True)
            body = (
                f'<section class="seo-document" data-song-id="{escape(sid, quote=True)}" '
                f'data-song-binding="{binding_json}" data-catalog-sha256="{catalog_sha}">'
                + _regional("h1", title, _title(first, intl, locale, words["unknown"]))
            )
            artwork = catalog.get("artwork", {})
            art = artwork.get("songs", {}).get(sid, {})
            regions = art.get("regions", {})
            jp_path = regions.get("JP", {}).get("path") or art.get("path")
            intl_path = regions.get("INTL", {}).get("path") or jp_path
            if jp_path in artwork.get("assets", {}):
                if intl_path not in artwork.get("assets", {}):
                    intl_path = jp_path
                body += (
                    f'<img class="seo-artwork" src="/{escape(jp_path, quote=True)}" '
                    f'data-seo-jp-src="/{escape(jp_path, quote=True)}" '
                    f'data-seo-intl-src="/{escape(intl_path, quote=True)}" width="160" '
                    'height="160" alt="">'
                )
            body += (
                '<p class="seo-actions"><a class="seo-primary" data-open-browser '
                f'href="{escape(browser, quote=True)}">{escape(words["open"])}</a> <a '
                f'data-back-results href="/">{escape(words["back"])}</a></p>'
            )
            body += (
                '<label class="check international-data-option"><input type="checkbox" '
                f"data-seo-international>{escape(words['international'])}</label><dl "
                'class="seo-facts">'
            )
            for key in ("artist", "genre", "version", "bpm"):
                body += f"<dt>{escape(words[key])}</dt>" + _regional(
                    "dd",
                    _text(jp.get(key), words["unknown"]),
                    _text(intl.get(key), words["unknown"]),
                )
            body += (
                f'</dl><h2>{escape(words["charts"])}</h2><div class="seo-table"><table><thead><tr>'
            )
            body += "".join(
                f'<th scope="col">{escape(words[key])}</th>'
                for key in ("format", "difficulty", "level", "constant", "details")
            )
            body += "</tr></thead><tbody>"
            for chart in charts:
                base, international = (
                    _projection(chart, navigation),
                    _projection(chart, navigation, True),
                )
                difficulty = chart.get("difficulty", "")
                label = (
                    DIFFICULTIES[locale][ORDER.index(difficulty)]
                    if difficulty in ORDER
                    else difficulty
                )
                link = "/?" + urlencode(
                    {"view": "catalog", "chart": chart["chart_id"], "lang": LOCALES[locale]}
                )
                body += (
                    f'<tr id="chart-{quote(chart["chart_id"], safe="")}"><td>'
                    f"{escape(chart.get('format', ''))}</td><td>{escape(label)}</td>"
                )
                for key in ("level", "chart_constant"):
                    body += _regional(
                        "td",
                        _text(base.get(key), words["unknown"]),
                        _text(international.get(key), words["unknown"]),
                    )
                body += (
                    f'<td><a data-open-browser href="{escape(link, quote=True)}">'
                    f"{escape(words['open'])}</a></td></tr>"
                )
            body += "</tbody></table></div><ul>"
            for version, members in sorted(versions.items()):
                if sid in members:
                    body += (
                        "<li><a data-song-page "
                        f'href="{route(locale, "versions", ledger["versions"][version])}">'
                        f"{escape(version)}</a></li>"
                    )
            body += f'</ul><p class="muted">{escape(words["qualification"])}</p></section>'
            path = route(locale, "songs", ledger["songs"][sid])
            assets[unquote(path[1:]) + "index.html"] = _document(
                locale,
                "songs",
                ledger["songs"][sid],
                title,
                f"{title} — {words['song_description']}",
                body,
                words,
                browser_csp,
            )
            filename = unquote(path[1:]) + "index.html"
            emitted_routes.append(
                EmittedPublicRoute(
                    path,
                    filename,
                    locale,
                    "song",
                    tuple(chart["chart_id"] for chart in charts),
                    hashlib.sha256(assets[filename]).hexdigest(),
                )
            )
            sitemap_paths[locale].append(path)
        for version, members in sorted(versions.items()):
            browser = "/?" + urlencode(
                {"view": "catalog", "release": version, "lang": LOCALES[locale]}
            )
            body = (
                '<section class="seo-document" '
                f'data-seo-version="{escape(version, quote=True)}"><h1>{escape(version)}</h1><'
                f'p>{escape(words["version_description"])}</p><p class="seo-actions"><a '
                f'data-open-browser href="{escape(browser, quote=True)}">'
                f'{escape(words["open"])}</a> <a data-back-results href="/">'
                f"{escape(words['back'])}</a></p>"
            )
            body += (
                '<label class="check international-data-option"><input type="checkbox" '
                f"data-seo-international>{escape(words['international'])}</label><ul "
                'class="seo-song-list">'
            )
            for sid in sorted(members, key=lambda key: (songs[key][0].get("title", ""), key)):
                jp, intl = (
                    _projection(songs[sid][0], navigation),
                    _projection(songs[sid][0], navigation, True),
                )
                regional_members = [
                    any(
                        _projection(chart, navigation, preference).get("version") == version
                        for chart in songs[sid]
                    )
                    for preference in (False, True)
                ]
                body += (
                    f'<li data-seo-jp-visible="{str(regional_members[0]).lower()}" '
                    f'data-seo-intl-visible="{str(regional_members[1]).lower()}"'
                    + ("" if regional_members[0] else " hidden")
                    + ">"
                    + _regional(
                        "a",
                        _title(songs[sid][0], jp, locale, words["unknown"]),
                        _title(songs[sid][0], intl, locale, words["unknown"]),
                        attributes=(
                            f' data-song-page href="{route(locale, "songs", ledger["songs"][sid])}"'
                        ),
                    )
                    + "</li>"
                )
            body += "</ul></section>"
            path = route(locale, "versions", ledger["versions"][version])
            assets[unquote(path[1:]) + "index.html"] = _document(
                locale,
                "versions",
                ledger["versions"][version],
                version,
                f"{version} — {words['version_description']}",
                body,
                words,
                browser_csp,
            )
            filename = unquote(path[1:]) + "index.html"
            emitted_routes.append(
                EmittedPublicRoute(
                    path,
                    filename,
                    locale,
                    "version",
                    (),
                    hashlib.sha256(assets[filename]).hexdigest(),
                )
            )
            sitemap_paths[locale].append(path)
    redirect_lines = [
        "/songs/* /en/songs/:splat 301",
        "/versions/* /en/versions/:splat 301",
        "/zh-Hans/* /zh-hans/:splat 301",
    ]
    for old, target in sorted(ledger["redirects"].items()):
        if old in ledger["songs"]:
            for locale in LOCALES:
                redirect_lines.append(
                    f"{route(locale, 'songs', ledger['songs'][old])} "
                    f"{route(locale, 'songs', ledger['songs'][target])} 301"
                )
    assets["_redirects"] = ("\n".join(redirect_lines) + "\n").encode()
    assets["permalinks.json"] = canonical(ledger) + b"\n"
    for locale, paths in sitemap_paths.items():
        items = "".join(f"<url><loc>{escape(ORIGIN + path)}</loc></url>" for path in sorted(paths))
        assets[f"sitemap-{locale}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8"?><urlset '
            'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + items + "</urlset>"
        ).encode()
    assets["sitemap-pages.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?><urlset '
        f'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{ORIGIN}/</loc></url><'
        "/urlset>".encode()
    )
    items = "".join(
        f"<sitemap><loc>{ORIGIN}/{name}</loc></sitemap>"
        for name in ["sitemap-pages.xml", *(f"sitemap-{locale}.xml" for locale in sitemap_paths)]
    )
    assets["sitemap.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?><sitemapindex '
        'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + items + "</sitemapindex>"
    ).encode()
    assets["404.html"] = (
        b'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" '
        b'content="noindex"><title>Page not found | maimai.party</title><h1>Page not found</h1>'
        b'<a href="/">Open maimai.party</a></html>'
    )
    return PreparedSEO(
        assets,
        ledger,
        {
            "songs": len(songs),
            "versions": len(versions),
            "localized_documents": 4 * (len(songs) + len(versions)),
            "permalink_seeded": previous is not None,
        },
        list(song_references.values()),
        tuple(emitted_routes),
    )


def build_seo(
    catalog: dict[str, Any],
    *,
    previous: dict[str, Any] | None = None,
    song_redirects: dict[str, str] | None = None,
    browser_csp: str | None = None,
    catalog_sha: str | None = None,
) -> tuple[dict[str, bytes], dict[str, Any], dict[str, int]]:
    """Historical tuple API around the one maintained structured preparation."""
    prepared = prepare_seo(
        catalog,
        previous=previous,
        song_redirects=song_redirects,
        browser_csp=browser_csp,
        catalog_sha=catalog_sha,
    )
    return prepared.assets, prepared.ledger, prepared.summary
