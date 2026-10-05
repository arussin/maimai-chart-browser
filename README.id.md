Pengembangan di Windows: baca [DEVELOPMENT.md](DEVELOPMENT.md). Gunakan workspace DevCache untuk contoh dengan jalur output relatif di bawah; snapshot output yang sudah ada merupakan bukti yang harus dipertahankan.

# maimai.party · Browser Chart

[English](README.md) · [简体中文](README.zh-Hans.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Bahasa Indonesia](README.id.md)

**Produksi, 3 Oktober 2026:** [rilis, verifikasi, dan batas operasional](docs/PRODUCTION_RELEASE_20261003.md). Halaman lagu/versi yang dilokalkan dan pengumpul penggunaan harian privat sudah aktif; [Search Console dan sitemap](docs/SEARCH_VISIBILITY.md) serta [laporan penggunaan pemilik](usage-worker/README.md) memiliki panduan operasional tersendiri.

Pemeliharaan lokalisasi: [teks UI kanonis, istilah game, dan pembangunan ulang pencarian multibahasa](docs/LOCALIZATION.md).

Browser chart statis mandiri, mesin analisis Python yang dapat digunakan kembali, dan pengunduh Kamaitachi hanya-baca. Rekomendasi pribadi dihitung saat pengunduhan/ekspor; pencarian, filter, Alur input, dan perbandingan struktur bersifat interaktif.

[Inventaris resmi persisten](docs/REGISTRY_IMPLEMENTATION.md) memisahkan lagu dan varian chart yang diketahui dari transkripsi serta analisis opsional. Rekaman data Jepang dan Internasional yang ditinjau mencakup chart dengan metadata saja, mempertahankan tautan lama, dan menjaga kontrak integrasi Session Report yang sudah ada.

[Alur pembaruan katalog yang dijalankan pemilik](docs/CATALOG_UPDATES.md) menyiapkan pembaruan sumber, analisis tersimpan dalam cache, metadata, dan tautan pemutar mai-notes yang tepat secara bersamaan, disertai laporan perubahan dan publikasi terverifikasi. Kecocokan yang dapat dimainkan muncul di samping YouTube sebagai **Pemutar simai mai-notes**, khusus untuk tingkat kesulitan yang dipilih.

Memerlukan Python 3.11+. Paket ini tidak memiliki dependensi saat runtime dan tidak memerlukan pustaka laporan. Instal dari checkout ini menggunakan `python -m pip install .`.

Browser publik dapat menampilkan pencapaian Anda sendiri dan riwayat chart tersimpan secara opsional. Impor berkas pemain melalui Pengaturan atau terima transfer dari Session Report. Data tetap di browser Anda; mengingatnya di perangkat bersifat opsional. Filter pribadi dapat diciutkan tanpa menghapus pilihan Anda. Huruf grade berwarna dan ikon combo/sync ringkas menyertai label **Anda** yang tidak mencolok pada setiap chart yang tercatat. Identitas pemain, cakupan rekaman data, dan kontrol penyimpanan berada di Pengaturan. Chart yang dibuka mengelompokkan hasil pengukuran dan pola dalam **Detail chart**, diikuti **Data Anda** dan riwayat tersimpan. Kedua kelompok mengingat status perluasannya saat berpindah lagu dan kunjungan. Bandingkan dan Cari yang serupa tetap berada pada kartu utama di samping gambar versi chart. Lihat [data pribadi, tautan tepat, dan antarmuka pencocokan publik](docs/PLAYER_DATA.md).

## Pratinjau

```sh
maimai-chart demo --output output/site
python -m http.server 8765 --bind 127.0.0.1 --directory output/site
```

