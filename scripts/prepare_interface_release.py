"""Assemble an interface-only maimai.party release over the previous release.

Derived from the reviewed ``prepare-publication.py`` that assembled the release
uploaded on October 20, 2026 (commit 2e56402). The assembly steps and the byte
checks are the same. What changed, at Adam's decision on November 22, 2026:

* The hand-gathered capacity review, hosting readback and storage survey are
  replaced by automated checks: a hosting check read from the Cloudflare API,
  the 100,000-file and 25 MiB limits, the live manifest, and free disk space.
* The complete tree is written once, to ``public``, instead of a review copy
  followed by a second assembled copy.
* Authored shell templates must be unchanged since the previous release. A
  release that changes them needs the maintained shell preparation instead.

Both interface and data releases retain a one-default-catalog ``planner-input``.
Catalog bytes and the complete production manifest come from the verified base
``public`` tree, which may advertise many catalogs. Intermediate one-catalog
resource snapshots are not published when sealing to that complete manifest.

Header changes require --allow-headers-change; sitemap changes require an explicit
--release-date. Dates are finalized against the preceding public tree after the
production reseal. Receipts have no generation timestamp; the clock is used only
to enforce the real hosting evidence's existing one-hour freshness gate.

It never uploads, deploys, changes an account or deletes anything. It refuses to
write into an existing release folder. Run with ``-B``.
"""

from __future__ import annotations

import argparse
import difflib
import gzip
import hashlib
import json
import os
import shutil
import stat
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

MAX_FILE = 25 * 1024**2
PAID_FILES = 100_000
FREE_RESERVE = 30 * 1024**3
LIVE_MANIFEST = "https://maimai.party/manifest.json"
DATA = (
    "catalog-parts/",
    "catalog-index/",
    "catalog-index-parts/",
    "chart-details/",
    "song-catalog/",
    "song-catalog-index/",
    "integration/",
    "media/",
)
IMMUTABLE = (*DATA, "browser/", "browser-resources/")
PRESERVED = ("manifest.json", "permalinks.json", "_redirects", "robots.txt")
BRAND_INPUTS = ("favicon.ico", "og-image.png")
SHELL_INPUTS = (
    "challenge-review.html",
    "settings-menu.html",
    "site-brand.html",
    "creator-support.html",
    "analytics-controls.html",
    "support-footer.html",
    "favicon.html",
)
STYLE_INPUTS = (
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
    "player-artwork.css",
)
GIT = "git"
SOURCE = Path()


def require(value, message):
    if not value:
        raise ValueError(message)


def now():
    return datetime.now(UTC)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def fingerprint(raw):
    return {"bytes": len(raw), "sha256": sha(raw)}


_PLAIN_DIRECTORIES: set[str] = set()


def checked(path):
    path = Path(os.path.abspath(path))
    require(not str(path).startswith("\\\\"), "Use an ordinary local path")
    for part in (path, *path.parents):
        key = str(part)
        # A directory already seen to be an ordinary directory in this run is not
        # re-examined for every file beneath it. Files are always examined.
        if key in _PLAIN_DIRECTORIES:
            break
        if not part.exists() and not part.is_symlink():
            continue
        info = part.lstat()
        require(
            not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_reparse_tag", 0) & 0x20000000,
            "Filesystem redirects are not permitted: " + str(part),
        )
        if stat.S_ISDIR(info.st_mode):
            _PLAIN_DIRECTORIES.add(key)
    return path.resolve()


def relative(name):
    require(
        isinstance(name, str) and bool(name) and not any(c in name for c in '\\:%?#*"<>|'),
        "Invalid artifact path",
    )
    require(
        all(p and p not in (".", "..") and not p.endswith((" ", ".")) for p in name.split("/")),
        "Invalid artifact path",
    )
    return name


def raw_file(path, limit=MAX_FILE):
    path = checked(path)
    require(path.is_file(), "Expected a regular file: " + str(path))
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, "Input exceeds its read limit: " + str(path))
    return raw


def read(path, limit=MAX_FILE):
    return json.loads(raw_file(path, limit).decode("utf-8-sig"))


