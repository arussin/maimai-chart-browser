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
        self.assertEqual(ANALYZER_VERSION, "0.3.0-experimental")
        self.assertEqual(
            hashlib.sha256(canonical_bytes(synthetic_profiles())).hexdigest(),
            "e6b565c6ee3d33c46a5ea885addc168429b72a98d0a18ab3eacfc684ea867bb4",
        )