Buka `http://127.0.0.1:8765`. Demo yang disertakan bersifat fiktif, bukan cakupan game. Bangun dengan metadata nyata yang telah ditinjau menggunakan `maimai-chart site --catalog catalog.json --catalog-version RELEASE --output output/site`. Versi katalog tidak dapat diubah; pembangunan berulang mempertahankan rilis dan tautan sebelumnya. Sajikan direktori hasil sebagai berkas statis, termasuk manifes dan asetnya. Tidak diperlukan layanan akun, endpoint unggahan, atau server aplikasi. [Rencana rilis publik](docs/PUBLIC_RELEASE.md) mengikuti penyelesaian sasaran deteksi pola yang aktif. Rencana ini mencakup sumber publik, hosting maimai.party, kontribusi komunitas, dan publikasi korpus resmi yang hanya dilakukan pemilik. Lihat [panduan kontribusi](CONTRIBUTING.md).

Kedua halaman browser menggunakan logo teks maimai.party, dengan warna terinspirasi Deluxe pada `.party`. Bagian Tentang memasangkan **Lihat di GitHub** dengan **Dukung maimai.party** saat Stripe diaktifkan. Footer mempertahankan pemberitahuan hak untuk proyek penggemar independen serta **Kredit & ucapan terima kasih**. Lihat [atribusi dan peran sumber](THIRD_PARTY_NOTICES.md). Repositori proyek bersifat publik; kontribusi menggunakan issue dan pull request. Publikasi situs resmi merupakan tindakan eksplisit pemilik yang dijelaskan dalam [panduan pemilik](docs/OWNER_PUBLICATION.md).

Situs HTTPS yang dipublikasikan menyertakan Google Analytics opsional untuk tampilan halaman umum. Layanan ini hanya dimuat setelah pengunjung menyetujuinya; pratinjau lokal dikecualikan. Berkas pribadi, pencarian, pilihan chart, dan URL lengkap tidak pernah menjadi data peristiwa analitik. Footer memuat rincian privasi dan cara menarik persetujuan tanpa menghapus hasil. Lihat [penyiapan analitik dan verifikasi peluncuran](docs/ANALYTICS.md).

Untuk membuka browser riset lengkap di samping Explore, tambahkan `--lab-package PATH/TO/challenge-v1` pada perintah demo atau site. Perintah ini memverifikasi paket riset yang dipatok dan memisahkan datanya di balik manifes rilis yang tidak dapat diubah. Halaman utama menautkan ke browser riset dengan tiga tampilan:

- **Chart:** gabungkan filter genre, versi, kesulitan, format, dan rentang level. Pilih beberapa versi sekaligus. Setiap baris lagu/format menyediakan pemilih tingkat kesulitan yang memuat chart persis yang cocok dengan filter, termasuk varian MASTER/RE:MASTER dengan level sama. Tingkat kesulitan yang dipilih memberi warna pada baris serta menentukan level, BPM sumber, laju input, dan tindakan perbandingannya. Klik bagian lain pada baris untuk membuka detail. Klik judul kolom untuk mengurutkan dan membalik arah; Shift-klik atau **Pertahankan prioritas pengurutan** menambahkan kriteria pemecah urutan seri. Chip prioritas yang terlihat dapat menghapus aturan. Pengurutan selalu menggunakan chart yang dipilih. **Kesulitan** mengurutkan berdasarkan level yang ditampilkan (10, 10+, 11); **Konstanta** mengurutkan berdasarkan konstanta desimal tersimpan. Nilai yang tidak diketahui selalu diurutkan terakhir pada kedua arah. Mengubah pengurutan atau pencarian mempertahankan filter. Pencarian lagu juga menerima romaji komunitas dan judul alternatif: **Umiyuri** menemukan **ウミユリ海底譚**, dan **Senbonzakura** menemukan **千本桜**. Spasi, tanda baca, kapitalisasi, dan huruf Latin lebar penuh ditoleransi. Alias yang sama berfungsi di Explore dan kedua pemilih perbandingan; judul asli tetap ditampilkan. [Cakupan alias dan rincian sumber](docs/SONG_SEARCH.md). BPM lagu dari sumber merupakan metadata tampilan; bagian tertentu dapat berubah tempo. BPM yang tidak diketahui tetap tidak diketahui dan diurutkan terakhir pada kedua arah. **Cari di YouTube** membuka tab baru menggunakan judul lagu, format chart, dan tingkat kesulitan yang dipilih. Tautan yang sama muncul pada pilihan perbandingan dan hasil serupa. Ini adalah pencarian, bukan kecocokan video terverifikasi; ketersediaannya tidak dijamin. Tidak ada video, thumbnail, atau permintaan YouTube yang dimuat sebelum pengunjung mengikuti tautan. Entri dengan judul kosong tidak memiliki tautan pencarian. Tag pola eksperimental yang telah disiapkan menautkan ke pelajaran; filter pola hanya mempertahankan tingkat kesulitan yang cocok. Detail menampilkan jumlah kemunculan yang diamati dan rentang waktu chart. Setiap baris memiliki grafik Alur input dengan 24 bagian, rata-rata kepadatan, dan penanda puncak singkat. Grafik mini menggunakan skala puncaknya sendiri; perbandingan menggunakan satu skala vertikal bersama.
- **Kamus pola:** 56 pelajaran diurutkan menurut abjad, dengan contoh dan penjelasan yang dibuat untuk pengajaran. Kontrol Putar, Langkah, kecepatan, dan progres bekerja pada semua demo, termasuk pemutaran 0.1×, 0.25×, 0.5×, dan 1×. Kasus pembanding, varian, serta keterbatasan tetap berada dalam data pelajaran. Input serentak berwarna emas pada diagram dan pemutaran. Pola input menggunakan tampilan waktu dan posisi; karakteristik chart menggunakan grafik aktivitas atau frasa yang disorot. Pembacaan peristiwa saat ini menjelaskan setiap langkah. Umiyuri memiliki ilustrasi dengan cakupan terbatas berdasarkan sumber untuk satu bentuk yang berulang. Contoh pengajaran tidak menetapkan label pada chart nyata atau memvalidasi detektor. Alias bahasa Inggris mencakup jacks, sweeps, spins, dan connected slides. Sepuluh motif komunitas tambahan dan sepuluh bentuk struktural terkait memiliki pelajaran bahasa Inggris, kurva skematis bila diperlukan, dan aturan pengenalan eksperimental dengan cakupan terbatas. Lihat [referensi dan cakupan pola komunitas](docs/patterns/COMMUNITY_PATTERNS.md). Lihat [daftar pemeriksaan kamus dan tinjauan yang tersisa](docs/PATTERN_DICTIONARY.md).
- **Bandingkan chart:** pilih dua chart apa saja menggunakan pemilih yang dapat dicari, atau pilih satu lalu **Cari yang serupa** di seluruh katalog. Perbandingan menggunakan hasil pengukuran chart yang sudah ada untuk kecepatan input, ritme, input serentak, hold, slide, dan tata letak. Hasil serupa menampilkan satu chart per kelompok lagu; filter chart yang aktif dapat diterapkan secara opsional. Tautan mempertahankan kedua ID chart dan versi katalog. Pola yang sama dan berbeda, jumlah/laju kemunculan, serta pasangan grafik Alur input muncul sebelum tabel pengukuran. **Pola & hasil pengukuran** memprioritaskan keberadaan pola eksperimental, laju kemunculan, dan cakupan waktunya (total 60%), dengan tuntutan permainan terukur menyumbang 40%. Pola yang lebih jarang mendapat bobot lebih tinggi; cakupan yang tidak didukung tidak pernah dianggap sebagai ketiadaan pola. **Hasil pengukuran** mempertahankan pengurutan sebelumnya. Ini adalah perbandingan eksperimental, bukan label kelompok yang telah memenuhi kualifikasi komunitas atau rekomendasi pribadi. Animasi bagian chart yang disinkronkan tetap tersedia untuk pasangan yang sudah disiapkan, dengan contoh asli dalam **Demonstrasi bagian chart yang disiapkan**.

Antarmuka mengikuti tampilan putih/hijau kebiruan pada situs laporan. Tautan kamus mempertahankan versi katalog riset dan ID pola. Data riset tidak disertakan dalam distribusi Python atau repositori sumber dan tidak dapat menerima hasil pribadi.

Untuk menyiapkan ekstensi pola/Alur input riset dari input tersimpan:

```sh
python scripts/build_research_overview.py RETAINED_SOURCE EXISTING_PACKAGE NEW_PACKAGE
maimai-chart demo --output output/site --lab-package NEW_PACKAGE
```

Perintah offline ini menjalankan 14 detektor eksperimental yang sudah ada dan perhitungan Alur input untuk setiap chart persis, sambil mempertahankan hash sumber. Perintah ini menulis cache yang dapat dilanjutkan dan memublikasikan manifes paket baru hanya setelah semua chart selesai. Paket asli, peringkat, arsip, dan layanan pribadi tidak berubah. Pembangunan browser menambahkan rilis yang tidak dapat diubah; tautan lama mempertahankan data sebelumnya.

## Unduh dan siapkan hasil pribadi

```sh
maimai-chart download USERNAME --game maimaidx --store .snapshots/player
maimai-chart prepare --snapshot .snapshots/player/captures/SNAPSHOT_ID/snapshot.json --catalog catalog.json --catalog-version RELEASE --mapping reviewed-mapping.json --output output/my-results.json
```

Pengunduh membaca PB dan skor terbaru Kamaitachi yang sudah ada. Pengunduh tidak pernah memicu impor game. Apabila akses memerlukan token, berikan `KAMAITACHI_API_TOKEN` melalui lingkungan proses; token tidak pernah ditulis ke snapshot atau berkas browser. Tidak ada percobaan ulang otomatis atau permintaan terjadwal.

Untuk mengunduh dan menyiapkan dalam satu perintah, tambahkan keempat opsi persiapan pada `download`. Opsi `--settings settings.json` memilih kebijakan rekomendasi, sasaran latihan, dan kuota yang sudah ada. Mengubah sasaran memerlukan penyiapan berkas lain. Buka berkas hasil menggunakan **Buka hasil saya**. Berkas tetap berada dalam memori tab; **Hapus hasil saya** atau pemuatan ulang halaman menghapusnya. Tidak ada data pribadi yang diunggah.

Setiap penyimpanan dimiliki oleh satu pemain/game. Manifesnya mencantumkan rekaman data tetap yang berhasil dan identitas terbaru. Setiap rekaman memuat `pbs.json`, `recent.json`, dan `snapshot.json`. Percobaan yang tersedia dikumpulkan berdasarkan ID skor yang tepat, tetapi riwayat tetap tidak lengkap: membaca skor terbaru secara berkala tidak dapat merekonstruksi setiap percobaan di masa lalu. Rekaman yang terputus tidak dapat mengganti penunjuk terbaru sebelumnya. Kunci yang kedaluwarsa memerlukan pemeriksaan bahwa tidak ada proses penulis aktif sebelum dihapus secara manual.

## Integrasi

Antarmuka Python: `maimai_analyzer.catalog.build_catalog`, `maimai_intelligence.snapshots.download_snapshot`, `maimai_intelligence.bundles.prepare_player_bundle`, dan `export_report_bundle`. Untuk pencocokan ringkasan publik, `maimai_analyzer.challenge_similarity.query_demands` menerima profil chart yang sudah ada dan skala referensi tanpa memerlukan jendela bagian chart. Browser menggunakan perhitungan persentil dan jarak yang setara. Lihat [kontrak berversi](docs/CONTRACTS.md) dan [integrasi laporan](docs/REPORT_INTEGRATION.md).

Instalasi laporan biasa tidak memerlukan repositori atau mesin ini. Kartu yang disiapkan dan tautan khusus katalog adalah fitur laporan opsional. Arsip yang sudah ada tidak memerlukan migrasi atau pengisian riwayat lama.

Studi transkripsi saat ini merupakan data evaluasi. Data tetap nonpribadi dan tidak dapat digunakan untuk rekomendasi rating yang terverifikasi. Bundel pribadi memerlukan pemetaan persis dari penyedia ke katalog yang telah ditinjau secara eksplisit serta katalog yang memenuhi kualifikasi. Pencapaian yang tidak diketahui, percobaan yang tidak tersedia, dan ketersediaan yang belum terverifikasi tetap tidak diketahui.

## Pengembangan

