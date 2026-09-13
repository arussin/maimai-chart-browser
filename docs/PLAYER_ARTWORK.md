# Personal result artwork

Combo/sync circles and rating frames are SEGA game-interface artwork from
[Tomomai's public assets](https://github.com/shedaniel/tomomai/tree/7608b9c250f4a8778cdfd4768cdecb7628cd5889/apps/render/public/res),
pinned at `7608b9c250f4a8778cdfd4768cdecb7628cd5889`.
The [asset inventory](player-artwork-provenance.json) records original and packaged
SHA-256 hashes, dimensions and filenames. PNGs were converted to lossless WebP
with exact RGBA pixels verified, including transparent pixels.

`player-artwork.css` embeds the images in the public stylesheet. Viewing or
importing a profile does not request images from a third party. Player files
and initial offers contain no artwork, markup, avatar or player-selected image.
The placard renders the player name as text and selects its frame from a fixed
list using the reconstructed Old 35 / New 15 rating. Unknown ratings have no
rating frame. Retained session counts use distinct source session IDs, never
PB snapshot counts. Older report offers without these summary fields remain
compatible and display the known name and retained play count.

Game artwork is excluded from this repository's MIT software license. Its
ownership remains with SEGA; Tomomai's AGPL code license does not establish an
independent redistribution grant for game artwork. No separate grant has been
verified. This project is independent and is not endorsed by SEGA or Tomomai.
See [third-party notices](../THIRD_PARTY_NOTICES.md).
