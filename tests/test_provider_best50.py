"""Provider-selected mainland Best 50 remains portable, ordered and observation-bound."""

import unittest
from copy import deepcopy

from maimai_intelligence import player_data as core


def fixture(provider="diving-fish"):
    data = core.empty(
        dict(
            provider=provider,
            game="maimaidx",
            username="Fixture",
            displayName="Fictional",
            key=provider + ":maimaidx:cn:Fixture",
        )
    )
    refs = []
    for number, rate in ((1, 0), (1, 999), (2, 200)):
        cid = provider + ":cn:" + str(number)
        data["charts"][cid] = dict(
            chartID=cid,
            songID=str(number),
            title="Fictional " + str(number),
            artist="",
            format="DX",
            difficulty="MASTER",
            level="13",
            constant=130,
            displayVersion="PRiSM PLUS",
            inGameID=number,
        )
        record = dict.fromkeys(core.RECORD_FIELDS)
        record.update(
            chartID=cid,
            achievement=1000000,
            grade="SSS",
            rate=rate,
            lamp="",
            sync="",
            constant=130,
            displayVersion="PRiSM PLUS",
        )
        ref = core.digest(record)
        data["records"][ref] = record
        refs.append(ref)
    snap = dict(
        capturedAt=1000,
        phase="after",
        complete=True,
        versions=["PRiSM PLUS"],
        pbs={provider + ":cn:1": refs[1]},
        best50=dict(provider=provider, region="cn", old=[refs[0]], new=[refs[2]]),
    )
    data["snapshots"][core.digest(snap)] = snap
    return core.seal(data), refs


class ProviderBest50Tests(unittest.TestCase):
    def test_both_providers_roundtrip_exact_observations_without_plays(self):
        for provider in ("diving-fish", "lxns"):
            with self.subTest(provider=provider):
                data, refs = fixture(provider)
                decoded = core.decode(core.encode(data))
                self.assertEqual(decoded, data)
                pbs, snap = core.current(decoded)
                self.assertEqual(pbs[provider + ":cn:1"]["rate"], 999)
                self.assertEqual(decoded["records"][snap["best50"]["old"][0]]["rate"], 0)
                self.assertEqual(snap["best50"]["new"], [refs[2]])
                self.assertIsNone(core.offer(decoded)["profile"]["rating"])
                self.assertEqual(core.offer(decoded)["pbCount"], 1)
                self.assertEqual(core.offer(decoded)["playCount"], 0)

    def test_old_v1_and_latest_absence_survive_merge(self):
        data, _ = fixture()
        later = deepcopy(data)
        snap = next(iter(later["snapshots"].values()))
        snap["capturedAt"] = 2000
        del snap["best50"]
        later["snapshots"] = {core.digest(snap): snap}
        core.seal(later)
        self.assertEqual(core.decode(core.encode(later)), later)
        merged = core.merge(data, later)
        self.assertNotIn("best50", core.current(merged)[1])
        self.assertEqual(sum("best50" in row for row in merged["snapshots"].values()), 1)
        self.assertIsNone(core.offer(merged)["profile"]["rating"])

    def test_exact_bounded_provider_scoped_membership(self):
        for kind in (
            "null",
            "extra",
            "provider",
            "region",
            "old_type",
            "old_limit",
            "new_limit",
            "duplicate_ref",
            "duplicate_chart",
            "missing_ref",
            "null_ref",
        ):
            with self.subTest(kind=kind):
                data, refs = fixture()
                snap = next(iter(data["snapshots"].values()))
                best = snap["best50"]
                if kind == "null":
                    snap["best50"] = None
                elif kind == "extra":
                    best["extra"] = True
                elif kind == "provider":
                    best["provider"] = "lxns"
                elif kind == "region":
                    best["region"] = "jp"
                elif kind == "old_type":
                    best["old"] = "not an array"
                elif kind == "old_limit":
                    best["old"] *= 36
                elif kind == "new_limit":
                    best["new"] *= 16
                elif kind == "duplicate_ref":
                    best["new"] = best["old"][:]
                elif kind == "duplicate_chart":
                    best["new"] = [refs[1]]
                elif kind == "missing_ref":
                    best["old"] = ["f" * 64]
                else:
                    best["old"] = [None]
                with self.assertRaisesRegex(ValueError, "Best 50"):
                    core.validate(data)

    def test_null_fractional_boolean_and_overflow_ratings_rejected(self):
        for rate in (None, -1, 0.5, True, 2**53):
            with self.subTest(rate=rate):
                data, refs = fixture()
                record = data["records"].pop(refs[0])
                record["rate"] = rate
                ref = core.digest(record)
                data["records"][ref] = record
                next(iter(data["snapshots"].values()))["best50"]["old"] = [ref]
                with self.assertRaises(ValueError):
                    core.validate(data)
        data, refs = fixture()
        record = data["records"].pop(refs[0])
        record["rate"] = 2**53 - 1
        ref = core.digest(record)
        data["records"][ref] = record
        next(iter(data["snapshots"].values()))["best50"]["old"] = [ref]
        with self.assertRaises(ValueError):
            core.validate(data)

    def test_provider_only_chart_metadata_uses_observation_time(self):
        data, _ = fixture()
        later = deepcopy(data)
        snap = next(iter(later["snapshots"].values()))
        snap["capturedAt"] = 2000
        later["snapshots"] = {core.digest(snap): snap}
        later["charts"]["diving-fish:cn:2"]["title"] = "A newer provider title"
        core.seal(later)
        for inputs in ((data, later), (later, data)):
            self.assertEqual(
                core.merge(*inputs)["charts"]["diving-fish:cn:2"]["title"], "A newer provider title"
            )
