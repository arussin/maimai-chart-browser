"""Provider identity is portable; no test infers an upstream Maishift schema."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from maimai_intelligence import player_data as core


class ProviderIdentityTests(unittest.TestCase):
    def test_javascript_python_identity_parity(self):
        cases = []
        for provider, username, key in [
            ('kamaitachi', 'Fixture', 'kamaitachi:maimaidx:fixture'),
            ('maishift', 'Fixture', 'maishift:maimaidx:intl:Fixture'),
            ('maishift', 'Fixture', 'maishift:maimaidx:jp:Fixture'),
            ('maishift', 'Fixture', 'maishift:maimaidx:intl:fixture'),
            ('maishift', 'Fixture', 'maishift:maimaidx:en:Fixture'),
            ('maishift', 'name:version', 'maishift:maimaidx:intl:name%3Aversion'),
            ('maishift', '名前', 'maishift:maimaidx:jp:%E5%90%8D%E5%89%8D'),
            ('unknown', 'fixture', 'kamaitachi:maimaidx:fixture'),
        ]:
            cases.append(dict(provider=provider, game='maimaidx', username=username,
                              displayName='Synthetic Player', key=key))
        expected = []
        for player in cases:
            try:
                core.validate(core.seal(core.empty(player)))
                expected.append(True)
            except ValueError:
                expected.append(False)
        self.assertEqual(expected, [True, True, True, False, False, True, True, False])
        node = shutil.which('node')
        if not node:
            self.skipTest('Node is needed for cross-language parity')
        source = Path('src/maimai_intelligence/assets/player-data-core.js').read_text('utf-8')
        result = subprocess.run([node, '-e', source + '\nconsole.log(JSON.stringify(' +
                                 json.dumps(cases) + '.map(maimaiPlayerData.validPlayer)));'],
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), expected)

    def test_regions_and_providers_do_not_merge(self):
        def dataset(provider, key):
            return core.seal(core.empty(dict(provider=provider, game='maimaidx',
                username='fixture', displayName='Synthetic Player', key=key)))
        intl = dataset('maishift', 'maishift:maimaidx:intl:fixture')
        jp = dataset('maishift', 'maishift:maimaidx:jp:fixture')
        tachi = dataset('kamaitachi', 'kamaitachi:maimaidx:fixture')
        for other in [jp, tachi]:
            with self.assertRaises(ValueError):
                core.merge(intl, other)
        self.assertEqual(core.decode(core.encode(intl)), intl)
