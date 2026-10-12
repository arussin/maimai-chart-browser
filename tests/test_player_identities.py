"""Provider identity is portable; no test infers an upstream Maishift schema."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path
from urllib.parse import quote

from maimai_intelligence import player_data as core


class ProviderIdentityTests(unittest.TestCase):
    def test_javascript_python_identity_parity(self):
        cases = []
        answers = [True, True, True, False, False, True, True, False]
        for provider, username, key in [
            ("kamaitachi", "Fixture", "kamaitachi:maimaidx:fixture"),
            ("maishift", "Fixture", "maishift:maimaidx:intl:Fixture"),
            ("maishift", "Fixture", "maishift:maimaidx:jp:Fixture"),
            ("maishift", "Fixture", "maishift:maimaidx:intl:fixture"),
            ("maishift", "Fixture", "maishift:maimaidx:en:Fixture"),
            ("maishift", "name:version", "maishift:maimaidx:intl:name%3Aversion"),
            ("maishift", "名前", "maishift:maimaidx:jp:%E5%90%8D%E5%89%8D"),
            ("unknown", "fixture", "kamaitachi:maimaidx:fixture"),
        ]:
            cases.append(
                dict(
                    provider=provider,
                    game="maimaidx",
                    username=username,
                    displayName="Synthetic Player",
                    key=key,
                )
            )
        for provider, region, username, valid in [
            ("diving-fish", "cn", "Fixture", True),
            ("diving-fish", "cn", "名字:1", True),
            ("diving-fish", "jp", "Fixture", False),
            ("diving-fish", "intl", "Fixture", False),
            ("diving-fish", "private", "Fixture@server.invalid", False),
            ("diving-fish", "other", "Fixture", False),
            ("diving-fish", "cn", "名" * 30, False),
            ("lxns", "cn", "Fixture", True),
            ("lxns", "cn", "名字:1", True),
            ("lxns", "jp", "Fixture", False),
            ("lxns", "intl", "Fixture", False),
            ("lxns", "private", "Fixture", False),
            ("mai-tools", "cn", "Fixture", False),
            ("dxrating", "cn", "Fixture", False),
            ("tomomai", "jp", "Fixture", False),
            ("jietng", "jp", "Fixture", False),
            ("aqua", "private", "42@one.invalid", False),
            ("tachi", "private", "42@one.invalid", False),
        ]:
            identity = quote(username, safe="~()*!.'-_")
            cases.append(
                dict(
                    provider=provider,
                    game="maimaidx",
                    username=username,
                    displayName="Synthetic Player",
                    key=provider + ":maimaidx:" + region + ":" + identity,
                )
            )
            answers.append(valid)
        expected = []
        for player in cases:
            try:
                core.validate(core.seal(core.empty(player)))
                expected.append(True)
            except ValueError:
                expected.append(False)
        self.assertEqual(expected, answers)
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is needed for cross-language parity")
        source = Path("src/maimai_intelligence/assets/player-data-core.js").read_text("utf-8")
        result = subprocess.run(  # noqa: S603 - fixed local validator and synthetic test records
            [
                node,
                "-e",
                source
                + "\nconsole.log(JSON.stringify("
                + json.dumps(cases)
                + ".map(maimaiPlayerData.validPlayer)));",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), expected)

    def test_regions_and_providers_do_not_merge(self):
        def dataset(provider, key):
            return core.seal(
                core.empty(
                    dict(
                        provider=provider,
                        game="maimaidx",
                        username="fixture",
                        displayName="Synthetic Player",
                        key=key,
                    )
                )
            )

        intl = dataset("maishift", "maishift:maimaidx:intl:fixture")
        jp = dataset("maishift", "maishift:maimaidx:jp:fixture")
        tachi = dataset("kamaitachi", "kamaitachi:maimaidx:fixture")
        fish = dataset("diving-fish", "diving-fish:maimaidx:cn:fixture")
        lxns = dataset("lxns", "lxns:maimaidx:cn:fixture")
        for other in [jp, tachi, fish, lxns]:
            with self.assertRaises(ValueError):
                core.merge(intl, other)
        self.assertEqual(core.decode(core.encode(intl)), intl)

    def test_tracker_account_identities_never_merge(self):
        def dataset(provider, region, username):
            identity = quote(username, safe="~()*!.'-_")
            return core.empty(
                dict(
                    provider=provider,
                    game="maimaidx",
                    username=username,
                    displayName="Synthetic Player",
                    key=provider + ":maimaidx:" + region + ":" + identity,
                )
            )

        datasets = [
            dataset("diving-fish", "cn", "Fixture"),
            dataset("diving-fish", "cn", "fixture"),
            dataset("diving-fish", "cn", "Other"),
            dataset("lxns", "cn", "Fixture"),
            dataset("lxns", "cn", "fixture"),
        ]
        for index, left in enumerate(datasets):
            self.assertEqual(core.decode(core.encode(left)), left)
            for right in datasets[index + 1 :]:
                with self.assertRaises(ValueError):
                    core.merge(left, right)
        self.assertEqual(core.merge(datasets[0], datasets[0]), datasets[0])

    def test_file_chart_namespaces_reject_cross_provider_and_unsafe_references(self):
        player = dict(
            provider="diving-fish",
            game="maimaidx",
            username="Fixture",
            displayName="Synthetic Player",
            key="diving-fish:maimaidx:cn:Fixture",
        )
        for chart_id, accepted in [
            ("diving-fish:cn:101:DX:RE:MASTER", True),
            ("diving-fish:cn:" + quote("名前/song", safe=""), True),
            ("lxns:cn:101", False),
            ("diving-fish:jp:101", False),
            ("diving-fish:cn:", False),
            ("diving-fish:cn:101::MASTER", False),
            ("diving-fish:cn:../101", False),
            ("diving-fish:cn:__proto__", False),
            ("diving-fish:cn:%63onstructor", False),
            ("diving-fish:cn:%00", False),
            ("diving-fish:cn:%zz", False),
            ("diving-fish:cn:%ff", False),
            ("diving-fish:cn:" + "1" * 256, False),
        ]:
            data = core.empty(player)
            data["charts"][chart_id] = dict(
                chartID=chart_id,
                songID="101",
                title="Exact Title",
                artist="Exact Artist",
                format="DX",
                difficulty="MASTER",
                level="13+",
                constant=137,
                displayVersion="",
                inGameID=101,
            )
            with self.subTest(chart_id=chart_id):
                if accepted:
                    core.seal(data)
                else:
                    with self.assertRaises(ValueError):
                        core.seal(data)