Jalankan `python -m unittest discover -s tests` dengan `PYTHONPATH=src` (serta direktori akar repositori pada jalur impor). Pengujian browser berada di `tests/browser`; instal dependensi yang dikunci menggunakan `npm ci`, instal browser Playwright, lalu jalankan `npm test`. Backend build mendukung distribusi wheel dan sumber tanpa mengunduh dependensi build. Fixture penganalisis asli dan kesetaraan perhitungan kemiripan Python/JavaScript dipertahankan.

Skrip pengambilan data/pembangunan riset dan perender Challenge Lab yang sudah ada dipertahankan secara terpisah. Keduanya tetap menjadi alur offline/riset yang eksplisit; membuka browser utama tidak menjalankannya. Atribusi: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Filter chart

Kesulitan berupa menu kotak centang: pilih kombinasi apa pun dari BASIC hingga RE:MASTER. Baris mempertahankan pemilih untuk tingkat kesulitan yang cocok dan sedang ditampilkan. Rentang level memiliki dua penanda yang dapat digeser dan diakses dengan keyboard, serta kolom Dari/Hingga yang dapat diedit. Tekan Enter atau tinggalkan kolom untuk menerapkannya; `13.5` diterima sebagai `13+`. Batas menggunakan level yang tersedia dalam katalog terpilih. Teks tidak valid tidak mengubah rentang yang diterapkan, dan mengetik batas melampaui batas lainnya memindahkan keduanya ke level itu. Kosongkan kolom untuk mengembalikan sisi rentang tersebut ke batas penuh. Atur ulang level mempertahankan filter lain. Perbandingan menggunakan batasan kesulitan/rentang yang sama ketika “Terapkan filter chart pada hasil pencocokan” diaktifkan. Pola menggunakan menu kotak centang yang dapat dicari; pencarian mencakup alias dan pilihan cocok dengan salah satu pola terpilih. Pola terpilih tetap berupa chip yang dapat dihapus dan dipertahankan melalui parameter URL `pattern-filter` yang berulang; tautan pola tunggal dan pencarian melalui kamus yang sudah ada tetap berfungsi. Pola tanpa cakupan yang didukung ditampilkan nonaktif.

## Gambar publik opsional

Siapkan gambar sampul dan logo versi sekali, lalu sajikan berkas WebP lokal yang dihasilkan. Persiapan memerlukan Pillow (`python -m pip install Pillow`); penelusuran dan pembangunan paket yang sudah disiapkan tetap menggunakan instalasi biasa tanpa dependensi.

```sh
python -m scripts.prepare_public_artwork output/challenge-patterns-v1 output/challenge-artwork-v1 --cache output/artwork-cache/downloads
maimai-chart demo --output output/site --lab-package output/challenge-artwork-v1
```

Perintah hanya membaca metadata dan gambar publik. `--offline` menggunakan kembali cache tanpa akses jaringan. Gambar yang tidak tersedia menjadi placeholder netral. Gambar sampul memerlukan kecocokan unik pada judul yang dinormalisasi **dan artis**; pencarian tampilan ini tidak menetapkan identitas chart atau mengaktifkan personalisasi. Paket mencatat URL sumber, hash sumber, dan hash gambar hasil konversi. Browser hanya memuat aset dari situs yang sama, tanpa informasi akun, permintaan gambar jarak jauh, atau skrip pihak ketiga.

Sumber tersimpan sudah mencakup CiRCLE (78 entri lagu/format, 315 chart) dan CiRCLE PLUS (18 entri, 75 chart). Cabang default sumber diperiksa pada 2026-09-11: commit `e164add85213bab150e1487d5eb15ccb631aedb9` masih cocok dengan pohon tersimpan, tanpa jalur yang ditambahkan atau diubah. Rilis terbaru sumber adalah [v1.66_1.0.9.0](https://github.com/Neskol/Maichart-Converts/releases/tag/v1.66_1.0.9.0), pembaruan peluncuran CiRCLE PLUS; ini merupakan cakupan sumber, bukan katalog lengkap dari game terkini. Versi dalam pemilih menampilkan jumlah lagu dan chart yang sebenarnya.
