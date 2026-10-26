/* ===================================================================
   POST /api/hapus-akun  —  menghapus akun login secara permanen
   -------------------------------------------------------------------
   Pasangan dari /api/buat-akun. Sama seperti Alpha: super admin bisa
   menghapus akun orang dari dashboard, bukan cuma menonaktifkan.

   APA YANG IKUT TERHAPUS, DAN APA YANG TIDAK
   profil.id menunjuk auth.users dengan ON DELETE CASCADE, jadi baris
   profilnya ikut hilang. Semua rujukan LAIN ke profil memakai
   ON DELETE SET NULL, jadi pekerjaannya TIDAK ikut terhapus:
     audit.aktor, pesanan.fu_oleh, penumpang.naik_oleh,
     pembayaran.diverifikasi_oleh, komisi.dikunci_oleh
   Yang hilang adalah TAUTAN ke orangnya, bukan barisnya. Untuk audit,
   nama pelakunya tetap tersimpan di kolom teks audit.aktor_nama, jadi
   riwayat "siapa melakukan apa" tetap terbaca. Tapi untuk boarding dan
   verifikasi pembayaran, "dicentang oleh siapa" memang jadi kosong.
   Karena itu menonaktifkan tetap jalan yang dianjurkan; menghapus untuk
   akun yang memang salah dibuat.

   PENJAGAAN DI SINI (tidak boleh hanya di browser):
     - pemanggil wajib super admin, dinilai lewat peran() memakai
       token pemanggil sendiri
     - tidak bisa menghapus akun sendiri
     - tidak bisa menghapus super admin aktif terakhir
     - email yang dikirim browser harus cocok dengan email akun yang
       dituju; kalau tidak cocok, permintaan ditolak
   service_role dipakai HANYA untuk perintah hapus di Auth.
   =================================================================== */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ pesan: 'Metode tidak diizinkan.' });
  }

  const URL_SB = process.env.SUPABASE_URL;
  const KUNCI  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_SB || !KUNCI) {
    /* Pesan diagnostik, bukan sekadar "belum dikonfigurasi". Versi pertama cuma
       menyebut dua nama variabel, jadi orang harus menebak antara: belum
       ditambahkan / salah ketik / salah environment / belum redeploy. Di sini
       disebutkan mana yang kurang DAN nama variabel SUPABASE apa saja yang
       benar-benar terbaca server — itu langsung membedakan salah ketik dari
       belum redeploy. Hanya NAMA yang ditampilkan, tidak pernah nilainya. */
    const kurang = [
      !URL_SB && 'SUPABASE_URL',
      !KUNCI  && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter(Boolean);
    /* Saringannya SENGAJA longgar. Versi pertama mencari kata 'SUPABASE' persis,
       dan justru meleset pada kasus yang paling butuh: salah ketik seperti
       SUPABSE_URL tidak mengandung 'SUPABASE', jadi tidak ikut dilaporkan dan
       orangnya tetap tidak tahu apa yang salah. Ditemukan oleh uji, bukan
       oleh tebakan. */
    const terbaca = Object.keys(process.env)
      .filter(k => /SUP|SERVICE_ROLE|ROLE_KEY/i.test(k)).sort();
    /* Tiga sebab yang berbeda, dan dulu ketiganya kutumpuk jadi satu pesan.
       Yang membedakan: apakah NAMA yang kurang itu sendiri ada di daftar.
         ada di daftar  -> variabelnya tersimpan tapi NILAINYA kosong
         tidak ada, tapi ada nama mirip -> salah ketik
         tidak ada apa pun -> belum tersimpan / salah environment / belum redeploy */
    const kosong = kurang.filter(k => terbaca.includes(k));
    const sebab = kosong.length
      ? `Variabel ${kosong.join(' dan ')} TERSIMPAN tapi nilainya kosong. `
        + 'Buka Environment Variables di Vercel, isi nilainya, lalu Redeploy.'
      : terbaca.length
        ? `Yang terbaca server sekarang: ${terbaca.join(', ')}. `
          + 'Kalau ada nama di daftar itu yang mirip tapi beda walau satu huruf, '
          + 'itu salah ketik — perbaiki namanya, lalu Redeploy.'
        : 'Server tidak membaca satu pun variabel yang namanya mirip. Berarti '
          + 'variabelnya belum tersimpan, tercentang untuk environment yang salah '
          + '(Production harus ikut), atau deployment ini dibuat sebelum variabelnya '
          + 'ditambahkan — tekan Redeploy di Vercel.';
    return res.status(500).json({
      pesan: `Server belum dikonfigurasi. Yang belum terbaca: ${kurang.join(' dan ')}. ${sebab}`,
      kurang, terbaca, kosong });
  }

  const bearer = String(req.headers.authorization || '');
  const token  = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  if (!token) return res.status(401).json({ pesan: 'Belum masuk.' });

  const body   = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const uid    = String(body.uid || '').trim();
  const email  = String(body.email || '').trim().toLowerCase();
  if (!uid)   return res.status(400).json({ pesan: 'Akun yang mau dihapus tidak disebutkan.' });
  if (!email) return res.status(400).json({ pesan: 'Email konfirmasi belum diisi.' });

  const kepala = (pakaiKunci) => ({
    apikey: KUNCI,
    Authorization: `Bearer ${pakaiKunci ? KUNCI : token}`,
    'Content-Type': 'application/json',
  });

  /* ---- 1. Pemanggil benar-benar super admin? ---- */
  let peran, uidPemanggil;
  try {
    const [rP, rU] = await Promise.all([
      fetch(`${URL_SB}/rest/v1/rpc/peran`,  { method:'POST', headers: kepala(false), body:'{}' }),
      fetch(`${URL_SB}/auth/v1/user`,       { headers: kepala(false) }),
    ]);
    if (!rP.ok || !rU.ok)
      return res.status(401).json({ pesan: 'Sesi tidak sah atau sudah kedaluwarsa.' });
    peran = await rP.json();
    uidPemanggil = (await rU.json())?.id;
  } catch {
    return res.status(502).json({ pesan: 'Gagal menghubungi database.' });
  }
  if (peran !== 'super')
    return res.status(403).json({ pesan: 'Hanya Super Admin yang boleh menghapus akun.' });

  /* ---- 2. Tidak boleh menghapus diri sendiri ----
     Kalau ini dibiarkan, super admin bisa menghapus dirinya di tengah jalan
     dan sesinya jadi menggantung tanpa profil. */
  if (uid === uidPemanggil)
    return res.status(400).json({ pesan:
      'Tidak bisa menghapus akun Anda sendiri. Minta Super Admin lain melakukannya.' });

  /* ---- 3. Ambil data akun yang dituju, dari sumber yang tepercaya ----
     daftar_pengguna() adalah SECURITY DEFINER yang sudah memeriksa peran()
     sendiri, jadi aman dipanggil dengan token pemanggil. */
  let daftar;
  try {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/daftar_pengguna`,
      { method:'POST', headers: kepala(false), body:'{}' });
    if (!r.ok) return res.status(502).json({ pesan: 'Gagal membaca daftar pengguna.' });
    daftar = await r.json();
  } catch {
    return res.status(502).json({ pesan: 'Gagal membaca daftar pengguna.' });
  }
  const target = (Array.isArray(daftar) ? daftar : []).find(u => u.id === uid);
  if (!target) return res.status(404).json({ pesan: 'Akun tidak ditemukan.' });

  /* ---- 4. Email yang diketik harus cocok ----
     Ini pagar terakhir terhadap salah klik baris. Browser boleh saja salah,
     tapi server yang memastikan yang dihapus memang yang dimaksud. */
  if (String(target.email || '').toLowerCase() !== email)
    return res.status(400).json({ pesan:
      'Email konfirmasi tidak cocok dengan akun yang dipilih. Tidak ada yang dihapus.' });

  /* ---- 5. Jangan sampai tidak ada super admin aktif tersisa ---- */
  if (target.peran === 'super' && target.aktif) {
    const sisa = (Array.isArray(daftar) ? daftar : [])
      .filter(u => u.peran === 'super' && u.aktif && u.id !== uid).length;
    if (sisa === 0)
      return res.status(400).json({ pesan:
        'Ini Super Admin aktif terakhir. Angkat Super Admin lain dulu sebelum menghapusnya.' });
  }

  /* ---- 6. Catat dulu, baru hapus ----
     Dicatat SEBELUM penghapusan karena sesudahnya namanya sudah tidak bisa
     dibaca lagi dari profil. aktor_nama berupa teks, jadi tetap terbaca
     walau tautan aktor-nya nanti jadi NULL. */
  try {
    await fetch(`${URL_SB}/rest/v1/audit`, {
      method: 'POST',
      headers: { ...kepala(false), Prefer: 'return=minimal' },
      body: JSON.stringify({
        aksi: 'pengguna.hapus',
        objek: 'pengguna:' + uid,
        dari: target.peran,
        ke: null,
        meta: { nama: target.nama, email: target.email, aktif: target.aktif },
      }),
    });
  } catch { /* audit gagal tidak boleh membatalkan penghapusan yang diminta */ }

  /* ---- 7. Hapus (satu-satunya pemakaian service_role) ----
     profil ikut terhapus lewat ON DELETE CASCADE. */
  try {
    const r = await fetch(`${URL_SB}/auth/v1/admin/users/${encodeURIComponent(uid)}`,
      { method: 'DELETE', headers: kepala(true) });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(r.status).json({
        pesan: e.msg || e.message || 'Gagal menghapus akun di Supabase Auth.' });
    }
  } catch {
    return res.status(502).json({ pesan: 'Gagal menghubungi Supabase Auth.' });
  }

  return res.status(200).json({
    uid, email: target.email, nama: target.nama, terhapus: true });
}

function safeJson(t) { try { return JSON.parse(t); } catch { return {}; } }
