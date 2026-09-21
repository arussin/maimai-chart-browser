"""Generate only synthetic public assets; personal fixture is outside served root."""

import json
import os
import shutil
import tempfile
from hashlib import sha256
from pathlib import Path

from maimai_intelligence import player_data
from maimai_intelligence.lab import build_lab
from maimai_intelligence.mai_notes import prepare_links
from maimai_intelligence.metadata_waterfall import accept as accept_metadata
from maimai_intelligence.metadata_waterfall import propose as propose_metadata
from maimai_intelligence.multilingual_search import enrich_registry
from maimai_intelligence.official_inventory import assertion
from maimai_intelligence.public_release import build_public_release
from maimai_intelligence.registry import accept_mapping, digest
from maimai_intelligence.registry_catalog import build_registry_package
from maimai_intelligence.site import build_site
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import write
from tests.artwork_fixture import IMAGE, add_artwork
from tests.browser.capacity_fixture import build_capacity_fixture
from tests.browser.filter_preview import build_preview
from tests.lab_fixture import write_package
from tests.mai_notes_fixture import encoded as mai_notes_index
from tests.personal_fixture import fixture
from tests.registry_fixture import admit, official_row
from tests.registry_fixture import fixture as registry_fixture
from tests.test_pattern_community import CASES
from tests.test_pattern_sequences import chart_for
from tests.test_player_reconciliation import fixture as reconciliation_fixture

pack, snapshot, mapping, settings, bundle = fixture()
root = Path(os.environ.get("MAIMAI_BROWSER_OUTPUT", "output/browser-tests"))
build_site(pack, root, catalog_version="synthetic-v1")
build_site(pack, root, catalog_version="synthetic-v2")
# Reset default while retaining both release URLs.
build_site(pack, root, catalog_version="synthetic-v1")
atomic_json(Path("output/personal-fixture.json"), bundle)
atomic_json(Path("output/reconciliation-fixture.json"), reconciliation_fixture())
player_data.write(
    Path("output/player-accessibility.gz"),
    player_data.seal(
        player_data.empty(
            {
                "provider": "kamaitachi",
                "game": "maimaidx",
                "username": "fixture",
                "displayName": "Synthetic Player",
                "key": "kamaitachi:maimaidx:fixture",
            }
        )
    ),
)
build_lab(write_package(Path("output/lab-fixture")), root / "lab", catalog_version="fixture-v5")
community_charts = []
for key, (body, _) in CASES.items():
    chart = chart_for(body)
    chart.update(chart_id="community-" + key, song_id="community-" + key)
    community_charts.append(chart)
build_lab(
    write_package(Path("output/community-fixture"), charts=community_charts),
    root / "community",
    catalog_version="community-v1",
)
build_capacity_fixture(root)
build_lab(
    write_package(Path("output/constant-fixture"), grouped=True, constants=True),
    root / "constants",
    catalog_version="constants-v1",
)
# Fixtures can be regenerated; production release directories stay immutable.
for source, target in [("lab", "progressive"), ("capacity", "progressive-capacity")]:
    with tempfile.TemporaryDirectory() as temporary:
        staged = Path(temporary) / "public"
        build_public_release(root / source, staged)
        shutil.copytree(staged, root / target, dirs_exist_ok=True)
build_lab(
    write_package(Path("output/grouped-fixture"), grouped=True),
    root / "grouped",
    catalog_version="grouped-v2",
)
artwork_package = write_package(Path("output/artwork-fixture"))
add_artwork(artwork_package)
build_lab(artwork_package, root / "artwork", catalog_version="artwork-v1")
level_package = write_package(Path("output/level-fixture").resolve())
charts = json.loads((level_package / "catalog.json").read_text("utf-8"))
for chart, level in zip(charts, ["10", "10+", "11", "12", "13+", "14"], strict=True):
    chart["level"] = level
