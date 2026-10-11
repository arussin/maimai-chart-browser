# Score export artwork

The PNG exporters reuse SEGA game-interface artwork retained by the Session
Report's pinned Tomomai asset source, revision
`7608b9c250f4a8778cdfd4768cdecb7628cd5889` of
[shedaniel/tomomai](https://github.com/shedaniel/tomomai/tree/7608b9c250f4a8778cdfd4768cdecb7628cd5889/apps/render/public/res).
The canvas implementation is original project code; it does not import the
upstream renderer. [The inventory](score-export-artwork-provenance.json) records
each original PNG and packaged WebP hash, dimensions and conversion.

The export-only JSON module contains the PRiSM PLUS decorative background and
character illustration, normal trophy banner, achievement and DX-score labels,
and blue/red/gold achievement digit and percent atlases. The background uses
WebP quality 90 at its original dimensions; the other images use lossless WebP
with exact RGBA verification. It is dynamically imported only when generating
an export. The shared embedded [rating frames and result badges](PLAYER_ARTWORK.md)
are reused from the existing public stylesheet. Selected-version logos come
from the verified global `version-artwork/manifest.json` bundle, so a restricted
song catalog does not restrict the exporter's 28 release choices. All 28 logos use
larger genuine artwork: official SEGA pages and anniversary sprite crops, plus
originals mirrored by Logopedia, Maimai Wiki and the pinned asset repositories.
The manifest records each source hash, original dimensions and conversion.
Native originals and exact sprite crops preserve their RGBA pixels; BUDDiES alone
is reduced from 1054×603 to 800×458 to stay within the 256 KiB asset limit.
GreeN PLUS retains its original opaque branded backing. PiNK's 416-pixel-wide
official crop needs a modest 1.11× enlargement in the 462×132 header box; all other
selected logos have sufficient native pixels for that box. No logo is redrawn or
AI-upscaled, and old thumbnails remain available for immutable references.
Retained catalogs keep their own artwork references and chart identities.

The decorative theme does not establish the record's release. The user's chosen
release controls the rating split and selects its logo. The dialog and accessible
canvas description retain the release name without duplicating it on the image.
The header uses only the imported player name and the report's computed total;
it does not invent titles, avatars, course ranks or play counts. Partial reports
retain their rating-estimate notice in the dialog and accessible description.
The image omits the redundant rating caption and footer. PB exports retain their composite-record
notice and omit individual-play judgments and timing.

The existing ownership and license exclusions apply: game artwork remains owned
by SEGA and its respective rights holders, is excluded from this repository's MIT
software license, and has no separately verified redistribution grant. This
project is independent and is not endorsed by SEGA or Tomomai. See
[third-party notices](../THIRD_PARTY_NOTICES.md).


## Cabinet result composition and partner choices

The single-song image uses an original circular-screen composition based on the
[official BUDDiES PLUS result screenshot](https://info-maimai.sega.jp/5109/)
and reviewed modern cabinet photographs: CLEAR heading, slim song ribbon, large
left-aligned achievement, monumental rank, two-circle badge plinth, and compact
known result statistics. It does not include a physical cabinet bezel. The modern
angular rank and outlined CLEAR lettering are original canvas drawing, not claimed
to be extracted game textures. Best 50 uses a compact shared header and five-column
grid, larger jackets, imported constants at the top right and format suffixes
beside song titles.

A second, achievement-only lazy module supplies the larger official badge base/text
components and difficulty ribbons from the same pinned Tomomai asset inventory.
It reuses the 114-pixel badge bases instead of enlarging the small profile badges.
[The result inventory](score-export-result-artwork-provenance.json) records exact
source URLs, original and packaged hashes, dimensions and conversions. The current
record's single-chart rating is never substituted for an unavailable player DX
rating. Known chart ratings remain visible for personal bests and retained plays;
unknown player totals are omitted.

DX charts use SEGA's rainbow Japanese 「でらっくす」 chart-format badge, extracted
unchanged from the PNG data URI in the [official song stylesheet](https://maimai.sega.jp/song/song.css?20260916).
The inventory records the stylesheet hash, selector and exact PNG hash. This is
official song-page artwork matching the cabinet badge design; the original
cabinet texture itself was not recovered.

The optional partners include unmodified transparent MAGiCAL promotional
illustrations of でらっくま and カナデラ from
[SEGA's official site](https://maimai.sega.jp/), plus the six core girls,
normal でらっくま and らいむっくま＆れもんっくま from
[SEGA's official popularity poll](https://maimai.sega.jp/popularity-poll/).
The MAGiCAL names are published in root/root.js; the poll provides matching
name images, whose URLs and hashes are retained beside the character images.
The combined みるく／ちびみるく artwork is offered as one illustration.
No costume release is inferred solely from appearance.

These are authentic two-dimensional illustrations, not verified captures of
three-dimensional result poses. The default is no partner; the renderer accepts
only the reviewed metadata roster and decodes only the explicitly selected
partner. Imported records never imply a partner choice. No character was
generated or cut out from a photograph, and no remote character request is made
during export.

The date, judgment counts, maximum combo and timing counts appear only for an
actual retained play. Personal bests retain their composite-record caveat. The
export never invents a track number, previous best, improvement, after-play rating,
NEW RECORD status, or selected partner. Decorative theme/artwork is not evidence
of the game release on which a score was played.


The final reviewed roster has 25 illustrations: 10 sourced directly from SEGA
and 15 seasonal variants preserved by maimai Wiki. The Wiki file pages explicitly
attribute those variants to the official site or an archived official site.
Their file-page URLs and exact attribution strings are retained in the inventory;
several historical archive citations are incomplete and are not silently repaired
or represented as independently recovered official bytes. Every downloaded PNG
was checked visually and for alpha transparency, then converted to lossless WebP
with exact RGBA verification. No unverified collaborator or inferred partner is
included. These artwork choices do not assert ownership or an in-game unlock.

The original rank drawing uses gold upright lettering for S, faceted gold angular
lettering for SS, and prismatic angular lettering for SSS. The official result
screenshot establishes the S treatment; retained [SS](https://note.com/plumk0064/n/n08d75fb836ba)
and [SS+](https://note.com/plumk0064/n/n601360c1b2e4) cabinet photographs corroborate
the gold SS treatment, and the user's modern DX result photograph informs its
faceted styling and the outlined header. Unverified lower-rank typography uses a neutral blue fallback
instead of giving it the SSS palette. The vector lettering is an approximation of
the cabinet styling, not a claim that the original game font was recovered.


## Hosted and offline asset bounds

The result interface artwork is a separate lazy JSON module. Every partner has
an individual JSON file with an explicit dynamic import in the reviewed loader.
Hosted exports fetch and decode only the selected partner; the normal page and
an export without a partner do not fetch the other illustrations. Unknown keys
resolve to no artwork. The inventory identifies the exact source module for
every asset, and tests require a one-to-one correspondence between partner
choices, local image files and the provenance hashes.

The offline build intentionally embeds these files into its self-contained IIFE;
it does not fetch artwork from an external site. Its larger reviewed size budget
is separate from the normal per-module budget and the aggregate graph budget.