def save(path, value):
    path = checked(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def files(root):
    root = checked(root)
    require(root.is_dir(), "Expected an artifact directory: " + str(root))
    result = {}
    for folder, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            checked(Path(folder) / name)
        for name in names:
            path = checked(Path(folder) / name)
            require(path.is_relative_to(root), "Artifact path escaped its root")
            result[relative(path.relative_to(root).as_posix())] = path
    return result


def inventory(root):
    return {name: fingerprint(raw_file(path)) for name, path in files(root).items()}


def verify(root, expected):
    actual = files(root)
    require(set(actual) == set(expected), "Artifact file set changed: " + str(root))
    for name, path in actual.items():
        require(fingerprint(raw_file(path)) == expected[name], "Artifact bytes changed: " + name)


def git(*args):
    # Fixed read-only Git commands against the named checkout.
    return subprocess.check_output([GIT, "-C", str(SOURCE), *args])  # noqa: S603


def bind_source(expected_commit):
    require(
        git("rev-parse", "HEAD").decode().strip() == expected_commit,
        "Source HEAD is not the expected commit",
    )
    require(not git("status", "--porcelain=v1").strip(), "Release source is not clean")
    # Git reports a file as unmodified even when its working copy has CRLF line
    # endings and the committed bytes have LF. Packaged files are copied raw, so
    # such a copy changes checksums and every page that links the file. Found on
    # November 22, 2026: one CRLF stylesheet changed 8,610 song pages.
    for line in git("ls-files", "--eol", "--", "src").decode().splitlines():
        info, _, name = line.partition("\t")
        index, working = info.split()[:2]
        require(
            index.removeprefix("i/") == working.removeprefix("w/"),
            "Working copy line endings differ from the committed bytes: " + name,
        )


def baseline(base):
    """The previous release's full inventory, verified against its files on disk."""
    for candidate in (base / "inventory.json.gz", base / "review" / "inventory.json.gz"):
        if candidate.is_file():
            with gzip.open(candidate, "rb") as stream:
                raw = stream.read(16 * 1024**2 + 1)
            break
    else:
        raise ValueError("Previous release has no recorded inventory")
    require(len(raw) <= 16 * 1024**2, "Recorded inventory is too large")
    rows = json.loads(raw)
    verify(base / "public", rows)
    return rows, sha(raw), read(base / "public" / "manifest.json")


def live_manifest():
    request = urllib.request.Request(
        LIVE_MANIFEST,
        headers={
            "User-Agent": "Maimai-Verification/1 (owner release check)",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=40) as response:  # noqa: S310 -- fixed HTTPS URL
        return response.read(8 * 1024**2)


def hosting_check(path, base_deployment):
    """Automated replacement for the capacity review: read back from the Cloudflare API."""
    check = read(path)
    require(check.get("schema") == "maimai-hosting-check-1", "Unexpected hosting check")
    observed = datetime.fromisoformat(check["observed_at"].replace("Z", "+00:00"))
    require(
        0 <= (now() - observed).total_seconds() <= 3600,
        "Refresh the hosting check; maximum age is one hour",
    )
    require(
        check["project"] == "maimai-party" and check["source"] == "direct-upload",
        "Unexpected Pages project",
    )
    require(
        check["zone_plan"] == "Pro Website",
        "The zone is no longer on the plan that permits this many files",
    )
    require(
        check["pages_wrangler_major_version"] == "4",
        "The Pages upload setting for large releases differs",
    )
    require(
        check["production_deployment"] == base_deployment,
        "Production is not the release this candidate is built on",
    )
    return check


def observed_manifest(args, hosting):
    """Use an explicitly supplied observation offline, or the legacy live read."""
    path = getattr(args, "observed_manifest", None)
    if path is None:
        return live_manifest()
    raw = raw_file(path, 8 * 1024**2)
    require(
        hosting.get("live_manifest_sha256") == sha(raw),
        "Saved manifest must be bound by live_manifest_sha256 in the fresh hosting check",
    )
    return raw


def configuration_changes(previous, current, *, allow_invitation_change=False):
    """Messages may refresh; only support.invitation has a separate opt-in."""
    old = {k: v for k, v in previous.items() if k != "messages"}
    new = {k: v for k, v in current.items() if k != "messages"}
    old_support, new_support = old.get("support", {}), new.get("support", {})
    before, after = old_support.get("invitation"), new_support.get("invitation")
    change = None
    if before != after:
        require(
            allow_invitation_change, "Support invitation changed; pass --allow-invitation-change"
        )
        require(
            isinstance(before, str) and isinstance(after, str),
            "Invitation opt-in permits only replacement text",
        )
        change = {"old": before, "new": after}
        new = {**new, "support": {**new_support, "invitation": before}}
    require(old == new, "Unrequested feature, payment or analytics configuration change")
    return change


def planner_refresh_preflight(planner, base_commit, *, allow_invitation_change=False):
    """Resolve and validate every shell/configuration seam before allocation."""
    from maimai_intelligence.browser_bundle import (
        STATIC_RESOURCES,
        browser_assets,
        browser_configuration,
    )
    from maimai_intelligence.localization import localization_script

    assets = SOURCE / "src/maimai_intelligence/assets"
    for name in SHELL_INPUTS:
        old = git("show", base_commit + ":src/maimai_intelligence/assets/" + name).replace(
            b"\r\n", b"\n"
        )
        current = raw_file(assets / name).replace(b"\r\n", b"\n")
        require(old == current, "Authored shell changed; use maintained shell preparation: " + name)
    styles = raw_file(planner / "challenge-review.css").decode("utf-8").replace("\r\n", "\n")
    changed_styles = []
    for name in STYLE_INPUTS:
        old = (
            git("show", base_commit + ":src/maimai_intelligence/assets/" + name)
            .decode()
            .replace("\r\n", "\n")
        )
        new = raw_file(assets / name).decode("utf-8").replace("\r\n", "\n")
        require(styles.count(old) == 1, "Expected one complete baseline stylesheet: " + name)
        styles = styles.replace(old, new, 1)
        if old != new:
            changed_styles.append(name)
    replacements = {"challenge-review.css": styles.encode("utf-8")}
    previous = read(planner / "browser-config.json")
    current = browser_configuration(
        player_pilot=previous["pilot"], player_maishift=previous["features"]["maishift"]
    )
    invitation = configuration_changes(
        previous, current, allow_invitation_change=allow_invitation_change
    )
    browser_assets()  # Verifies the generated dependency graph and every copied source.
    for name in (*STATIC_RESOURCES, *BRAND_INPUTS, "support.html", "support-return.html"):
        if name not in ("challenge-review.css", "localization.js"):
            replacements[name] = raw_file(assets / name)
    replacements["localization.js"] = localization_script().encode()
    return {
        "replacements": replacements,
        "previous_configuration": previous,
        "expected_configuration": current,
        "receipt": {
            "unchanged_shell_templates": list(SHELL_INPUTS),
            "changed_stylesheets": changed_styles,
            "stylesheet_matches_per_input": 1,
            "validated_before_allocation": True,
            "invitation_change": invitation,
        },
    }


def refresh_planner(planner, prepared):
    from maimai_intelligence.browser_bundle import write_browser_assets
    from maimai_intelligence.player_help import build_player_help

    previous = prepared["previous_configuration"]
    require(
        read(planner / "browser-config.json") == previous, "Copied planner configuration changed"
    )
    write_browser_assets(
        planner, player_pilot=previous["pilot"], player_maishift=previous["features"]["maishift"]
    )
    require(
        read(planner / "browser-config.json") == prepared["expected_configuration"],
        "Prepared browser configuration changed",
    )
    for name, body in prepared["replacements"].items():
        (planner / name).write_bytes(body)
    build_player_help(planner)


def materialize(target, rows, delta, base_public):
    target.mkdir()
    for name, row in sorted(rows.items(), key=lambda item: (item[0] == "manifest.json", item[0])):
        destination = checked(target / name)
        require(destination.is_relative_to(target), "Materialization path escaped output")
        destination.parent.mkdir(parents=True, exist_ok=True)
        raw = delta.get(name)
        if raw is None:
            raw = raw_file(base_public / name)
        require(fingerprint(raw) == row, "Selected bytes changed: " + name)
        with destination.open("xb") as stream:
            stream.write(raw)


def seal_production_resources(plan, manifest):
    """Replace only the planner's catalog snapshot with the production directory.

    The planner seals once with its one-catalog manifest. Keeping that temporary
    snapshot on reseal would add a spurious file to every multi-catalog no-op.
    Published paths remain in the base inventory, including historical snapshots.
    """
    from maimai_intelligence import public_release
    from maimai_intelligence.browser_bundle import (
        seal_browser_resources,
        validate_browser_resources,
    )

    pending = {name: body for name, body in plan.assets.items() if not name.startswith(DATA)}
    if "browser-resources.json" in pending:
        reference = validate_browser_resources(
            json.loads(pending["browser-resources.json"])
        ).catalog
        expected = encoded(public_release._plain(plan.manifest)) + b"\n"
        require(
            pending.get(reference.path) == expected
            and fingerprint(expected) == {"bytes": reference.bytes, "sha256": reference.sha256},
            "Planner catalog resource differs from its manifest",
        )
        if expected != encoded(manifest) + b"\n":
            del pending[reference.path]
    return seal_browser_resources(pending, manifest)


def finalize_sitemap_dates(pending, plan_assets, previous_public, release_date):
    """Date the final production shell, with verified song data for comparison.

    The compact planner cannot accept the full previous multi-catalog manifest:
    it would reject the omitted historical catalogs. Supply that public tree to
    the canonical date finalizer here, after our final production reseal instead.
    Catalog data is available to the comparator, never added to the shell delta.
    """
    from maimai_intelligence.sitemap_dates import date_sitemaps

    comparable = {**plan_assets, **pending}
    date_sitemaps(comparable, previous_public, release_date, home_catalog_unchanged=True)
    pending.update({name: body for name, body in comparable.items() if name.startswith("sitemap")})


def metadata_changes(pending, prior, base_public, *, allow_headers_change, release_date):
    """Enforce immutable bytes and explicit metadata opt-ins; describe final dates."""
    from maimai_intelligence.sitemap_dates import validate_release_date

    validate_release_date(release_date)
    for name, body in pending.items():
        relative(name)
        if name in prior and (name.startswith(IMMUTABLE) or name in PRESERVED):
            require(
                fingerprint(body) == prior[name],
                "Immutable bytes or production metadata changed: " + name,
            )
    headers_diff = ""
    if "_headers" in pending and fingerprint(pending["_headers"]) != prior.get("_headers"):
        require(allow_headers_change, "_headers changed; pass --allow-headers-change")
        old = raw_file(base_public / "_headers") if "_headers" in prior else b""
        headers_diff = "".join(
            difflib.unified_diff(
                old.decode("utf-8").splitlines(keepends=True),
                pending["_headers"].decode("utf-8").splitlines(keepends=True),
                fromfile="previous/_headers",
                tofile="candidate/_headers",
            )
        )
    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

    def entries(raw):
        root = ET.fromstring(raw)  # noqa: S314 -- sitemaps this run generated or published
        require(
            root.tag in (namespace + "urlset", namespace + "sitemapindex"),
            "Unexpected sitemap root",
        )
        kind = "url" if root.tag == namespace + "urlset" else "sitemap"
        result = {}
        for node in root.findall(namespace + kind):
            loc = node.findtext(namespace + "loc")
            require(loc and loc not in result, "Missing or duplicate sitemap location")
            require(len(node.findall(namespace + "lastmod")) <= 1, "Duplicate sitemap date")
            result[loc] = validate_release_date(node.findtext(namespace + "lastmod"))
        return kind, result

    sitemaps = {}
    for name in sorted(pending):
        if not name.startswith("sitemap"):
            continue
        changed = fingerprint(pending[name]) != prior.get(name)
        require(
            not changed or release_date is not None,
            "Sitemap changed; pass --release-date YYYY-MM-DD: " + name,
        )
        kind, current = entries(pending[name])
        previous = entries(raw_file(base_public / name))[1] if name in prior else {}
        counts = {"kept_date": 0, "release_date": 0, "no_date": 0}
        for loc, modified in current.items():
            if modified is None:
                counts["no_date"] += 1
            elif previous.get(loc) == modified:
                counts["kept_date"] += 1
            else:
                # Index dates are maxima of child dates and can legitimately
                # predate this release; report those separately, never as URLs.
                require(
                    modified == release_date or kind == "sitemap",
                    "Unexpected new sitemap URL date: " + name,
                )
                key = "release_date" if modified == release_date else "child_maximum_date"
                counts[key] = counts.get(key, 0) + 1
        sitemaps[name] = {
            "changed": changed,
            "entry_kind": kind,
            "entries": len(current),
            **counts,
            "removed_entries": len(previous.keys() - current.keys()),
        }
    return {
        "allow_headers_change": allow_headers_change,
        "release_date": release_date,
        "headers_diff": headers_diff,
        "sitemaps": sitemaps,
    }


def files_by_kind(names):
    result = {}
    for name in names:
        kind = (
            "headers"
            if name == "_headers"
            else "sitemaps"
            if name.startswith("sitemap")
            else "browser_resources"
            if name.startswith("browser-resources")
            else "browser_scripts"
            if name.startswith("browser/")
            else "localized_pages"
            if name.endswith(".html") and "/" in name
            else "root_html"
            if name.endswith(".html")
            else "brand_assets"
            if name in BRAND_INPUTS
            else "other"
        )
        result.setdefault(kind, []).append(name)
    return result


def prepare(args):
    from maimai_intelligence import public_release
    from maimai_intelligence.catalog_document import decode_catalog_document
    from maimai_intelligence.export_artwork import (
        read_export_artwork_assets,
        read_export_artwork_manifest,
    )
    from maimai_intelligence.release_composition import inventory_from_records
    from maimai_intelligence.sitemap_dates import validate_release_date

    validate_release_date(args.release_date)
    base, release = checked(args.base_release), checked(args.release)
    require(
        not release.exists(), "Release folder already exists; never overwrite or retry in place"
    )
    require(release.parent.is_dir(), "Release parent folder is missing")
    bind_source(args.expected_commit)
    hosting = hosting_check(args.hosting_check, args.base_deployment)
    prior, prior_inventory_sha, manifest = baseline(base)
    live = observed_manifest(args, hosting)
    require(
        live == raw_file(base / "public" / "manifest.json"),
        "The live site is not the release this candidate is built on",
    )
    planner_rows = inventory(base / "planner-input")
    total_prior = sum(row["bytes"] for row in prior.values())
    require(
        shutil.disk_usage(release.parent).free >= FREE_RESERVE + 2 * total_prior,
        "Not enough free disk space",
    )
    refresh = planner_refresh_preflight(
        base / "planner-input",
        args.base_commit,
        allow_invitation_change=getattr(args, "allow_invitation_change", False),
    )
    input_manifest = read(base / "planner-input" / "manifest.json")
    require(
        input_manifest["schema_version"] == "1.0.0"
        and input_manifest["default"] == manifest["default"]
        and len(input_manifest["releases"]) == 1
        and input_manifest["releases"][0]["version"] == manifest["default"],
        "Unexpected retained planner catalog",
    )
    version = manifest["default"]
    require(
        len({entry["version"] for entry in manifest["releases"]}) == len(manifest["releases"]),
        "Duplicate production catalog",
    )
    public_entry = next(entry for entry in manifest["releases"] if entry["version"] == version)
    raw, integration = public_release.read_public_catalog_inputs(base / "public", public_entry)
    document = decode_catalog_document(input_manifest["releases"][0], raw, integration)
    export_index = read_export_artwork_manifest()
    extra_media = set(export_index["assets"]) if args.export_artwork_source else set()
    if args.export_artwork_source:
        source = checked(args.export_artwork_source)
        for name in extra_media:
            relative(name)
            require(
                checked(source / name).is_relative_to(source),
                "Export media escaped the explicit source",
            )
        read_export_artwork_assets(source, manifest=export_index)
    require(not release.exists(), "Release folder appeared during preflight")
    release.mkdir()
    planner = release / "planner-input"
    shutil.copytree(base / "planner-input", planner)
    verify(planner, planner_rows)
    refresh_planner(planner, refresh)
    plan = public_release.plan_public_release(
        planner,
        permalinks=base / "public" / "permalinks.json",
        prepared_catalogs={version: document},
        preserve_web_analytics=True,
        export_artwork_source=args.export_artwork_source,
        release_date=args.release_date,
    )
    for name, body in plan.assets.items():
        if name.startswith(DATA):
            require(
                fingerprint(body) == prior.get(name) or name not in prior and name in extra_media,
                "Unexpected catalog/thumbnail change: " + name,
            )
    planned_entry = public_release._plain(plan.manifest)["releases"][0]
    require(
        {k: v for k, v in planned_entry.items() if k != "song_catalog_indexes"}
        == {k: v for k, v in public_entry.items() if k != "song_catalog_indexes"},
        "Default catalog references changed",
    )
    require(
        all(
            row in public_entry.get("song_catalog_indexes", [])
            for row in planned_entry.get("song_catalog_indexes", [])
        ),
        "New catalog index was not approved",
    )
    pending = seal_production_resources(plan, manifest)
    pending.update({name: plan.assets[name] for name in extra_media})
    pending["manifest.json"] = raw_file(base / "public" / "manifest.json")
    finalize_sitemap_dates(pending, plan.assets, base / "public", args.release_date)
    metadata = metadata_changes(
        pending,
        prior,
        base / "public",
        allow_headers_change=args.allow_headers_change,
        release_date=args.release_date,
    )
    delta = {name: body for name, body in pending.items() if fingerprint(body) != prior.get(name)}
    rows = {**prior, **{name: fingerprint(body) for name, body in delta.items()}}
    inventory_from_records(rows)  # Strict path, case-alias, hash and directory validation.
    require(prior.keys() <= rows.keys(), "A previously published path would disappear")
    require(rows["manifest.json"] == prior["manifest.json"], "The production manifest would change")
    require(max(row["bytes"] for row in rows.values()) <= MAX_FILE, "Per-file Pages limit exceeded")
    require(len(rows) <= PAID_FILES, "Pages file limit for the paid plan exceeded")
    bind_source(args.expected_commit)
    materialize(release / "public", rows, delta, base / "public")
    verify(release / "public", rows)
    inventory_raw = encoded(rows)
    with (release / "inventory.json.gz").open("xb") as stream:
        stream.write(gzip.compress(inventory_raw, mtime=0))
    added = sorted(name for name in delta if name not in prior)
    changed = sorted(name for name in delta if name in prior)

    def page(name):
        return name.endswith(".html") and "/" in name

    receipt = {
        "schema": "maimai-interface-release-1",
        "status": "complete_verified_not_deployed",
        "published": False,
        "root": str(release / "public"),
        "source": str(SOURCE),
        "source_commit": args.expected_commit,
        "script_sha256": sha(raw_file(__file__)),
        "base_release": str(base),
        "base_commit": args.base_commit,
        "base_deployment": args.base_deployment,
        "base_inventory_sha256": prior_inventory_sha,
        "base_manifest_sha256": sha(live),
        "live_manifest_matched_base": getattr(args, "observed_manifest", None) is None,
        "saved_manifest_matched_base": getattr(args, "observed_manifest", None) is not None,
        "inventory_sha256": sha(inventory_raw),
        "files": len(rows),
        "bytes": sum(row["bytes"] for row in rows.values()),
        "changed_files": len(changed),
        "added_files": len(added),
        "removed_files": 0,
        "changed_pages": sum(1 for name in changed if page(name)),
        "added_pages": sum(1 for name in added if page(name)),
        "changed_other": [name for name in changed if not page(name)],
        "added_other": [name for name in added if not page(name)],
        "changed_by_kind": files_by_kind(changed),
        "added_by_kind": files_by_kind(added),
        "metadata_changes": metadata,
        "all_previous_paths_retained": True,
        "production_manifest_unchanged": True,
        "limits": {
            "files": PAID_FILES,
            "file_bytes": MAX_FILE,
            "largest_file_bytes": max(row["bytes"] for row in rows.values()),
        },
        "hosting_check": hosting,
        "planner_refresh": refresh["receipt"],
        "generated_plan_summary": public_release._plain(plan.summary),
        "export_artwork_source": str(checked(args.export_artwork_source))
        if args.export_artwork_source
        else None,
        "remaining_gates": ["preview upload and checks", "Adam's approval before production"],
    }
    save(release / "preparation.json", receipt)
    print(
        json.dumps(
            {
                key: receipt[key]
                for key in (
                    "status",
                    "files",
                    "bytes",
                    "changed_files",
                    "added_files",
                    "changed_pages",
                    "added_pages",
                    "changed_other",
                    "added_other",
                    "inventory_sha256",
                )
            },
            indent=1,
        )
    )


def main():
    global GIT, SOURCE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, required=True, help="Clean checkout of the commit being released"
    )
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument(
        "--base-release",
        type=Path,
        required=True,
        help="Previous release folder (public, planner-input, inventory)",
    )
    parser.add_argument(
        "--base-commit", required=True, help="Commit the previous release was built from"
    )
    parser.add_argument(
        "--base-deployment", required=True, help="Pages deployment id that is in production now"
    )
    parser.add_argument("--release", type=Path, required=True, help="Fresh folder for this release")
    parser.add_argument("--hosting-check", type=Path, required=True)
    parser.add_argument(
        "--observed-manifest", type=Path, help="Saved live manifest; no network read"
    )
    parser.add_argument("--allow-invitation-change", action="store_true")
    parser.add_argument("--export-artwork-source", type=Path)
    parser.add_argument(
        "--allow-headers-change",
        action="store_true",
        help="Explicitly permit a recorded _headers diff",
    )
    parser.add_argument(
        "--release-date", help="Explicit YYYY-MM-DD; required whenever any sitemap changes"
    )
    parser.add_argument("--git", default="git")
    args = parser.parse_args()
    GIT, SOURCE = args.git, checked(args.source)
    prepare(args)


if __name__ == "__main__":
    main()
