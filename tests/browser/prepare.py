"""Generate only synthetic public assets; personal fixture is outside served root."""

import json
import os
from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.site import build_site
from maimai_intelligence.snapshots import atomic_json, read_json
from scripts.build_challenge_package import write
from tests.artwork_fixture import add_artwork
from tests.lab_fixture import write_package
from tests.personal_fixture import fixture

pack, snapshot, mapping, settings, bundle = fixture()
root = Path(os.environ.get("MAIMAI_BROWSER_OUTPUT", "output/browser-tests"))
build_site(pack, root, catalog_version="synthetic-v1")
build_site(pack, root, catalog_version="synthetic-v2")
# Reset default while retaining both release URLs.
build_site(pack, root, catalog_version="synthetic-v1")
atomic_json(Path("output/personal-fixture.json"), bundle)
build_lab(write_package(Path("output/lab-fixture")), root / "lab", catalog_version="fixture-v5")
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
search_pack = json.loads(json.dumps(pack))
for chart, (title, artist) in zip(search_pack["charts"], search_labels, strict=False):
    chart.update(title=title, artist=artist)
build_site(search_pack, root / "romaji-explore", catalog_version="romaji-v1")
