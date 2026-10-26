# Cara mengganti gambar halaman pemesanan

## Keadaan sekarang (26 Okt 2026)

Kelima tempat foto **sudah terisi** dengan foto kiriman Mas Dik, dan semuanya
sudah dikecilkan dari aslinya:

| Berkas | Asli | Sesudah dikecilkan | Hemat |
|---|---|---|---|
| `hero.jpg` | 3,39 MB · 2752×1536 | 289 KB · 1600×893 | 91,7% |
| `paket-cruise-daily.jpg` | 3,85 MB · 2752×1536 | 115 KB · 900×502 | 97,1% |
| `paket-cruise-promo.jpg` | 4,29 MB · 2816×1536 | 116 KB · 900×491 | 97,3% |
| `paket-1-day-journey.jpg` | 3,36 MB · 2816×1536 | 81 KB · 900×491 | 97,6% |
| `paket-2-day-journey.jpg` | — | 81 KB · **salinan dari 1 Day** | — |

Total folder ini sekarang **695 KB**, dari 15,4 MB bahan aslinya.

> **1 Day dan 2 Day memakai foto yang sama persis.** Di halaman, dua kartunya
> bersebelahan, jadi kembarannya kelihatan jelas. Kalau nanti ada foto khusus
> 2 Day, tinggal timpa `paket-2-day-journey.jpg`.

Cara mengecilkannya: lebar diturunkan dulu, baru kualitasnya — bukan
sebaliknya. Foto-foto ini isinya langit dan air bergradasi halus, dan kalau
kualitas JPEG diturunkan terlalu jauh, gradasi itulah yang pertama rusak
(muncul garis-garis bertingkat). Lebar lebih kecil dengan kualitas tinggi
hasilnya lebih enak dilihat daripada lebar besar dengan kualitas rendah.

Gambar cadangan `ph-*.svg` **tetap disimpan** (total 10 KB). Itu bukan sisa:
kalau suatu saat berkas fotonya hilang, salah nama, atau gagal dimuat,
halaman otomatis jatuh ke gambar cadangan — bukan ke kotak kosong atau ikon
gambar rusak.

## Nama berkas yang dicari halaman

| Nama berkas            | Dipakai di mana                          | Ukuran disarankan |
|------------------------|------------------------------------------|-------------------|
| `hero.jpg`             | Gambar besar paling atas                 | 1920 × 1080       |
| `paket-cruise-daily.jpg` | Kartu paket Cruise Daily               | 800 × 520         |
| `paket-cruise-promo.jpg` | Kartu paket Cruise PROMO               | 800 × 520         |
| `paket-1-day-journey.jpg` | Kartu paket 1 Day Journey             | 800 × 520         |
| `paket-2-day-journey.jpg` | Kartu paket 2 Day Journey             | 800 × 520         |

Nama kartu paket mengikuti **slug produk** di database, bukan nama tampilannya.
Jadi kalau nanti ada paket baru dengan slug `sunset-trip`, nama berkasnya
`paket-sunset-trip.jpg`. Selama berkasnya belum ada, paket itu memakai gambar
cadangan umum.

## Soal ukuran berkas — ini penting

Halaman ini sering dibuka pakai data seluler di dermaga. Foto 4 MB langsung
dari kamera HP akan terasa sangat lambat dan **memakan kuota pelanggan**.

Sebelum diunggah, kecilkan dulu:

- Hero: lebar maksimal 1920 px, **usahakan di bawah 300 KB**
- Kartu paket: lebar maksimal 800 px, **usahakan di bawah 120 KB**

Alat gratis yang bisa dipakai: [squoosh.app](https://squoosh.app) (pilih
MozJPEG, kualitas 70–75) atau [tinypng.com](https://tinypng.com). Keduanya
jalan di browser, tidak perlu pasang apa-apa, dan tidak ada biaya.

Kalau punya versi `.webp`, itu lebih kecil lagi dengan kualitas sama — tapi
namanya harus tetap `.jpg` atau kodenya ikut diubah. Bilang saja kalau mau
dipasang `.webp`.

## Foto seperti apa yang cocok

- **Hero**: kapal sedang berlayar, diambil agak jauh, langit kelihatan banyak.
  Bagian kiri atas foto sebaiknya tidak ramai — di situ tulisan judulnya jatuh.
- **Kartu paket**: satu objek jelas (pantai, tebing, kapal), jangan foto rame
  yang detailnya hilang waktu dikecilkan jadi kartu kecil.
- Hindari foto yang ada wajah penumpang terlihat jelas tanpa izin mereka.

## Setelah foto ditaruh

1. Unggah folder `img/` ke GitHub bersama berkas lainnya
2. Vercel → Redeploy
3. Buka halaman, tekan Ctrl+Shift+R (muat ulang paksa) — browser kadang masih
   menyimpan gambar lama
