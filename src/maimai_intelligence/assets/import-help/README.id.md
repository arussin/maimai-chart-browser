# Impor data pemain

Buka **Impor data pemain**, lalu buka layanan yang Anda gunakan. Ikuti langkah-langkah di bawah dan periksa pemain, wilayah, skor terbaik pribadi (PB), chart yang tidak cocok, serta catatan yang dikecualikan sebelum mengimpor. Pilihan ingat menyimpan data di perangkat ini; impor sekali menyimpannya hanya dalam tab ini.

<a id="direct-connections"></a>

## Koneksi dan pembaruan

Saat koneksi Diving-Fish atau LXNS tersedia, Anda dapat memberikan izin untuk membaca data akun. Pemain tidak perlu mendaftarkan aplikasi pengembang. Masuk hanya di situs penyedia yang dipilih. Party tidak pernah meminta kata sandi akun tersebut. Layanan koneksi Party menyimpan izin akses terenkripsi dan label akun untuk pembaruan; skor disimpan di browser Anda. Memutuskan koneksi menghapus izin yang disimpan Party; untuk Fish, Anda juga dapat mencabut akses melalui [aplikasi yang diizinkan](https://auth.diving-fish.com/apps). Lihat bagian LXNS di bawah untuk langkahnya. Maishift dan Kamaitachi membaca data publik tanpa izin akses akun.

**Pembaruan membaca data yang sudah tersimpan di layanan pencatat skor. Pembaruan tidak mengambil hasil baru dari SEGA, Wahlap, atau maimai NET.** Perbarui data pada layanan tersebut terlebih dahulu. Tanggal pembaruan bukan tanggal bermain. Kegagalan membaca data tidak menghapus skor tersimpan. Jika ketersediaan koneksi tidak dapat diperiksa, coba lagi nanti; ini tidak berarti pengelola telah menonaktifkan koneksi.

<a id="session-report"></a>

## Berkas pemain Session Report / Party

1. Buka bagian Session Report di Party dan pilih metode berkas. Pilih berkas pemain terkompresi (.gz) yang sudah diunduh dari Session Report atau Party.
2. Untuk laporan yang dihosting, pilih metode URL laporan dan tempel URL-nya. Laporan yang secara eksplisit bersifat publik harus mengizinkan akses browser. Untuk laporan privat, masuk di situs laporan lalu pilih **Open in Party**, atau unduh berkas pemainnya; pembaruan laporan privat memerlukan pengiriman dengan bantuan ini.
3. Tinjau profil, lalu impor sekali atau ingat data tersebut.

Session Report menyiapkan berkas dari data Kamaitachi dan riwayat yang tersimpan. Berkas ini bukan cadangan akun bawaan Kamaitachi.

<a id="maishift"></a>

## Maishift

1. Perbarui catatan Anda dengan mengikuti [panduan Maishift](https://maimai.shiftpsh.com/en/guide). Selesaikan langkah masuk ke NET dan penggunaan bookmarklet di situs-situs tersebut.
2. Buka bagian Maishift di Party, lalu masukkan nama pengguna publik atau URL profil. Pemain tidak perlu memberikan kata sandi atau melakukan pengaturan pengembang.
3. Baca profil, periksa wilayah dan pratinjau PB, lalu impor.

Catatan Jepang dan Internasional tetap terpisah. URL yang memuat `@jp`, `@intl`, atau `@na` memilih kumpulan catatan tersebut; Amerika Utara menggunakan catatan Internasional dengan ketersediaan chart yang berbeda. Nama pengguna tanpa URL memulai permintaan pada wilayah Internasional dan menggunakan wilayah yang dikembalikan Maishift. Jika keduanya tersedia, tempel URL `@jp` untuk memilih Jepang. Bahasa tampilan tidak memilih wilayah, dan pembaruan koneksi yang diingat tetap menggunakan wilayah yang dipilih.

Metode ini mengimpor PB chart yang sudah dimainkan, bukan riwayat bermain. Tidak ada metode impor cadangan berkas bawaan Maishift yang didukung. Berkas pemain Session Report/Party yang sudah ada menggunakan bagian layanan terpisah di atas.

<a id="kamaitachi"></a>

## Kamaitachi

1. Gunakan profil maimai DX Kamaitachi yang sudah berisi skor. Jika hasil terbaru belum ada, perbarui Kamaitachi melalui [halaman impornya](https://kamai.tachi.ac/import) terlebih dahulu. Party tidak membuat akun Kamaitachi atau mengunggah skor arcade.
2. Buka Kamaitachi di Party. Masukkan nama pengguna, ID pengguna numerik, atau URL profil seperti `https://kamai.tachi.ac/u/username`.
3. Periksa pemain yang ditemukan dan pratinjau PB dengan saksama: pencarian data publik tidak memverifikasi kepemilikan akun. Impor sekali atau ingat profil untuk pembaruan berikutnya.

Party membaca API publik Kamaitachi tanpa kata sandi atau kunci API. Metode ini mengimpor PB maimai DX yang tersimpan, termasuk chart STD dan DX; game maimai lama yang terpisah serta seluruh riwayat bermain tidak diimpor. ID akun numerik membedakan akun yang berganti nama dari pemain lain. Identitas Session Report lama yang memakai nama pengguna tetap terpisah.

Jika pemain ditemukan tetapi belum memiliki skor maimai DX, tambahkan skor ke Kamaitachi terlebih dahulu, lalu coba lagi. Pembaruan di Party membaca data yang sudah ada di Kamaitachi. Waktu pengambilan bukan waktu bermain terakhir atau waktu sinkronisasi di layanan asal.

Untuk berkas pertukaran, pilih **Unggah BATCH-MANUAL** di Kamaitachi. Lihat [batasan format berkas](#tachi); ini bukan cadangan akun bawaan Kamaitachi.

<a id="diving-fish"></a>

## Diving-Fish / 水鱼查分器

Koneksi ini mengimpor skor **舞萌 DX (Tiongkok daratan)** yang sudah tersimpan di Diving-Fish. Layar masuk, pengaturan profil, dan panduan penyiapannya saat ini berbahasa Mandarin.

1. Buka [Diving-Fish](https://maimai.diving-fish.com/), masuk, setujui ketentuan layanan pencatat skornya, dan pastikan skor Anda terlihat di sana.
2. Jika baru menggunakan Fish, daftar dan selesaikan verifikasi email ketika diminta, lalu ikuti [panduan impor skor](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/). Membuat akun tidak menambahkan skor arcade. Selesaikan impor ke Fish sebelum kembali ke Party.
3. Di **编辑个人资料** (Edit profil) milik Fish, nonaktifkan **对非网页查询的成绩使用掩码** (penyamaran skor untuk permintaan di luar situs web) agar skor tetap tepat. Party tidak dapat memverifikasi pengaturan ini. Anda boleh tetap mengaktifkan **禁止公开接口使用我的成绩（授权不受影响）**: pembatasan kueri publik tidak menghalangi koneksi yang telah Anda izinkan.
4. Buka Diving-Fish di Party lalu centang **Skor saya sudah diperbarui.** dan **Penyamaran skor sudah dimatikan.**, kemudian hubungkan akun. Gunakan **?** di samping langkah untuk penjelasan. Masuk dan berikan izin baca profil serta skor di `auth.diving-fish.com`.
5. Kembali ke Party, periksa pemain yang ditemukan, jumlah PB, serta chart yang tidak cocok sebelum mengimpor sekali atau mengingat koneksi.

Jika Fish belum memiliki skor, perbarui Fish terlebih dahulu. Jika Party meminta persetujuan ketentuan layanan pencatat skor, buka Fish, setujui ketentuannya, dan periksa skor Anda. Koneksi yang diingat kemudian dapat mencoba pembaruan lagi. Impor pertama yang gagal menghapus koneksi yang belum dikonfirmasi; hubungkan kembali setelah penyiapan selesai.

Pembaruan membaca PB yang tersimpan di Fish; pembaruan tidak memasukkan hasil arcade baru ke Fish atau membuat riwayat bermain. Waktu pengambilan menunjukkan kapan Party membaca Fish, bukan kapan Anda terakhir bermain. Pembacaan yang gagal atau kosong tetap mempertahankan data tersimpan, termasuk PB yang tidak muncul dalam respons baru. Chart yang tidak cocok tetap disimpan tanpa menebak identitasnya.

Untuk menghentikan akses berikutnya, putuskan koneksi di Party. Anda juga dapat mencabut izin Party melalui [aplikasi yang diizinkan di Fish](https://auth.diving-fish.com/apps). Jika izin kedaluwarsa atau dicabut, hubungkan kembali. Skor yang sudah tersimpan di browser ini dapat dihapus secara terpisah di Party.

<a id="lxns"></a>

## LXNS / 落雪咖啡屋

**Best 50 versi Tiongkok daratan:** Impor Fish dan LXNS menyimpan pilihan 35 chart lama/15 chart baru beserta rating dari layanan tersebut. Tidak perlu memilih versi Jepang/internasional. Segarkan koneksi yang sudah tersimpan satu kali untuk mendapatkannya. Gambar mencerminkan data saat diimpor; segarkan lagi setelah memperbarui skor di layanan. Chart tanpa gambar sampul tetap disertakan. Jika kurang dari 50 chart, gambar ditandai sebagai laporan sebagian.

Gunakan koneksi ini untuk skor **舞萌 DX (Tiongkok daratan)** yang sudah terhubung ke akun LXNS Anda. Panduan pengaturan LXNS tersedia dalam bahasa Mandarin.

1. Masuk ke [LXNS](https://maimai.lxns.net/) dan periksa skor Anda. Jika belum ada, ikuti [panduan sinkronisasi data permainan](https://maimai.lxns.net/docs/sync) dahulu. Membuat akun saja tidak menambahkan skor; sinkronisasi daring pertama menghubungkan data permainan ke akun.
2. Di Party, buka LXNS, centang **Skor saya sudah diperbarui.**, lalu pilih **Hubungkan LXNS**. Gunakan **?** untuk penjelasan. Masuk di `maimai.lxns.net` dan izinkan akses baca saja. Pemain tidak perlu mendaftarkan aplikasi pengembang atau menyediakan kunci API pribadi.
3. Kembali ke Party dan periksa pemain, wilayah Tiongkok, jumlah PB, serta chart yang tidak cocok. Impor sekali atau ingat koneksi untuk pembaruan berikutnya.

Yang diimpor adalah PB tersimpan, bukan riwayat permainan. Pembaruan hanya membaca LXNS lagi, tanpa memulai sinkronisasi skor arcade. Hasil kosong atau kegagalan membaca tidak menghapus data tersimpan. Jika tidak ada skor yang dapat diimpor, sinkronkan ke LXNS dahulu. Kegagalan impor pertama membuang koneksi yang belum dikonfirmasi; hubungkan kembali setelah pengaturan selesai.

Putuskan koneksi di Party untuk menghapus izin yang disimpannya. Sesuai [panduan izin akses](https://maimai.lxns.net/docs/mcp), Anda juga dapat mencabut izin Party pada **第三方应用** (aplikasi pihak ketiga) di profil LXNS. Skor yang sudah tersimpan di browser dapat dihapus secara terpisah di Party.

<a id="mai-tools"></a>

## mai-tools / DX Rating Analyzer

1. Ikuti [panduan pengaturan alat ini](https://myjian.github.io/mai-tools/#howto), masuk ke situs NET resmi yang sesuai, lalu jalankan **Analyze Self DX Rating**.
2. Di analyzer, pilih **Share → Export as JSON (all records)** dan simpan `maimai-scores-<timestamp>.json`.
3. Buka bagian mai-tools di Party dan pilih berkas JSON.

Jika Anda mengekspor format DXRating dari analyzer, gunakan bagian DXRating di bawah. B15/B35 hanya memuat sebagian catatan. TSV dari clipboard dan tangkapan layar tidak diterima.

<a id="dxrating"></a>

## DXRating

1. Buka [My rating](https://dxrating.net/rating) di browser tempat catatan Anda disimpan. Jika perlu, isi datanya terlebih dahulu menggunakan alat impor milik DXRating.
2. Pilih **Export... → Export to JSON (all records)** dan simpan `dxrating.export-<timestamp>.json`.
3. Buka bagian DXRating di Party dan pilih berkas JSON.

**Export to JSON (B50 records only)** juga dapat digunakan, tetapi hanya memuat bagian catatan tersebut. Gambar bukan berkas skor. Mengekspor tidak mengambil hasil baru dari mesin.

<a id="tomomai"></a>

## Tomomai

1. Ini adalah metode respons API untuk pengguna tingkat lanjut. Ikuti pengaturan kunci pribadi **Settings → Developer** yang didokumentasikan Tomomai dan gunakan klien API yang Anda percayai. Party tidak memiliki kolom kunci API.
2. Simpan hanya isi JSON dari respons yang berhasil untuk `GET /api/v1/snapshots/latest?region=<region>` pada instalasi Tomomai Anda. Kunci memerlukan izin metadata snapshot dan pembacaan lagu yang disebutkan dalam dokumentasi. Lihat [panduan kunci pribadi](https://github.com/shedaniel/tomomai/blob/ee29589979ed37eb0203ab00781d5e70c984ccb2/apps/main/content/developer/guides/api-keys.mdx).
3. Buka bagian Tomomai di Party. Isi label akun dan wilayah yang sesuai, lalu pilih berkas JSON.

Respons B50 hanya memuat sebagian skor. Respons yang hanya berisi catatan terbaru tetap disimpan sebagai pengamatan skor, bukan PB atau permainan yang dihitung; satu halaman tidak mencakup seluruh riwayat. Belum ada tombol unduh JSON skor biasa yang terverifikasi. Gambar dan arsip permintaan jaringan tidak didukung.

<a id="jietng"></a>

## JiETNG v2

1. Selesaikan [pengaturan dan sinkronisasi skor JiETNG](https://jietng.matsuk1.com/en/guide/getting-started) jika diperlukan.
2. Kirim `export json` dalam percakapan pribadi LINE, atau gunakan `/export` jika integrasi Discord tersedia. Segera unduh JSON-nya; tautan ekspor dapat kedaluwarsa.
3. Buka JiETNG v2 di Party. Pilih wilayah Jepang atau Internasional yang sesuai, lalu pilih berkas JSON `JiETNG-*`.

Party mendukung JSON bawaan versi 2, bukan XML atau gambar B50. Catatan terbaik menjadi snapshot PB; catatan terbaru tetap berupa pengamatan skor tanpa menambahkan jumlah permainan yang tidak terbukti. Jangan masukkan Import Token bot ke Party.

<a id="aqua"></a>

## AquaDX / AquaNet

1. Masuk ke situs AquaNet milik server Anda sendiri. Dalam pengaturan, pilih **Mai → Export Player Data**.
2. Simpan `AquaDX_maimai2_export_<name>.json`.
3. Buka bagian AquaDX di Party dan pilih berkas JSON. Gunakan label akun yang sama dan nama server yang diisi secara terpisah untuk pembaruan selanjutnya.

Ekspor bawaan maimai DX memuat PB dan catatan permainan yang tersimpan, tetapi belum tentu mencakup seluruh riwayat. Fork dapat berbeda. Utamakan berkas ini daripada **Export in Batch Manual (for Tachi)**, yang menggunakan metode terpisah di bawah dan kehilangan identitas permainan bawaan. Dump SQL dan cadangan semua game tidak didukung; Anda tidak perlu membuka akses server privat untuk Party.

<a id="tachi"></a>

## Berkas pertukaran Tachi BATCH-MANUAL

1. Gunakan alat yang secara eksplisit mengekspor BATCH-MANUAL, seperti **Export in Batch Manual (for Tachi)** di AquaNet.
2. Buka Kamaitachi di Party dan pilih **Unggah BATCH-MANUAL**. Pilih JSON yang belum diubah. Gunakan label akun dan server yang sama pada impor berikutnya.
3. Tinjau pengamatan skor sebelum mengimpor.

Ini adalah format pertukaran, bukan cadangan akun bawaan Kamaitachi. Hanya maimai DX (`maimaidx`, Single) yang didukung. Catatannya tidak memiliki identitas permainan yang stabil dan tidak membentuk snapshot PB, sehingga **tidak menambahkan PB maupun jumlah permainan**, meskipun memuat waktu.

<a id="file-exports"></a>

## Identitas berkas dan batasan

Formulir berkas meminta label akun sumber dan wilayah game; berkas server privat juga memerlukan nama server secara terpisah. Semua itu adalah label identitas lokal, bukan kredensial masuk. Gunakan kembali label yang sama untuk pembaruan selanjutnya. Jangan masukkan kata sandi, token, atau URL server. Berkas diproses di browser ini; skor tidak ditambahkan ke tautan yang dibagikan atau analitik.

Penyedia, wilayah, dan server privat yang berbeda tetap menjadi pemain terpisah. Identitas OAuth juga tetap terpisah dari identitas berkas yang diberi label secara manual. Mengimpor pemain lain mengganti profil. Impor sebagian mempertahankan PB yang tidak disertakan dalam berkas baru. Catatan permainan eksplisit dari sumber hanya dapat menambah riwayat jika memiliki identitas peristiwa yang stabil; zona waktu yang tidak diketahui tetap dianggap tidak diketahui.

Pencocokan chart yang persis dan unik menggunakan lagu, artis, format STD/DX, dan tingkat kesulitan, beserta metadata sumber jika tersedia. Catatan yang ambigu atau tidak cocok tetap disimpan tanpa dihubungkan ke chart hasil tebakan. Catatan Utage yang tidak didukung ditampilkan dalam pratinjau. Nilai yang tidak diketahui tetap dianggap tidak diketahui.

Tanpa waktu snapshot sumber yang dapat digunakan, Party memakai tanggal berkas untuk mengurutkan snapshot PB. **Ekspor lama yang disimpan sebagai berkas baru dapat menggantikan PB yang lebih baru.** Periksa berkas dan pratinjau sebelum menerima. Tanggal snapshot maupun tanggal berkas tidak menciptakan tanggal bermain atau sesi.
