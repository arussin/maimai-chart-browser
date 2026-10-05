# Regional terminology decisions

Reviewed September 20, 2026. These are maintained localization decisions for
maimai.party. Official publishers establish game labels; players' own guides,
tools and forum posts establish observed community usage. Community usage is
not a claim that SEGA officially translates a song title that way.

| Concept | Simplified Chinese | Korean | Japanese | Evidence / decision |
| --- | --- | --- | --- | --- |
| Chart | 谱面 | 채보 | 譜面 | Chinese score tools [1–2], Korean player guide [3], Japanese player diary [5]. Korean 보면 also occurs; use 채보 consistently in our prose. |
| Chart constant | 谱面定数 / 定数 | 채보 상수 / 상수 | 譜面定数 / 定数 | [1–3, 6]. Korean 정수 means integer and is incorrect here. |
| Alternating hits / trill | 交互 | 트릴 | トリル | Players' own explanations and accounts [3–5]. |
| Repeated hits at one position | 纵连 / 同键连打 | 같은 버튼 연타 | 縦連 / 同ボタン連打 | [3–5]. The explanation after the slash makes the shorthand accessible. |
| Button sweep / staircase | 扫键 / 楼梯 | 버튼 쓸기 / 계단 | ボタンなぞり / 階段 | [3–4]. Keep the site's distinction between a pattern and a suggested hand technique. |
| Anchored trill | 轴交互 | 축 트릴 | 軸トリル | Chinese creator terminology [4]; other labels describe the fixed anchor without inventing a game mechanic. |
| Simultaneous group | 同时押 | 동시 입력 | 同時押し | Do not blindly substitute 双押: our groups may contain more than two notes. |
| TAP, HOLD, SLIDE, TOUCH, BREAK, EACH | Keep identifiers | Keep identifiers | Keep identifiers | Official note guide [7]. Prose can explain the action locally; exported identifiers and badges stay recognizable. |
| Difficulties BASIC / ADVANCED / EXPERT / MASTER / Re:MASTER | 初级 / 高级 / 专家 / 大师 / 宗师 | Keep English game names | Keep English game names | Cabinet terminology follow-up in [catalog hotfix review](localization-review/catalog-hotfix-20260921.md); presentation only, identifiers and colors remain untouched. |
| DX, STD, ranks | Keep source labels | Keep source labels | Keep source labels | Official international/Korean presentation [7–8]; registry identities remain untouched. |
| Release names, e.g. MAGiCAL, CiRCLE | Keep source names | Keep source names | Keep source names | [8–9]. UI language does not select a game region or substitute mainland-China release years. |
| Site financial support | 赞助 / 赞助付款 | 후원 / 결제 | 支援 / 支援金のお支払い | Editorial choice, not a maimai game term. Distinguish an expired checkout page from a failed or expired payment. |

## Sources

1. [Diving-Fish's own Chinese score interface](https://maimai.diving-fish.com/)
   and [API vocabulary](https://maimai.diving-fish.com/manual/docs/developer/zh-api-document/).
2. [LXNS's Chinese maimai tool documentation](https://maimai.lxns.net/docs/api/maimai).
3. Korean players' first-person guides on DCInside:
   [13.0 practice charts](https://gall.dcinside.com/mgallery/board/view/?id=maimai1&no=246913)
   and [12.6–12.7 recommendations](https://gall.dcinside.com/mgallery/board/view/?id=maimai1&no=195150).
4. Chinese creators' own material:
   [maimai terminology](https://www.bilibili.com/read/cv6529/),
   [pattern terminology episode 1](https://www.bilibili.com/video/BV1Lb421p7b5/),
   [beginner's guide](https://www.bilibili.com/opus/461149354380109054).
5. Japanese players' own accounts:
   [daily maimai, days 12–13](https://note.com/omal_9174/n/ne41cda097b6a)
   and [chart practice and repeated hits](https://note.com/yabunousagi/n/n4df71b257e8e).
6. [Korean community tool's difficulty explanation](https://maimai.shiftpsh.com/plate-difficulty)
   and [Japanese difficulty discussion](https://z.wikiwiki.jp/au78mqfub1uc3ska/topic/1/79).
7. [SEGA international note guide](https://maimai.sega.com/play/howto/).
8. [Uniana's Korean maimai page](https://www.uniana.com/games/?mode=detail&prd=98).
9. [SEGA Japan](https://maimai.sega.jp/) and [SEGA international](https://maimai.sega.com/).

## Song aliases and uncertainty

Song titles shown in the UI remain the accepted registry titles. Search can also
use a regional nickname: for example, 阿妈鳖 for AMABIE appears in a
[Chinese player's playlist](https://www.bilibili.com/video/BV1i94y1p7DJ/), and
내첫폰 for My First Phone appears in the Korean recommendations above. These
small factual aliases have per-song source URLs in `song-pronunciations.json`.
No community database or article was copied wholesale.

An AI-authored literal gloss or phonetic spelling is a discovery aid, not an
assertion of widespread local usage. Do not label it official or community
verified without evidence. The builder records AI-reviewed overrides separately
from generated approximations, and keeps the latter in its review queue.

For a new game term, read its UI/lesson context, check official regional material
and at least one relevant local community source, then update this table and the
canonical locale catalog. When usage differs, prefer a clear description and
retain the original game identifier where needed. Preserve English keys exactly.

## Interface context and small screens

Translate controls in context, rather than repeating every noun in the English
source. Under an existing Version, Difficulty or Genre label, the unfiltered
selection can be すべて / 全部 / 전체. The version, difficulty and pattern
summaries reference both their label and selected value for screen readers.
Keep full descriptions in messages that appear without this surrounding context.
The Japanese About tab uses サイト紹介; the page title remains descriptive.

Verify `html.lang` and the selected locale before identifying a screenshot:
`ja` is Japanese and `zh-Hans` is Simplified Chinese. Shared Han characters do
not identify the language on their own. Check each locale separately at 320,
360, 375, 390 and 414px; navigation should fit on one line without clipping or
shrinking the text. Localized navigation uses narrower gaps; English stays as-is.

## Indonesian (id) source review — 2026-10-04

Display the language as **Bahasa Indonesia**. This is an AI-authored/source-reviewed
localization, not native-speaker certification or an assertion of official
Indonesian community terminology. The release remains subject to build and
real-browser validation recorded in `localization-review/indonesian-20261004.md`.

Use **chart** for a playable chart and **grafik** for a plotted graph. Use
**konstanta chart**, **rating**, **grade**, **pencapaian** and **riwayat** consistently.
Retain tap, hold, slide, touch, break, PB, RT, STD, DX and game difficulty/rank
labels where they name game concepts. Explain onset as the arrival/start of a
new input; distinguish temporal gaps from spatial button distance. Preserve
experimental/partial/unknown qualifications rather than implying complete coverage.

Concise filter defaults use **Semua**; their accessible names keep the filter
context. Longer Indonesian navigation may wrap rather than clip on narrow
screens. Preserve placeholders, code, identifiers, thresholds and parser examples
such as `13.5` unchanged. Translate saved dates differently from played dates.
Language selection never changes the Japan/International data preference. No
Indonesian song-alias corpus or provider-URL language support is inferred from
adding this UI locale. Existing title/artist/romaji aliases remain searchable.
