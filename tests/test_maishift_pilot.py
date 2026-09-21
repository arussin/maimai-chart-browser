import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory, gettempdir

from maimai_intelligence.localization import localization_script
from scripts.build_maishift_pilot import build


class MaishiftPilotArtifactTests(unittest.TestCase):
    @unittest.skipUnless(
        str(Path(gettempdir())).lower().startswith("c:\\devcache\\"),
        "Artifact integration runs in the approved Windows DevCache wrapper",
    )
    def test_artifact_is_isolated_exact_and_verifiable(self):
        # The development wrapper puts TemporaryDirectory under DevCache.
        with TemporaryDirectory() as directory:
            output = Path(directory) / "pilot-artifact"
            manifest = build(output)
            self.assertFalse(manifest["releaseEnabled"])
            self.assertEqual(manifest["entryPath"], "/pilot/maishift/")
            self.assertEqual(manifest["endpoint"], "/api/player-import/maishift")
            self.assertEqual(
                {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()},
                set(manifest["files"]) | {"pilot-artifact.json"},
            )
            for name, fingerprint in manifest["files"].items():
                self.assertEqual(
                    hashlib.sha256((output / name).read_bytes()).hexdigest(), fingerprint
                )
                self.assertTrue(name.startswith("pilot/maishift/") or name == "_headers")
            config = json.loads((output / "pilot/maishift/mapping.json").read_text("utf-8"))
            self.assertEqual(config["build"], manifest["build"])
            self.assertGreater(len(config["mapping"]["charts"]), 12000)
            self.assertEqual(
                {row["chart_id"] for row in config["mapping"]["charts"].values()},
                set(config["targets"]),
            )
            for target in config["targets"].values():
                self.assertEqual(set(target), {"chart_id", "format", "difficulty"})
            html = (output / "pilot/maishift/index.html").read_text("utf-8")
            self.assertNotIn("analytics", html)
            self.assertNotIn("player-data.js", html)
            translated = (output / "pilot/maishift/localization.js").read_text("utf-8")
            self.assertIn('"Maishift pilot test":', translated)
            self.assertNotIn('"Support maimai.party":', translated)
            headers = (output / "_headers").read_text("utf-8")
            self.assertTrue(headers.startswith("/pilot/maishift/*\n"))
            self.assertIn("Referrer-Policy: no-referrer", headers)
            self.assertIn("Cache-Control: no-store", headers)
            with self.assertRaisesRegex(ValueError, "never overwrite"):
                build(output)

    def test_builder_rejects_canonical_source_as_output(self):
        with self.assertRaisesRegex(ValueError, "DevCache"):
            build(Path("C:/Dev/maimai/maimai-chart-browser-registry"))

    def test_localization_subset_keeps_validation_and_default_behavior(self):
        self.assertIn('"Support maimai.party":', localization_script())
        script = localization_script(sources={"Game region"})
        self.assertIn('"Game region":', script)
        self.assertNotIn('"Support maimai.party":', script)
        with self.assertRaises(KeyError):
            localization_script(sources={"Missing pilot translation"})
