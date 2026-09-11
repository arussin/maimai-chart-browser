"""Generate only synthetic public assets; personal fixture is outside served root."""

from pathlib import Path

from maimai_intelligence.lab import build_lab
from maimai_intelligence.site import build_site
from maimai_intelligence.snapshots import atomic_json
from tests.lab_fixture import write_package
from tests.personal_fixture import fixture

pack, snapshot, mapping, settings, bundle = fixture()
root = Path("output/browser-tests")
build_site(pack, root, catalog_version="synthetic-v1")
build_site(pack, root, catalog_version="synthetic-v2")
# Reset default while retaining both release URLs.
build_site(pack, root, catalog_version="synthetic-v1")
atomic_json(Path("output/personal-fixture.json"), bundle)
build_lab(write_package(Path("output/lab-fixture")), root / "lab", catalog_version="fixture-v1")