package = read_json(level_package / "package.json")
package["files"] = [r for r in package["files"] if r["path"] != "catalog.json"]
package["files"].append(write(level_package, "catalog.json", charts))
atomic_json(level_package / "package.json", package)
build_lab(level_package, root / "levels", catalog_version="levels-v1")

# Cross-category levels, an unknown level and a grouped RE:MASTER whose level
# is lower than MASTER distinguish row sorting from chart-picker ordering.
difficulty_package = write_package(Path("output/difficulty-sort-fixture").resolve(), grouped=True)
charts = json.loads((difficulty_package / "catalog.json").read_bytes())
for chart, level in zip(charts, ["10", "10+", "9+", "11", None, "10+"], strict=True):
    chart["level"] = level
package = read_json(difficulty_package / "package.json")
package["files"] = [r for r in package["files"] if r["path"] != "catalog.json"]
package["files"].append(write(difficulty_package, "catalog.json", charts))
atomic_json(difficulty_package / "package.json", package)
build_lab(difficulty_package, root / "difficulty-sort", catalog_version="difficulty-sort-v1")

# Authored profiles with real public title labels exercise search metadata only.
# These are not transcriptions, analyses or qualified mappings of the named songs.
search_package = write_package(Path("output/search-fixture").resolve())
search_charts = json.loads((search_package / "catalog.json").read_text("utf-8"))
search_labels = [
    ("ウミユリ海底譚", "n-buna"),
    ("ウミユリ海底譚", "Unrelated fictional artist"),
    ("千本桜", "黒うさP"),
]
for chart, (title, artist) in zip(search_charts, search_labels, strict=False):
    chart.update(title=title, artist=artist)
search_charts[3]["aliases"] = ["Invented refrain"]
search_package_manifest = read_json(search_package / "package.json")
search_package_manifest["files"] = [
    row for row in search_package_manifest["files"] if row["path"] != "catalog.json"
]
search_package_manifest["files"].append(write(search_package, "catalog.json", search_charts))
atomic_json(search_package / "package.json", search_package_manifest)
build_lab(search_package, root / "romaji", catalog_version="romaji-v1")

# Provider UUIDs and chart identities are authored fixtures; the provider is never fetched.
player_package = write_package(Path("output/mai-notes-fixture"), grouped=True)
player_charts = json.loads((player_package / "catalog.json").read_bytes())
player_links, _ = prepare_links(
    player_charts,
    mai_notes_index(player_charts, unavailable={1}),
    captured_at="2026-09-13T00:00:00Z",
)
player_manifest = read_json(player_package / "package.json")
player_manifest["files"].append(write(player_package, "mai-notes.json", player_links))
atomic_json(player_package / "package.json", player_manifest)
build_lab(player_package, root / "mai-notes", catalog_version="mai-notes-v1")
with tempfile.TemporaryDirectory() as temporary:
    staged = Path(temporary) / "public"
    build_public_release(root / "mai-notes", staged)
    shutil.copytree(staged, root / "mai-notes-progressive", dirs_exist_ok=True)
search_pack = json.loads(json.dumps(pack))
for chart, (title, artist) in zip(search_pack["charts"], search_labels, strict=False):
    chart.update(title=title, artist=artist)
build_site(search_pack, root / "romaji-explore", catalog_version="romaji-v1")

