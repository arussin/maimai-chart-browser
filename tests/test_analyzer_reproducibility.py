"""One portable byte reference for the six authored profiles across the CI matrix."""

import hashlib
import unittest

from maimai_analyzer import canonical_bytes, synthetic_profiles
from maimai_analyzer.contracts import ANALYZER_VERSION


class AnalyzerReproducibilityTests(unittest.TestCase):
    def test_frozen_synthetic_profiles_match_the_cross_platform_reference(self):
        # Captured with Python 3.12.14 on Windows after semantic fixture assertions.
        # Linux 3.11/3.13 and Windows 3.13 independently assert identical bytes.
        # A deliberate grammar/config change needs its own version and review of
        # the semantic regressions before updating this compatibility reference.
        self.assertEqual(ANALYZER_VERSION, "0.1.1-experimental")
        self.assertEqual(
            hashlib.sha256(canonical_bytes(synthetic_profiles())).hexdigest(),
            "279b2b10fd4b27443f24b0dbb0bf17192fe7261a905fe72f1815d0599d6b3ede",
        )
