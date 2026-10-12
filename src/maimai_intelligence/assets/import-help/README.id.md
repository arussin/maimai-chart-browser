# Impor data pemain

Buka **Impor data pemain**, buka bagian layanan yang Anda gunakan, lalu pilih **Metode impor** di dalamnya. Ikuti langkah-langkah di bawah dan periksa pemain, wilayah, skor terbaik pribadi (PB), chart yang tidak cocok, serta catatan yang dikecualikan sebelum mengimpor. Pilihan ingat menyimpan data di perangkat ini; impor sekali menyimpannya hanya dalam tab ini.

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
2. Buka bagian Maishift di Party, pilih **Profil publik**, lalu masukkan nama pengguna publik atau URL profil. Pemain tidak perlu memberikan kata sandi atau melakukan pengaturan pengembang.
3. Baca profil, periksa wilayah dan pratinjau PB, lalu impor.

Catatan Jepang dan Internasional tetap terpisah. URL yang memuat `@jp`, `@intl`, atau `@na` memilih kumpulan catatan tersebut; Amerika Utara menggunakan catatan Internasional dengan ketersediaan chart yang berbeda. Nama pengguna tanpa URL memulai permintaan pada wilayah Internasional dan menggunakan wilayah yang dikembalikan Maishift. Jika keduanya tersedia, tempel URL `@jp` untuk memilih Jepang. Bahasa tampilan tidak memilih wilayah, dan pembaruan koneksi yang diingat tetap menggunakan wilayah yang dipilih.

Metode ini mengimpor PB chart yang sudah dimainkan, bukan riwayat bermain. Tidak ada metode impor cadangan berkas bawaan Maishift yang didukung. Berkas pemain Session Report/Party yang sudah ada menggunakan bagian layanan terpisah di atas.

<a id="kamaitachi"></a>

## Kamaitachi