with tempfile.TemporaryDirectory() as temporary:
    staging = Path(temporary)
    inventory, _, package = registry_fixture(staging)
    master = next(
        c
        for c in inventory["charts"].values()
        if c["difficulty"] == "MASTER"
        and inventory["songs"][c["song_id"]]["metadata"]["title"] == "ソテリア"
    )
    # Controlled International-only inventory and differing constants exercise
    # preference independently from membership. These numbers are fictional.
    international_jacket = official_row(
        "Soteria fixture", "Regional fixture artist", dx_lev_adv="7", version="26005"
    )
    international_only = official_row("International fixture song", "Synthetic artist")
    inventory, _ = admit(
        inventory,
        [international_jacket, international_only],
        region="INTL",
        when="2026-09-17T06:00:00Z",
        decisions={
            assertion(international_jacket): {
                "action": "link",
                "song_id": master["song_id"],
                "evidence": "Authored regional fixture",
            },
            assertion(international_only): {"action": "admit", "evidence": "Authored Intl fixture"},
        },
    )
    metadata = {
        "schema_version": "reviewed-public-metadata-1",
        "charts": [
            {
                "title": "ソテリア",
                "artist": "Rafutsuri feat.桜あおい",
                "format": "DX",
                "difficulty": difficulty,
                "bpm": 160,
                "chart_constant": constant,
                "region": region,
                "release": "Synthetic release",
                "source_url": "https://example.org/fixture-" + region,
                "evidence": "Authored fixture, no real constant assertion",
            }
            for difficulty, region, constant in [
                ("ADVANCED", "JP", 8.2),
                ("ADVANCED", "INTL", 7.4),
                ("EXPERT", "JP", 12.1),
            ]
        ],
    }
    captures = []
    for region in ("JP", "INTL"):
        raw = json.dumps(
            {**metadata, "charts": [c for c in metadata["charts"] if c["region"] == region]}
        ).encode()
        captures.append(
            (
                "reviewed-page",
                raw,
                {
                    "url": "https://example.org/metadata-fixture-" + region + ".json",
                    "bytes": len(raw),
                    "sha256": sha256(raw).hexdigest(),
                    "captured_at": "2026-09-17T12:00:00Z",
                },
            )
        )
    proposal = propose_metadata(inventory, captures)
    inventory = accept_metadata(
        inventory,
        proposal,
        {
            "proposal_sha256": digest(proposal),
            "evidence": "Authored fixture review",
            "accept": [c["observation_id"] for c in proposal["claims"]],
        },
    )
    source = next(key for key, s in inventory["sources"].items() if s.get("region") == "JP")
    accept_mapping(
        inventory,
        provider="kamaitachi",
        provider_id="chart",
        subject_id=master["chart_id"],
        snapshot_id=source,
        evidence="Synthetic player fixture, no real account",
    )
    build_lab(package, staging / "browser", catalog_version="legacy-fixture")
    inventory, _ = enrich_registry(
        inventory,
        overrides={
            "songs": {
                master["song_id"]: {
                    "title": "ソテリア",
                    "artist": "Rafutsuri feat.桜あおい",
                    "reading": "ソテリア",
                    "aliases": {"en": ["Soteria"], "ko": ["소테리아"], "zh-Hans": ["索特里亚"]},
                }
            }
        },
    )
    build_registry_package(inventory, package, staging / "package")
    # Authored jacket tied to canonical song identity, before regional labels change.
    prepared = staging / "package"
    charts = json.loads((prepared / "catalog.json").read_text("utf-8"))
    song = next(c for c in charts if c["title"] == "ソテリア")
    digest_image = sha256(IMAGE).hexdigest()
    image_path = "media/" + digest_image + ".webp"
    (prepared / "media").mkdir(exist_ok=True)
    (prepared / image_path).write_bytes(IMAGE)
    art = {
        "version": "public-artwork-1",
        "songs": {
            song["song_id"]: {"title": song["title"], "artist": song["artist"], "path": image_path}
        },
        "versions": {},
        "assets": {
            image_path: {"bytes": len(IMAGE), "sha256": digest_image, "source": "authored-fixture"}
        },
    }
    descriptor = read_json(prepared / "package.json")
    descriptor["files"] = [f for f in descriptor["files"] if f["path"] != "artwork.json"]
    descriptor["files"].append(write(prepared, "artwork.json", art))
    atomic_json(prepared / "package.json", descriptor)
    build_lab(staging / "package", staging / "browser", catalog_version="registry-fixture")
    build_public_release(staging / "browser", staging / "public")
    shutil.copytree(staging / "public", root / "registry", dirs_exist_ok=True)

# Interactive local preview uses fictional records, never a personal export.
build_preview(root, Path("output/reconciliation-fixture.json"))
