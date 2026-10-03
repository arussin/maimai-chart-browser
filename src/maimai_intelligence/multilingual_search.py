"""Deterministic search-only spellings, with per-song provenance and gap reports.

These are discovery aids, not regional display titles or identity evidence.
SEGA title_kana is often a sorting key with voicing removed. Its derived forms
are explicitly approximate; an authored pronunciation overrides it completely.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from copy import deepcopy
from functools import lru_cache
from importlib.resources import files
from typing import Any

from .provider_mapping import normalized
from .registry import resolve
from .snapshots import canonical

GENERATOR = "multilingual-search-2"
DEPENDENCIES = {"pypinyin": "0.55.0", "opencc-python-reimplemented": "0.1.7"}

# Authored syllable approximations, not an official Korean/Chinese naming rule.
# Longest match first; dakuten and small kana are retained before conversion.
_ROWS = """
ア a 아 阿
イ i 이 伊
ウ u 우 乌
エ e 에 埃
オ o 오 欧
カ ka 카 卡
キ ki 키 基
ク ku 쿠 库
ケ ke 케 克
コ ko 코 科
ガ ga 가 加
ギ gi 기 吉
グ gu 구 古
ゲ ge 게 盖
ゴ go 고 戈
サ sa 사 萨
シ shi 시 西
ス su 스 苏
セ se 세 塞
ソ so 소 索
ザ za 자 扎
ジ ji 지 吉
ズ zu 즈 兹
ゼ ze 제 泽
ゾ zo 조 佐
タ ta 타 塔
チ chi 치 奇
ツ tsu 츠 茨
テ te 테 特
ト to 토 托
ダ da 다 达
ヂ ji 지 吉
ヅ zu 즈 兹
デ de 데 德
ド do 도 多
ナ na 나 纳
ニ ni 니 尼
ヌ nu 누 努
ネ ne 네 内
ノ no 노 诺
ハ ha 하 哈
ヒ hi 히 希
フ fu 후 夫
ヘ he 헤 赫
ホ ho 호 霍
バ ba 바 巴
ビ bi 비 比
ブ bu 부 布
ベ be 베 贝
ボ bo 보 博
パ pa 파 帕
ピ pi 피 皮
プ pu 푸 普
ペ pe 페 佩
ポ po 포 波
マ ma 마 马
ミ mi 미 米
ム mu 무 穆
メ me 메 梅
モ mo 모 莫
ヤ ya 야 亚
ユ yu 유 尤
ヨ yo 요 约
ラ ra 라 拉
リ ri 리 利
ル ru 루 鲁
レ re 레 雷
ロ ro 로 罗
ワ wa 와 瓦
ヲ o 오 欧
ヰ i 이 伊
ヱ e 에 埃
ヴ vu 부 夫
キャ kya 캬 恰
キュ kyu 큐 丘
キョ kyo 쿄 乔
ギャ gya 갸 加
ギュ gyu 규 纠
ギョ gyo 교 乔
シャ sha 샤 夏
シュ shu 슈 修
ショ sho 쇼 肖
ジャ ja 자 加
ジュ ju 주 朱
ジョ jo 조 乔
チャ cha 차 恰
チュ chu 추 丘
チョ cho 초 乔
ニャ nya 냐 尼亚
ニュ nyu 뉴 纽
ニョ nyo 뇨 尼奥
ヒャ hya 햐 希亚
ヒュ hyu 휴 休
ヒョ hyo 효 希奥
ビャ bya 뱌 比亚
ビュ byu 뷰 比尤
ビョ byo 뵤 比奥
ピャ pya 퍄 皮亚
ピュ pyu 퓨 皮尤
ピョ pyo 표 皮奥
ミャ mya 먀 米亚
ミュ myu 뮤 缪
ミョ myo 묘 米奥
リャ rya 랴 利亚
リュ ryu 류 流
リョ ryo 료 利奥
ファ fa 파 法
フィ fi 피 菲
フェ fe 페 费
フォ fo 포 佛
ティ ti 티 蒂
ディ di 디 迪
トゥ tu 투 图
ドゥ du 두 杜
ウィ wi 위 维
ウェ we 웨 韦
ウォ wo 워 沃
ヴァ va 바 瓦
ヴィ vi 비 维
ヴェ ve 베 维
ヴォ vo 보 沃
シェ she 셰 谢
ジェ je 제 杰
チェ che 체 切
イェ ye 예 耶
"""
MORA = {row[0]: tuple(row[1:]) for line in _ROWS.strip().splitlines() if (row := line.split())}
SMALL = str.maketrans("ァィゥェォャュョヮ", "アイウエオヤユヨワ")


def kana(value):
    return "".join(
        chr(ord(c) + 96) if "ぁ" <= c <= "ゖ" else c for c in unicodedata.normalize("NFKC", value)
    )


def _coda(text, final):
    if text and "가" <= text[-1] <= "힣" and (ord(text[-1]) - 0xAC00) % 28 == 0:
        return text[:-1] + chr(ord(text[-1]) + final)
    return text


def kana_spellings(value):
    """Return romaji, Hangul, Chinese phonetics, and unconverted letters."""
    # Interpuncts separate stylized syllables, not their pronunciation. In
    # ふ・れ・ん・ど, the nasal still closes れ rather than becoming detached.
    value = kana(value).replace("・", "")
    roman = hangul = chinese = ""
    unresolved = []
    i = 0
    while i < len(value):
        c = value[i]
        if c == "ー":
            if roman and roman[-1] in "aeiou":
                roman += roman[-1]
            i += 1
            continue
        if c == "ン":
            roman += "n"
            closed = _coda(hangul, 4)
            hangul = closed if closed != hangul else hangul + "응"
            chinese += "恩"
            i += 1
            continue
        if c == "ッ":
            following = MORA.get(value[i + 1 : i + 3]) or MORA.get(value[i + 1 : i + 2])
            if following and following[0][0] not in "aeiou":
                roman += following[0][0]
            hangul = _coda(hangul, 19)
            i += 1
            continue
        token = value[i : i + 2] if value[i : i + 2] in MORA else c.translate(SMALL)
        if token in MORA:
            r, h, z = MORA[token]
            roman += r
            hangul += h
            chinese += z
            i += len(token)
        else:
            roman += c
            hangul += c
            chinese += c
            if c.isalpha():
                unresolved.append(c)
            i += 1
    return roman, hangul, chinese, "".join(unresolved)


@lru_cache(maxsize=1)
def _tools():
    try:
        from opencc import OpenCC
        from pypinyin import lazy_pinyin
    except ImportError as error:
        raise RuntimeError(
            "Install requirements-localization.txt in the data-builder environment"
        ) from error
    assets = files("maimai_intelligence.assets")
    raw = gzip.decompress(assets.joinpath("cmudict.dict.gz").read_bytes())
    provenance = json.loads(assets.joinpath("cmudict-source.json").read_text("utf-8"))
    if hashlib.sha256(raw).hexdigest() != provenance["sha256"]:
        raise ValueError("Bundled pronunciation dictionary integrity mismatch")
    # Parse BSD-licensed dictionary data directly; no CMUdict wrapper code.
    lexicon = defaultdict(list)
    for line in raw.decode("utf-8").splitlines():
        fields = line.split("#", 1)[0].split()
        if len(fields) > 1 and not fields[0].startswith(";;;"):
            lexicon[re.sub(r"\(\d+\)$", "", fields[0].lower())].append(fields[1:])
    return OpenCC("t2s"), lazy_pinyin, lexicon


_CONSONANTS = {
    "B": 7,
    "CH": 14,
    "D": 3,
    "DH": 3,
    "F": 17,
    "G": 0,
    "HH": 18,
    "JH": 12,
    "K": 15,
    "L": 5,
    "M": 6,
    "N": 2,
    "P": 17,
    "R": 5,
    "S": 9,
    "SH": 9,
    "T": 16,
    "TH": 9,
    "V": 7,
    "Z": 12,
    "ZH": 12,
}
_VOWELS = {
    "AA": "아",
    "AE": "애",
    "AH": "어",
    "AO": "오",
    "AW": "아우",
    "AY": "아이",
    "EH": "에",
    "ER": "어",
    "EY": "에이",
    "IH": "이",
    "IY": "이",
    "OW": "오우",
    "OY": "오이",
    "UH": "우",
    "UW": "우",
}


def _english_hangul(word, lexicon):
    pronunciation = lexicon.get(word.lower())
    if not pronunciation:
        return None
    sounds = [re.sub(r"\d", "", sound) for sound in pronunciation[0]]
    output = ""
    i = 0
    while i < len(sounds):
        sound = sounds[i]
        if sound in _VOWELS:
            output += _VOWELS[sound]
        elif sound in {"Y", "W"} and i + 1 < len(sounds) and sounds[i + 1] in _VOWELS:
            following = _VOWELS[sounds[i + 1]]
            output += (
                {"아": "야", "어": "여", "오": "요", "우": "유", "에": "예"}
                if sound == "Y"
                else {"아": "와", "어": "워", "에": "웨", "이": "위"}
            ).get(following, following)
            i += 1
        elif sound in _CONSONANTS and i + 1 < len(sounds) and sounds[i + 1] in _VOWELS:
            vowel = _VOWELS[sounds[i + 1]]
            output += (
                chr(0xAC00 + _CONSONANTS[sound] * 588 + (ord(vowel[0]) - 0xAC00) % 588) + vowel[1:]
            )
            i += 1
        elif sound in {"N", "M", "NG", "L"} and output:
            output = _coda(output, {"N": 4, "M": 16, "NG": 21, "L": 8}[sound])
        elif sound in _CONSONANTS:
            output += chr(0xAC00 + _CONSONANTS[sound] * 588 + 18 * 28)
        i += 1
    return output


def default_overrides():
    return json.loads(
        files("maimai_intelligence.assets").joinpath("song-pronunciations.json").read_text("utf-8")
    )


def compile_aliases(
    registry: dict[str, Any], *, overrides: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Never reconcile identity here. Unknown override IDs/identities are errors."""
    bundled = overrides is None
    overrides = default_overrides() if bundled else overrides
    converter, pinyin, english = _tools()
    inputs_hash = hashlib.sha256(canonical(overrides)).hexdigest()
    latest = defaultdict(dict)
    for observation in sorted(
        registry["observations"].values(), key=lambda o: (o["observed_at"], o["observation_id"])
    ):
        if observation["field"] == "metadata":
            latest[resolve(registry, observation["subject_id"])][observation["region"]] = (
                observation
            )
    for sid, override in overrides["songs"].items():
        song = registry["songs"].get(sid)
        if bundled and not song:
            # Small offline/legacy catalogs can use a subset of the bundled IDs.
            # CI separately checks the complete accepted registry for orphan IDs.
            continue
        if (
            not song
            or song.get("redirect")
            or any(
                normalized(song["metadata"].get(k)) != normalized(override[k])
                for k in ("title", "artist")
            )
        ):
            raise ValueError(f"Pronunciation override identity needs review: {sid}")
    records, gaps, counts, review_counts = {}, [], Counter(), Counter()
    for sid, song in sorted(registry["songs"].items()):
        if song.get("redirect"):
            continue
        title = song["metadata"].get("title", "")
        override = overrides["songs"].get(sid, {})
        observation = latest[sid].get("JP") or latest[sid].get("INTL")
        sort_key = (observation or {}).get("value", {}).get("title_kana")
        # A kana title preserves dakuten, small kana and long-vowel marks that
        # SEGA's sorting key deliberately removes. Never degrade it to that key.
        kana_title = bool(re.search(r"[ぁ-ヿ]", title)) and not re.search(r"[\u3400-\u9fff]", title)
        reading = override.get("reading") or (
            title
            if kana_title
            else sort_key
            if sort_key and re.search(r"[ぁ-ヿ]", sort_key)
            else title
        )
        basis = (
            "authored-pronunciation"
            if override.get("reading")
            else "kana-title"
            if kana_title
            else "approximate-sort-key"
            if reading == sort_key
            else "approximate-title"
        )
        source = (
            f"song-pronunciations:{inputs_hash}"
            if override.get("reading")
            else (observation or {}).get("snapshot_id", "accepted-song-metadata")
        )
        generated = []

        def add(value, locale, kind, provenance=source, generated=generated):
            value = unicodedata.normalize("NFKC", value).strip()
            if value and not any(r["value"] == value and r["locale"] == locale for r in generated):
                generated.append(
                    {"value": value, "locale": locale, "kind": kind, "source": provenance}
                )

        roman, hangul, chinese, unresolved = kana_spellings(reading)
        add(reading, "ja", basis)
        add(roman, "en", basis)
        # CMU pronunciations help Latin titles. Unknown/stylized words remain a
        # visible coverage gap rather than being advertised as Hangul coverage.
        unknown_words = []

        def english_word(match, unknown_words=unknown_words):
            word = match[0]
            result = _english_hangul(word, english)
            if result is None:
                unknown_words.append(word)
            return result or word

        hangul = re.sub(r"[A-Za-z]+(?:'[A-Za-z]+)?", english_word, hangul)
        authored = override.get("aliases", {})
        # A corrected locale must not remain polluted by its rejected generated
        # spelling. A complete authored kana reading may also supply phonetics.
        if (not authored.get("ko") or override.get("reading")) and not re.search(
            r"[A-Za-zぁ-ゖァ-ヺ\u3400-\u9fff]", hangul
        ):
            add(hangul, "ko", "generated-phonetic")
        # Normalize before checking scripts: compatibility characters such as
        # circled katakana (㋰ -> ム) otherwise bypass the kana exclusion below.
        simplified = converter.convert(unicodedata.normalize("NFKC", title))
        if not authored.get("zh-Hans"):
            # Script conversion is useful for Han titles, not Japanese sentences
            # with kana left inside them. Pinyin must only use Chinese aliases.
            if re.search(r"[\u3400-\u9fff]", simplified) and not re.search(
                r"[ぁ-ゖァ-ヺ]", simplified
            ):
                add(simplified, "zh-Hans", "generated-script-conversion")
            if re.search(r"[\u3400-\u9fff]", chinese) and not re.search(
                r"[A-Za-zぁ-ゖァ-ヺ]", chinese
            ):
                add(chinese, "zh-Hans", "generated-phonetic")
        for locale, values in authored.items():
            if locale not in {"en", "ja", "zh-Hans", "ko"}:
                raise ValueError(f"Unsupported alias locale: {locale}")
            for value in values:
                add(value, locale, "authored-search-alias", f"song-pronunciations:{inputs_hash}")
        for record in list(generated):
            if record["locale"] == "zh-Hans":
                add(
                    " ".join(pinyin(record["value"])),
                    "zh-Latn",
                    "generated-pinyin",
                    record["source"],
                )
        missing = []
        if not any(r["locale"] == "ko" and re.search(r"[가-힣]", r["value"]) for r in generated):
            missing.append("ko")
        if not any(r["locale"] == "zh-Hans" for r in generated):
            missing.append("zh-Hans")
        pronunciation_gap = (
            unknown_words or re.search(r"[\u3400-\u9fff]", unresolved)
        ) and not override.get("aliases", {}).get("ko")
        review_status = override.get("review_status", "generated-approximation")
        review_counts[review_status] += 1
        if (
            missing
            or pronunciation_gap
            or review_status in {"machine-assisted-draft", "generated-approximation"}
        ):
            gaps.append(
                {
                    "song_id": sid,
                    "title": title,
                    "missing": missing,
                    "unresolved": sorted(set(unknown_words)) if pronunciation_gap else [],
                    "reading_basis": basis,
                    "review_status": review_status,
                }
            )
        for locale in {r["locale"] for r in generated if r["locale"] not in missing}:
            counts[locale] += 1
        records[sid] = {
            "title": title,
            "artist": song["metadata"].get("artist", ""),
            "reading_basis": basis,
            "review_status": review_status,
            "aliases": generated,
        }
    return {
        "schema_version": GENERATOR,
        "dependencies": DEPENDENCIES,
        "dictionary": json.loads(
            files("maimai_intelligence.assets").joinpath("cmudict-source.json").read_text("utf-8")
        ),
        "overrides_sha256": inputs_hash,
        "songs": records,
        "coverage": {
            "songs": len(records),
            "by_locale": dict(sorted(counts.items())),
            "by_review_status": dict(sorted(review_counts.items())),
            "missing_aliases": sum(bool(g["missing"]) for g in gaps),
            "review_queue": gaps,
            "unused_override_ids": sorted(set(overrides["songs"]) - set(registry["songs"])),
        },
    }


def enrich_registry(registry, *, overrides=None) -> tuple[dict[str, Any], dict[str, Any]]:
    artifact = compile_aliases(registry, overrides=overrides)
    result = deepcopy(registry)
    for sid, record in artifact["songs"].items():
        result["songs"][sid]["search_aliases"] = record["aliases"]
    return result, artifact