1. Gunakan profil maimai DX Kamaitachi yang sudah berisi skor. Jika hasil terbaru belum ada, perbarui Kamaitachi melalui [halaman impornya](https://kamai.tachi.ac/import) terlebih dahulu. Party tidak membuat akun Kamaitachi atau mengunggah skor arcade.
2. Buka Kamaitachi di Party dan pilih **Impor dengan nama pengguna**. Masukkan nama pengguna, ID pengguna numerik, atau URL profil seperti `https://kamai.tachi.ac/u/username`.
3. Periksa pemain yang ditemukan dan pratinjau PB dengan saksama: pencarian data publik tidak memverifikasi kepemilikan akun. Impor sekali atau ingat profil untuk pembaruan berikutnya.

Party membaca API publik Kamaitachi tanpa kata sandi atau kunci API. Metode ini mengimpor PB maimai DX yang tersimpan, termasuk chart STD dan DX; game maimai lama yang terpisah serta seluruh riwayat bermain tidak diimpor. ID akun numerik membedakan akun yang berganti nama dari pemain lain. Identitas Session Report lama yang memakai nama pengguna tetap terpisah.

Jika pemain ditemukan tetapi belum memiliki skor maimai DX, tambahkan skor ke Kamaitachi terlebih dahulu, lalu coba lagi. Pembaruan di Party membaca data yang sudah ada di Kamaitachi. Waktu pengambilan bukan waktu bermain terakhir atau waktu sinkronisasi di layanan asal.

<a id="diving-fish"></a>

## Diving-Fish / 水鱼查分器

Koneksi ini mengimpor skor wilayah Tiongkok yang sudah tersimpan di Diving-Fish. Layar masuk, pengaturan profil, dan panduan penyiapannya saat ini berbahasa Mandarin.

1. Buka [Diving-Fish](https://maimai.diving-fish.com/), masuk, setujui ketentuan layanan pencatat skornya, dan pastikan skor Anda terlihat di sana.
2. Jika baru menggunakan Fish, daftar dan selesaikan verifikasi email ketika diminta, lalu ikuti [panduan impor skor](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/). Membuat akun tidak menambahkan skor arcade. Selesaikan impor ke Fish sebelum kembali ke Party.
3. Di **编辑个人资料** (Edit profil) milik Fish, nonaktifkan **对非网页查询的成绩使用掩码** (penyamaran skor untuk permintaan di luar situs web) agar skor tetap tepat. Party tidak dapat memverifikasi pengaturan ini. Anda boleh tetap mengaktifkan **禁止公开接口使用我的成绩（授权不受影响）**: pembatasan kueri publik tidak menghalangi koneksi yang telah Anda izinkan.
4. Buka Diving-Fish di Party dan pilih **Hubungkan langsung**. Konfirmasikan bahwa penyamaran skor telah dinonaktifkan, lalu hubungkan akun. Masuk dan berikan izin baca profil serta skor di `auth.diving-fish.com`.
5. Kembali ke Party, periksa pemain yang ditemukan, jumlah PB, serta chart yang tidak cocok sebelum mengimpor sekali atau mengingat koneksi.

Jika Fish belum memiliki skor, perbarui Fish terlebih dahulu. Jika Party meminta persetujuan ketentuan layanan pencatat skor, buka Fish, setujui ketentuannya, dan periksa skor Anda. Koneksi yang diingat kemudian dapat mencoba pembaruan lagi. Impor pertama yang gagal menghapus koneksi yang belum dikonfirmasi; hubungkan kembali setelah penyiapan selesai.

Pembaruan membaca PB yang tersimpan di Fish; pembaruan tidak memasukkan hasil arcade baru ke Fish atau membuat riwayat bermain. Waktu pengambilan menunjukkan kapan Party membaca Fish, bukan kapan Anda terakhir bermain. Pembacaan yang gagal atau kosong tetap mempertahankan data tersimpan, termasuk PB yang tidak muncul dalam respons baru. Chart yang tidak cocok tetap disimpan tanpa menebak identitasnya.

Untuk menghentikan akses berikutnya, putuskan koneksi di Party. Anda juga dapat mencabut izin Party melalui [aplikasi yang diizinkan di Fish](https://auth.diving-fish.com/apps). Jika izin kedaluwarsa atau dicabut, hubungkan kembali. Skor yang sudah tersimpan di browser ini dapat dihapus secara terpisah di Party.

<a id="lxns"></a>

## LXNS / 落雪咖啡屋

Gunakan koneksi ini untuk skor maimai DX wilayah Tiongkok yang sudah terhubung ke akun LXNS Anda. Panduan pengaturan LXNS tersedia dalam bahasa Mandarin.

1. Masuk ke [LXNS](https://maimai.lxns.net/) dan periksa skor Anda. Jika belum ada, ikuti [panduan sinkronisasi data permainan](https://maimai.lxns.net/docs/sync) dahulu. Membuat akun saja tidak menambahkan skor; sinkronisasi daring pertama menghubungkan data permainan ke akun.
2. Di Party, buka LXNS, pilih **Hubungkan langsung**, lalu **Hubungkan LXNS**. Masuk di `maimai.lxns.net` dan izinkan akses baca saja. Pemain tidak perlu mendaftarkan aplikasi pengembang atau menyediakan kunci API pribadi.
3. Kembali ke Party dan periksa pemain, wilayah Tiongkok, jumlah PB, serta chart yang tidak cocok. Impor sekali atau ingat koneksi untuk pembaruan berikutnya.

Yang diimpor adalah PB tersimpan, bukan riwayat permainan. Pembaruan hanya membaca LXNS lagi, tanpa memulai sinkronisasi skor arcade. Hasil kosong atau kegagalan membaca tidak menghapus data tersimpan. Jika tidak ada skor yang dapat diimpor, sinkronkan ke LXNS dahulu. Kegagalan impor pertama membuang koneksi yang belum dikonfirmasi; hubungkan kembali setelah pengaturan selesai.

Putuskan koneksi di Party untuk menghapus izin yang disimpannya. Sesuai [panduan izin akses](https://maimai.lxns.net/docs/mcp), Anda juga dapat mencabut izin Party pada **第三方应用** (aplikasi pihak ketiga) di profil LXNS. Skor yang sudah tersimpan di browser dapat dihapus secara terpisah di Party.
