# English community patterns, recognition 0.3.0

This extension adds 20 entries to the original 36: 42 patterns and 14 chart
traits in total. Display names, aliases and newly authored lessons are English.
The existing 36 stable pattern IDs remain intact. Romanized song-derived names
retain their community identity, with English alternative names where useful.

The taxonomy reference is [mai-notes' tag dictionary](https://mai-notes.com/tag),
read September 12, 2026. Its tag help includes definitions and example measures.
Shape parsing follows the [Simai slide notation reference](https://w.atwiki.jp/simai/pages/1003.html).
The English descriptions and teaching examples here are newly authored.

## Added community motifs

| English name | Search aliases | Recognized form |
|---|---|---|
| CYCLES pattern | Cycles; Cycle pattern | Three or more EACH pairs at fixed opposite heads, alternating arc pairs and p/q-loop pairs. |
| Slip Flip pattern | Slipflip | Three or more mixed arc/loop EACH pairs with the roles retained at fixed opposite heads. |
| Death Scythe pattern | Deathscythe; counter-rotating tap and slide pattern | An adjacent button run of at least eight inputs with at least two oppositely directed arc heads, each overlapping another input. |
| Sugarbitter pattern | Sugar Song and Bitter Step pattern; Shugabita pattern | Three or more same-button heads, each sharing two distinct straight branches launched together. |
| Future Re:MASTER pattern | Future pattern; Future white pattern | Three or more one-beat star/tap EACH groups: later taps revisit the previous head, and that slide launches at the next pair. |
| Gekishou pattern | The Intense Voice of Hatsune Miku pattern; EACH-linked opposing sweeps | At least two short, disjoint, opposing neighbor sweeps sharing authored EACH endpoints. |
| Hoshizora Spectacle pattern | Hoshizora pattern | The six-input relative-position form 1,3,5,1,7,5, including rotations/reflections and hold onsets. |
| Outlaw pattern | Outlaw's Lullaby pattern; shifting EACH-linked sweeps | Short neighbor sweeps sharing EACH endpoints, with the same direction/length and a one-button shift in successive starts. |
| AMAZING MIGHTYYYY!!!! EXPERT pattern | Amazing Mightyyy Expert pattern; Amemai Expert pattern; dotted-eighth stream | At least five onset groups separated by three quarters of a beat. |
| Magic-circle pattern | Magic circle; rotating diagonal slides | At least four straight diameter slides with successive heads moving one neighboring button around the ring. |

CYCLES and Slip Flip remain separate IDs and mutually contrasting teaching
examples. These are explicitly scoped structural forms. The same community
name may cover additional variants. No detector reads a song title or infers
a compulsory hand assignment.

## Added structural patterns

| English name | Search aliases | Recognition boundary |
|---|---|---|
| Anchored trill | Axis trill; moving trill with a fixed anchor | Eight or more regularly alternating inputs; one fixed anchor and at least three moving positions. |
| Scattered tap stream | Random stream; scattered stream | Eight or more equally spaced single inputs across four buttons, with at least three distinct non-neighbor jumps; excludes fixed-anchor alternation. |
| Touch stream | Scattered touch notes | Six or more consecutive single touches spanning at least three zones. |
| Touch sweep | Touch staircase | Four to seven neighboring single touches on one numbered ring. |
| Touch rotation | Touch spin; touch perimeter run | Eight or more neighboring single touches around one numbered ring. |
| Repeated same-start slides | Repeated slide heads; same-start slide stream | Three distinct, equally spaced heads at one button, each with one path. |
| Alternating slide launches | Alternating slide stream | Four equally spaced, single-path heads alternating between two fixed buttons. |
| Different-speed paired slides | Unequal slide speeds; mixed-speed slides | A simultaneous pair with equal-length simple shapes and duration ratio at least 1.25; launches coincide. |
| Extended slide wait | Delayed slide; slide stop; long slide wait | More than one authored beat of waiting, allowing two microseconds of rounding. |
| Back-and-forth slides | Return slides; opposing slides | Consecutive simple straight or arc slides retracing the same path with overlapping lifetimes. |

Touch sweeps/rotations use the A, B, D and E rings; central and cross-ring notes
split those runs. General touch streams may cross rings. Simultaneous touches
and touch holds split these three forms. Exact timing ceilings, run splitting,
and required capabilities are retained in each registry definition.

## Existing entries gain aliases

| Existing entry | Added or retained English vocabulary |
|---|---|
| Two-position alternation | Trill; trills; two-button alternation |
| Same-position repetition | Jack; jacks; repeated taps |
| Simultaneous group / chord stream | EACH; chord; chords / EACH stream; repeated chords |
| Tap staircase | Button sweep; sweep; sweeps; staircase |
| Perimeter run | Rotation; rotations; spin; spins; button rotation |
| Direction reversal | Reversal; reversals; foldback; reverse sweep |
| Same-head slide fan | Branching slides; shared-head slides; slide fan |
| Connected slide chain | Connected slides; chained slide; slide chain |
| Umiyuri | Umiyuri; Umiyuri Kaiteitan pattern |
| Gallop pairs | Gallops; short-long pairs |
| Mixed-input patterns | Literal aliases such as hold and tap, hold and slide, touch and button, tap during slide wait |

An extended wait is separate from changing wait durations. Repeated heads are
separate from one shared branching head. Swing is not an alias for gallops.
Subjective difficulty, preferred hands, stamina, recognition difficulty and
editorial recommendation labels remain outside these automatic rules.

## Reference-chart checks

The retained corpus is Neskol/Maichart-Converts at
`e164add85213bab150e1487d5eb15ccb631aedb9`. The reference passages below guided
definition work and were checked against parsed retained chart events. Counts
are matches across the complete reference chart, not independent accuracy
scores or claims that every occurrence has been manually reviewed. Published
example measure numbers and retained transcription bar offsets can differ.

| Form | Reference variant | mai-notes reference measures | Matches in retained chart |
|---|---|---|---:|
| CYCLES | [CYCLES MASTER](https://mai-notes.com/player.html?chart=004ae162-497e-42da-8a75-b9980b20bc47) | 50 onward | 6 |
| Slip Flip | [Slip Flip MASTER](https://mai-notes.com/player.html?chart=93205e40-650e-481e-8669-e9c1a9d07d54) | 57–59 | 2 |
| Death Scythe | [Death Scythe MASTER](https://mai-notes.com/player.html?chart=1c42634b-d0a7-416c-958f-3eb56080baea) | 22–25 | 1 |
| Sugarbitter | [Tsuki ni Murakumo Hana ni Kaze STD MASTER](https://mai-notes.com/player.html?chart=66994666-eaf6-47b7-9f0e-12079fed089e) | 25 (substitute example) | 1 |
| Future | [Future RE:MASTER](https://mai-notes.com/player.html?chart=e56987bc-06cc-4cce-9daf-38dee93a195c) | 33 onward | 20 |
| Gekishou | [The Intense Voice of Hatsune Miku MASTER](https://mai-notes.com/player.html?chart=51006e6a-49c8-4a3e-b279-a517a12d8f9d) | 110 onward | 1 |
| Hoshizora | [Hoshizora Spectacle DX MASTER](https://mai-notes.com/player.html?chart=34d1d483-847f-4e41-bc2c-e06e8b49c048) | 74 and 120 | 5 |
| Outlaw | [Outlaw's Lullaby MASTER](https://mai-notes.com/player.html?chart=8aea4314-8e90-44db-911d-c945212175f4) | 58–61 | 4 |
| Amazing | [AMAZING MIGHTYYYY!!!! EXPERT](https://mai-notes.com/player.html?chart=b9c4b3d6-0474-4a12-b264-6602c93b259a) | 69 | 8 |
| Magic-circle | No specific reference passage was established | — | Synthetic checks only |

## Validation and release behavior

The prepared catalogue is `research-9193ba44a25e`, based on accepted catalogue
`research-92c136e47806`. All 6,959 exact charts, source metadata, artwork,
constants and 2,665 mai-notes links are preserved. Every added form has matches.
The [machine-readable coverage audit](coverage-0.3.0.json) retains full counts
and package hashes; replay it with `scripts/audit_community_patterns.py`.

| Added named motif | Matching chart variants |
|---|---:|
| CYCLES | 19 |
| Slip Flip | 2 |
| Death Scythe | 60 |
| Sugarbitter | 7 |
| Future Re:MASTER | 445 |
| Gekishou | 10 |
| Hoshizora Spectacle | 5 |
| Outlaw | 2 |
| AMAZING MIGHTYYYY!!!! EXPERT | 555 |
| Magic-circle | 54 |

Flow graphs and all observations for 35 original entries are unchanged.
The remaining original entry, isolated pattern sections, changes on 1,190
charts because it can now identify the added target patterns. The new mapping
does not turn these research observations into reviewed labels.

Each addition has a positive and confusing negative, plus capability/identity
checks. Tests also cover minima, paired-launch timing, beat-based waits,
equal-shape speed comparisons, rotation/reflection, tempo rounding, incomplete
coverage, and evidence spans. Illustrations are parsed independently from their
authored notation and checked against the detector. Their schematic curves
never enter chart recognition.

Missing or inconsistent path information returns unknown for shape-dependent
forms. Unknown and supported non-detection remain distinct. The registry and
detector versions are 0.3.0; saved 0.2.0 profiles remain readable, while cache
identities change for new analysis. Existing similarity rules retain their
original pattern-definition requirements.

Browser checks exercise all 56 primary demos, all 20 new alias-to-chart paths,
keyboard controls, privacy, accessibility and narrow layouts. Simultaneous
inputs are gold in the small diagrams, lesson timelines and simulator; a shared
slide head is counted once. The dictionary is alphabetical, and demos offer
0.1×, 0.25×, 0.5× and 1× playback. Lessons omit the Pattern references and
Variants and limits sections and the general diagram-reading instructions.
Research citations and variant notes remain in the documentation and lesson data.

Publication requires a new immutable catalogue version. This document does not
claim deployment. Independent teaching review and a held-out labeled corpus
are still required before promoting these observations beyond experimental
discovery.
