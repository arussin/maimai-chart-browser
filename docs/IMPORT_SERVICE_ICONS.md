# Import-service marks

The service chooser embeds local copies of the marks below. Opening it does not
request images from a provider. Marks identify import sources; they do not imply
endorsement or a partnership. Provider names and trademarks remain their owners'.
Provider image bytes are unchanged. No general trademark license is claimed.
The review was refreshed on 2026-10-18. Repository software
licenses are not presented as a general grant to use the providers' brands.

| Service | Asset source |
| --- | --- |
| maimai.party Session Report | Existing Party 32px favicon in `assets/favicon.html` |
| Maishift | Existing `assets/maishift-favicon.ico`, from <https://maimai.shiftpsh.com/favicon.ico> |
| Kamaitachi | <https://cdn-kamai.tachi.ac/logos/logo-mark.png> |
| Diving-Fish | <https://maimai.diving-fish.com/favicon.ico> |
| LXNS | <https://maimai.lxns.net/favicon.webp> |
| DXRating | <https://shama.dxrating.net/favicon/pack/v1/favicon.ico>, advertised by <https://dxrating.net/search> |

Every current service section has a locally embedded image. DXRating's individual
PNG favicon URLs returned HTTP 404, but its advertised ICO works and contains
16px, 32px and 48px images. Keep the adjacent service name readable at small sizes.
BATCH-MANUAL appears as a file method in Kamaitachi, not a separate service.

Four services use original maimai.party pictograms under the project's MIT
license. These describe the service and are not presented as provider logos.
They replace the previous initial badges; they contain no upstream artwork,
fonts, scripts or external references. The 24px shapes remain readable at 16px.

| Service | Original icon | Asset decision and primary source |
| --- | --- | --- |
| JiETNG | Chat bot | The [pinned license](https://github.com/Matsuk1/JiETNG-maimai-dx-bot/blob/abc6ebf3e00dd033f549bc8e9c17870f61f357ae/LICENSE) restricts copying/distribution. The documentation logo is not bundled. |
| AquaDX | Server | The [pinned license](https://github.com/MewoLab/AquaDX/blob/4a0254ec198fe0448a2682eba82f8222a233605a/LICENSE) is CC BY-NC-SA 4.0. Its favicon remains outside this asset collection. |
| Tomomai | Music score list | The [pinned license](https://github.com/shedaniel/tomomai/blob/9ae41413a34e066ca77500f27249b4a7631c7576/LICENSE) specifies AGPL v3. No separate permissive provider-mark license was located; its favicon is not bundled. |
| mai-tools | Wrench | The [homepage](https://myjian.github.io/mai-tools/) and [pinned repository](https://github.com/myjian/mai-tools/tree/70874757c28e948913fbc8365da8f185f9b11801) provide no dedicated brand image. The userscript icon is a transparent 1px image. |

The [new icon provenance](import-service-icon-provenance.json) records exact
embedded hashes, source URLs and the distinction between provider and original
icons. Existing provider marks and the Party ring remain unchanged. The source
registry retains defensive text fallbacks for future unknown services; none of
the ten current services uses them. Browser coverage requires all ten images to
decode locally before the chooser is accepted.

The retained Kamaitachi CDN mark and existing Maishift favicon identify their
respective sources. This review established their first-party provenance, not a
separate brand-use license. Neither the Tachi seed-data license nor Party's own
MIT license is asserted to cover those marks. No upstream code is bundled by
this icon change.

The acquired asset hashes and download status are recorded with the local
review evidence under `investigations/import-service-ui-20261011/icon-downloads.json`
in the parent workspace. That acquisition receipt also records reviewed assets
subsequently omitted; `web/src/views/import-service-icons.json` is the actual
bundled set. See the provider links above for first-party provenance.

## Diving-Fish notice

The first-party [maimaidx-prober license](https://github.com/Diving-Fish/maimaidx-prober/blob/main/LICENSE)
is MIT. Its copyright and permission notice are retained below for the
Diving-Fish material; this does not imply endorsement or grant trademark rights.

MIT License

Copyright (c) 2020 Diving-Fish

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## LXNS notice

The [pinned maimai-prober-frontend license](https://github.com/Lxns-Network/maimai-prober-frontend/blob/e779ffc93e78a7f2bba60de88b831f3230ad04c1/LICENSE)
is MIT. Its [README](https://github.com/Lxns-Network/maimai-prober-frontend/blob/e779ffc93e78a7f2bba60de88b831f3230ad04c1/README.md)
identifies `public/favicon.webp` as the site logo. The copyright and permission
notice are retained below; this does not imply endorsement or grant trademark rights.

MIT License

Copyright (c) 2026 Lxns-Network

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## DXRating notice

The first-party [DXRating repository license](https://github.com/gekichumai/dxrating/blob/2ee0c4ef6bda9abe0612ecdc0eff03a4f1dab431/LICENSE)
is MIT. The site advertises the unchanged favicon retained here. Its software
license is not asserted as a separate trademark grant.

MIT License

Copyright (c) 2024 Gekichumai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
