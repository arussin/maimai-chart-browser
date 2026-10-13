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
            ("mai-tools", "cn", "Fixture", True),
            ("mai-tools", "intl", "Fixture", True),
            ("dxrating", "jp", "Fixture", True),
            ("dxrating", "intl", "Fixture", True),
            ("tomomai", "jp", "名前:1", True),
            ("tomomai", "intl", "Fixture", True),
            ("jietng", "jp", "名前:1", True),
            ("jietng", "intl", "Fixture", True),
            ("aqua", "private", "42@one.invalid", True),
            ("aqua", "private", "42@two.invalid", True),
            ("tachi", "private", "42@one.invalid", True),
            ("aqua", "cn", "42@one.invalid", False),
            ("tachi", "intl", "42@one.invalid", False),
            ("aqua", "private", "Fixture", False),
            ("aqua", "private", "@server.invalid", False),
            ("aqua", "private", "Fixture@", False),
            ("aqua", "private", "Fixture @server.invalid", False),
            ("aqua", "private", "Fixture\u0085@server.invalid", False),
            ("aqua", "private", "Fixture\ufeff@server.invalid", False),
            ("tomomai", "private", "Fixture@server.invalid", True),
            ("tomomai", "private", "Fixture", False),
            ("tomomai", "jp", "名" * 30, False),
            ("jietng", "other", "Fixture", False),
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

    def test_tracker_file_account_regions_and_private_instances_never_merge(self):
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
            dataset("mai-tools", "intl", "Fixture"),
            dataset("dxrating", "intl", "Fixture"),
            dataset("tomomai", "jp", "Fixture"),
            dataset("tomomai", "intl", "Fixture"),
            dataset("jietng", "jp", "Fixture"),
            dataset("aqua", "private", "42@one.invalid"),
            dataset("aqua", "private", "42@two.invalid"),
            dataset("tachi", "private", "42@one.invalid"),
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

    def test_file_provider_round_trips_preserve_partial_pbs_and_observations_without_versions(self):
        for provider in ("mai-tools", "dxrating", "tomomai", "jietng", "aqua", "tachi"):
            region = "private" if provider in {"aqua", "tachi"} else "intl"
            username = "Fixture@server.invalid" if region == "private" else "Fixture"
            player = dict(
                provider=provider,
                game="maimaidx",
                username=username,
                displayName="Synthetic Player",
                key=provider + ":maimaidx:" + region + ":" + quote(username, safe="~()*!.'-_"),
            )
            data = core.empty(player)
            chart_id = provider + ":" + region + ":synthetic-chart"
            data["charts"][chart_id] = dict(
                chartID=chart_id,
                songID="source-song",
                title="Fictional Song",
                artist="Synthetic Artist",
                format="DX",
                difficulty="MASTER",
                level="13+",
                constant=None,
                displayVersion="",
                inGameID=None,
            )
            record = dict.fromkeys(core.RECORD_FIELDS)
            record.update(
                chartID=chart_id,
                achievement=1001234,
                grade="SSS",
                lamp="FULL COMBO",
                sync="",
                displayVersion="",
            )
            record_id = core.digest(record)
            data["records"][record_id] = record
            snapshot = dict(
                capturedAt=1000,
                phase="after",
                complete=False,
                versions=[],
                pbs={} if provider == "tachi" else {chart_id: record_id},
            )
            snapshot_id = core.digest(snapshot)
            data["snapshots"][snapshot_id] = snapshot
            if provider == "aqua":
                data["plays"][provider + ":private:native-event"] = record_id
            capture = dict(
                capturedAt=1000,
                sourceKind=provider + "-file",
                sourceID="synthetic-source",
                sessionID="",
                historyCoverage="retained-only" if data["plays"] else "none",
                playIDs=list(data["plays"]),
                snapshotIDs=[snapshot_id],
            )
            data["captures"][core.digest(capture)] = capture
            with self.subTest(provider=provider):
                sealed = core.seal(data)
                self.assertEqual(core.decode(core.encode(sealed)), sealed)
                self.assertEqual(core.reconcile(sealed), sealed)
                self.assertEqual(core.merge(sealed, sealed), sealed)
                offer = core.offer(sealed)
                self.assertEqual(offer["pbCount"], 0 if provider == "tachi" else 1)
                self.assertEqual(offer["playCount"], 1 if provider == "aqua" else 0)
                self.assertEqual(offer["pbCoverage"], "partial")
                self.assertIsNone(offer["profile"]["rating"])
                self.assertEqual(offer["profile"]["sessionCount"], 0)
                self.assertEqual(len(sealed["records"]), 1)
                wrong_chart = "other:" + region + ":synthetic-chart"
                sealed["charts"][wrong_chart] = sealed["charts"].pop(chart_id)
                sealed["charts"][wrong_chart]["chartID"] = wrong_chart
                with self.assertRaisesRegex(ValueError, "file-provider chart"):
                    core.seal(sealed)
