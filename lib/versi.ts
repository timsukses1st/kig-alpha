/**
 * Penanda versi build Alpha.
 *
 * Kenapa file ini ada
 * -------------------
 * Kalau build Vercel GAGAL, Vercel tidak menurunkan situsnya. Dia tetap
 * menyajikan deployment hijau yang terakhir berhasil. Akibatnya situs terbuka
 * normal, login jalan, datanya benar, semua layar hidup — dan satu-satunya
 * gejala adalah "fitur barunya kok belum ada". Tanpa penanda, tidak ada cara
 * membedakan "fiturnya belum jadi" dari "buildnya merah, yang tampil masih
 * versi lama".
 *
 * Nomor di bawah ini ikut terbawa ke dalam bundel JavaScript. Jadi angka yang
 * tampil di kaki sidebar adalah angka dari build yang SEDANG DISAJIKAN —
 * bukan angka dari commit terakhir di GitHub.
 *
 * Aturannya cuma satu: setiap kali ada berkas dikirim untuk di-deploy,
 * VERSI di sini WAJIB dinaikkan dan nomornya disebut waktu berkasnya dikirim.
 * Setelah deploy: hard refresh (Ctrl+Shift+R), lihat kiri-bawah, bandingkan.
 * Sama = deploy masuk. Beda = buka Vercel → Deployments → cek Build Logs.
 *
 * Pola ini sudah dipakai di kig-loka sejak 17 September 2026. Di Alpha
 * nomornya mulai dari v1 karena penandanya baru dipasang 28 September —
 * jangan dibandingkan dengan nomor Loka, dua repo itu punya deret sendiri.
 */

/** Nomor build. WAJIB naik setiap kirim berkas untuk deploy. */
export const VERSI = 'v5';

/** Tanggal build ini disiapkan. Ditampilkan di samping nomor. */
export const VERSI_TANGGAL = '26 Oktober 2026';

/**
 * Isi build ini — muncul sebagai tooltip saat kursor diarahkan ke nomornya.
 * Ditulis singkat, satu baris per perubahan, supaya kalau ada yang bertanya
 * "ini versi yang mana?" jawabannya bisa dibaca langsung dari layar.
 */
export const VERSI_ISI = [
  'Budget: daftar bisa dikelompokkan per bulan atau per project',
  'Budget: kolom Tanggal pengajuan, boleh dimundurkan',
  'Budget: penyaring periode dan angka ringkasan ikut tanggal pengajuan',
  'Lembur: daftar pengajuan dikelompokkan per bulan, bisa dilipat',
  'Lembur: Rekap Jam disaring per bulan dan disusun jadi kartu',
];
