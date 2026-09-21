# Catalog hotfix language review

Date: 2026-09-21. Reviewer: Codex. Method: AI contextual review against the
existing interface and LOCALIZATION_TERMINOLOGY.md; not native-speaker certification.

| English | Simplified Chinese | Korean | Japanese |
| --- | --- | --- | --- |
| Availability | 收录地区 | 수록 지역 | 収録地域 |
| All regions | 全部地区 | 모든 지역 | すべての地域 |
| JP | 日本 | 일본 | 日本 |
| International | 国际版 | 국제판 | 海外版 |

Availability describes regional song inclusion, not metadata preference or a
player's location. All regions explicitly describes an unrestricted region filter.
JP is the requested English label, localized as Japan; it maps only to the JP observation.
International uses the established regional-edition terminology. The availability
control does not change song titles, search aliases or metadata precedence.

The genre publication gate adds "This catalog contains an unrecognized genre and
needs review." Reviewed translations: 此曲目目录包含未识别的曲风分类，需要审核。
(Simplified Chinese), 이 곡 목록에 알 수 없는 장르가 포함되어 있어 검토가 필요합니다.
(Korean), この楽曲カタログには未対応のジャンルが含まれているため、確認が必要です。
(Japanese). This reports a catalog-validation failure without guessing a genre.
Build and publication errors retain the raw category and its record context for
owner review. This stricter policy supersedes the original unknown-category fallback.

Five strings flagged by the JavaScript copy audit are source aliases or a stable
genre ID, not user-facing prose. They are recorded as invariants.

## Cabinet terminology follow-up

Reviewed 2026-09-21 against the sources below. UI language selects the display
vocabulary; it never selects availability, metadata region, chart identity or
release chronology. The US/English and Korean UI retain International cabinet
genre names, including Japanese brand text. These are deliberately not general
dictionary translations into Korean.

| Fixed genre ID | US / Korean | Simplified Chinese | Japanese |
| --- | --- | --- | --- |
| POPSアニメ | POPS & ANIME | 流行&动漫 | POPS＆アニメ |
| niconicoボーカロイド | niconico & VOCALOID™ | niconico＆VOCALOID™ | niconico＆ボーカロイド |
| 東方Project | 東方Project | 东方Project | 東方Project |
| ゲームバラエティ | GAME & VARIETY | 其他游戏 | ゲーム＆バラエティ |
| maimai | maimai | 舞萌 | maimai |
| オンゲキCHUNITHM | オンゲキ & CHUNITHM | 音击/中二节奏 | オンゲキ＆CHUNITHM |

The International cabinet illustration retains オンゲキ even though the website's
song-list tab romanizes it as ONGEKI. Prefer the illustrated cabinet label.
Whitespace around ampersands is ordinary text presentation, not a new category.
Historical English aliases remain explicitly accepted. Chinese display names are
not new ingestion aliases: no CN inventory is being added, and unreviewed source
categories still block publication.

Difficulty labels in Simplified Chinese are 初级 (BASIC), 高级 (ADVANCED), 专家
(EXPERT), 大师 (MASTER), and 宗师 (Re:MASTER). JP, US and Korean labels retain
the English game names. Both existing Re:MASTER/RE:MASTER source spellings have
Chinese labels. Filters, chips, row selectors, details, comparison choices and
accessible descriptions translate the difficulty separately from literal song
titles. Difficulty values, chart IDs, color selectors and sort order stay intact.

Release names remain the selected catalog's JP/International release names,
including deliberate capitalization such as CiRCLE and MAGiCAL. China uses a
separate annual release chronology; the owner explicitly deferred that mapping.
Do not relabel a JP/INTL introduction as 舞萌DX 2025/2026 just because Chinese is
selected. Version labels, chips, cards and accessible titles are literal, including
the original maimai release, independently of the translated maimai genre.

### Evidence and limits

- [SEGA Japan song list](https://maimai.sega.jp/song/pops_anime/) establishes JP genres.
- [SEGA International song list](https://maimai.sega.com/song/) establishes the
  English/mixed-Japanese genre vocabulary; its list freshness is not used as
  evidence of current song availability.
- [SEGA International cabinet illustration](https://maimai.sega.com/assets/img/play/howto/img_3_pc.png)
  visibly shows GAME & VARIETY, maimai and オンゲキ & CHUNITHM. This is an older
  official illustration, not a claim of a fresh photograph of every cabinet build.
- [Korean distributor Uniana](https://www.uniana.com/games/?mode=detail&prd=98)
  directs Korean players to the International game;
  [SEGA's Korea cabinet listing](https://location.am-all.net/alm/location?ct=1005&gm=98&lang=en)
  explicitly identifies that edition.
- [CrazyKidCN's maintained CN catalog](https://github.com/CrazyKidCN/maimaiDX-CN-songs-database)
  documents that its source is the official Chinese WeChat maimaiNET. Its
  [displayed six-category inventory](https://maimai-net.cn/database) supplies the
  Chinese labels. This is a community-maintained capture, not an official publisher
  page or a separately photographed cabinet.
- [Chinese player's difficulty guide](https://www.bilibili.com/opus/1109436451147218984)
  documents all five Chinese difficulty names. This is first-person regional
  terminology evidence, not publisher certification.
- [SEGA's International release history](https://maimai.sega.com/) and the Chinese
  catalog show the different release naming schemes. No one-to-one annual mapping
  is inferred.

The method remains source-based AI contextual review, not native-speaker
certification or exhaustive inspection of every regional firmware revision.

The Maishift branch already defines International in player-maishift.json. When
integrating this main-based hotfix there, keep its identical translation only in
messages.json and refresh that branch's review fingerprint after the relocation.
