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
| Tomomai | <https://www.tomomai.lol/icon.png>, advertised by the official site's document |

Every current service section has a locally embedded image. DXRating's individual
PNG favicon URLs returned HTTP 404, but its advertised ICO works and contains
16px, 32px and 48px images. Keep the adjacent service name readable at small sizes.
BATCH-MANUAL appears as a file method in Kamaitachi, not a separate service.

JiETNG and AquaDX use the unchanged PNG logos supplied by the user for these
connectors on 2026-10-18. Their official upstream provenance and reuse license
were not independently established from those files; no license grant is
asserted. JiETNG's white transparent artwork has a dark CSS background for
contrast in the light chooser. The image itself is unchanged. Tomomai's mascot
replaces the original music-list pictogram using the official-site asset above;
its repository software license is not asserted as a separate brand-use grant.

mai-tools uses an original maimai.party wrench pictogram under the project's MIT
license. It describes the service and is not presented as a provider logo. It
contains no upstream artwork, fonts, scripts or external references. Keep the
adjacent service labels readable; detailed supplied marks are small at 24px.

| Service | Original icon | Asset decision and primary source |
| --- | --- | --- |
| mai-tools | Wrench | The [homepage](https://myjian.github.io/mai-tools/) and [pinned repository](https://github.com/myjian/mai-tools/tree/70874757c28e948913fbc8365da8f185f9b11801) provide no dedicated brand image. The userscript icon is a transparent 1px image. |

The [new icon provenance](import-service-icon-provenance.json) records exact
embedded hashes, source URLs and the distinction between official-site,
user-supplied and original icons. Other provider marks and the Party ring remain
unchanged. The source registry retains defensive text fallbacks for future
unknown services; none of
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
