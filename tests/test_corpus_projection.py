"""Search projections must not change the accepted corpus identity."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.corpus_analysis import inspect_prepared_analysis
from maimai_intelligence.corpus_models import RegistryContext
from maimai_intelligence.corpus_registry import EnrichedRegistry, project_corpus
from maimai_intelligence.multilingual_search import compile_aliases, enrich_registry
from maimai_intelligence.registry import write_registry
from maimai_intelligence.registry_catalog import project_registry
from maimai_intelligence.serialization import digest
from maimai_intelligence.snapshots import read_json
from tests.registry_fixture import fixture


class CorpusProjectionTests(unittest.TestCase):
    def test_search_aliases_preserve_accepted_registry_and_inspectable_package(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            accepted, legacy, package = fixture(root)
            original = deepcopy(accepted)
            run = root / "run"
            write_registry(accepted, run / "registry")
            context = RegistryContext(root, run, {}, root / "browser", package, False)
            with patch(
                "maimai_intelligence.multilingual_search.compile_aliases", wraps=compile_aliases
            ) as compile_once:
                prepared = project_corpus(context, EnrichedRegistry(accepted, {}, None))
            compile_once.assert_called_once()
            self.assertIs(compile_once.call_args.args[0], accepted)
            self.assertEqual(accepted, original)
            self.assertEqual(digest(prepared.accepted), digest(original))
            binding = {"schema_version": original["schema_version"], "sha256": digest(original)}
            self.assertEqual(prepared.prepared["registry"], binding)
            self.assertEqual(prepared.descriptor["registry"], binding)
            self.assertEqual(read_json(run / "registry-provenance.json")["registry"], binding)
            analysis = inspect_prepared_analysis(run, accepted)
            self.assertEqual(analysis["verification"], "run_preparation_package_and_registry")
            self.assertEqual(analysis["package"]["publication_readiness"], "not_verified")
            # Existing search behavior and analysis stay identical to the historical
            # enriched-registry projection, without using it as canonical identity.
            enriched, aliases = enrich_registry(original)
            self.assertEqual(read_json(run / "multilingual-search.json"), aliases)
            historical = project_registry(enriched, legacy)
            for field in ("catalog", "analysis", "provider_mapping", "maishift_mapping"):
                self.assertEqual(prepared.prepared[field], historical[field])
            self.assertNotEqual(digest(enriched), digest(original))

    def test_explicit_search_projection_replaces_only_historical_search_aliases(self):
        with tempfile.TemporaryDirectory() as temp:
            accepted, legacy, _ = fixture(Path(temp))
            sid = next(iter(accepted["songs"]))
            accepted["songs"][sid]["search_aliases"] = [{"value": "Historical search alias"}]
            original = deepcopy(accepted)
            historical = project_registry(accepted, legacy)
            explicit = project_registry(accepted, legacy, search_aliases={sid: ("New alias",)})
            empty = project_registry(accepted, legacy, search_aliases={})
            for data in (historical, explicit, empty):
                self.assertEqual(data["registry"]["sha256"], digest(original))
            rows = [
                next(row for row in data["catalog"] if row["song_id"] == sid)
                for data in (historical, explicit, empty)
            ]
            self.assertIn("Historical search alias", rows[0]["aliases"])
            self.assertNotIn("Historical search alias", rows[1]["aliases"])
            self.assertIn("New alias", rows[1]["aliases"])
            self.assertNotIn("Historical search alias", rows[2]["aliases"])
            self.assertNotIn("New alias", rows[2]["aliases"])
            self.assertEqual(accepted, original)


if __name__ == "__main__":
    unittest.main()
