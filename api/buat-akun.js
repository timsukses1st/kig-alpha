/* ===================================================================
   POST /api/buat-akun  —  membuat akun login dengan sandi sementara
   -------------------------------------------------------------------
   Pola yang sama dengan Alpha: super admin mengisi email + nama + sandi
   sementara, akunnya langsung jadi, orangnya ganti sandi sendiri nanti.
   Tanpa email undangan, tanpa magic link, tanpa menunggu apa pun.

   KENAPA HARUS DI SERVER, BUKAN DI BROWSER
   Membuat akun login butuh service_role — kunci yang bisa melakukan apa
   saja di seluruh database TANPA dijaga RLS. Kalau kunci itu ditaruh di
   dashboard, siapa pun yang membuka halamannya bisa membacanya lewat
   View Source. Jadi kunci itu hanya hidup di sini, sebagai Environment
   Variable di Vercel, dan tidak pernah dikirim ke browser.

   SEBERAPA BESAR KUASANYA DI SINI — sengaja dipersempit:
   service_role dipakai HANYA untuk satu hal, yaitu membuat baris di
   auth.users. Penetapan peran dan pengaktifan akun TIDAK memakainya;
   keduanya lewat fungsi ubah_peran() dan ubah_aktif_pengguna() yang sudah
   ada, dipanggil memakai token super admin itu sendiri. Jadi seluruh
   pengamannya tetap berlaku: pemeriksaan peran() = 'super', larangan
   menurunkan super admin aktif terakhir, kewajiban menautkan agen, dan
   pencatatan audit atas nama orang yang menekan tombolnya.

   ENV YANG WAJIB ADA DI VERCEL (Settings -> Environment Variables):
     SUPABASE_URL                contoh: https://xumbqiezefdkgertjkjv.supabase.co
     SUPABASE_SERVICE_ROLE_KEY   Supabase -> Settings -> API -> service_role
   Jangan pernah menaruh service_role di berkas yang ikut masuk Git.
   =================================================================== */

const PERAN_SAH = ['super', 'owner', 'admin', 'agen', 'boarding', 'menunggu'];

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

  /* ---- 1. Token pemanggil ---- */
  const bearer = String(req.headers.authorization || '');
  const token  = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  if (!token) return res.status(401).json({ pesan: 'Belum masuk.' });

  /* ---- 2. Pemanggil benar-benar super admin? ----
     peran() dibaca dengan token PEMANGGIL, bukan service_role, jadi yang
     dinilai adalah dirinya sendiri — bukan klaim dari browser. */
  let peran;
  try {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/peran`, {
      method: 'POST',
      headers: {
        apikey: KUNCI,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!r.ok) return res.status(401).json({ pesan: 'Sesi tidak sah atau sudah kedaluwarsa.' });
    peran = await r.json();
  } catch {
    return res.status(502).json({ pesan: 'Gagal menghubungi database.' });
  }
  if (peran !== 'super') {
    return res.status(403).json({ pesan: 'Hanya Super Admin yang boleh membuat akun.' });
  }

  /* ---- 3. Masukan ---- */
  const body   = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const email  = String(body.email || '').trim().toLowerCase();
  const nama   = String(body.nama  || '').trim();
  const sandi  = String(body.sandi || '');
  const target = String(body.peran || 'menunggu');
  const agenId = body.agen_id ? String(body.agen_id) : null;

  if (!nama)  return res.status(400).json({ pesan: 'Nama lengkap belum diisi.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ pesan: 'Alamat email belum benar.' });
  if (sandi.length < 8)
    return res.status(400).json({ pesan: 'Sandi sementara minimal 8 karakter.' });
  if (!PERAN_SAH.includes(target))
    return res.status(400).json({ pesan: `Peran "${target}" tidak dikenal.` });
  if (target === 'agen' && !agenId)
    return res.status(400).json({ pesan: 'Peran agen wajib ditautkan ke satu data agen.' });

  /* ---- 4. Buat akun (satu-satunya pemakaian service_role) ----
     email_confirm: true -> tidak ada email konfirmasi, tidak ada magic link,
     orangnya bisa langsung masuk dengan sandi sementara ini. */
  let uid;
  try {
    const r = await fetch(`${URL_SB}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: KUNCI,
        Authorization: `Bearer ${KUNCI}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: sandi,
        email_confirm: true,
        user_metadata: { nama },
      }),
    });
    const hasil = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* Pesan Supabase diteruskan apa adanya: "already been registered",
         "Password is known to be weak", dsb. lebih berguna daripada
         "terjadi kesalahan". */
      return res.status(r.status === 422 ? 400 : r.status).json({
        pesan: hasil.msg || hasil.message || hasil.error_description
               || 'Gagal membuat akun di Supabase Auth.' });
    }
    uid = hasil.id;
    if (!uid) return res.status(502).json({ pesan: 'Supabase tidak mengembalikan id akun.' });
  } catch {
    return res.status(502).json({ pesan: 'Gagal menghubungi Supabase Auth.' });
  }

  /* ---- 5. Peran & status: lewat RPC yang sudah ada, pakai token super admin.
     Bukan service_role — supaya semua penjagaan dan audit tetap berlaku. */
  const rpc = async (nama_fn, isi) => {
    const r = await fetch(`${URL_SB}/rest/v1/rpc/${nama_fn}`, {
      method: 'POST',
      headers: {
        apikey: KUNCI,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isi),
    });
    if (r.ok) return null;
    const e = await r.json().catch(() => ({}));
    return e.message || e.hint || `Gagal memanggil ${nama_fn}.`;
  };

  /* Trigger on_auth_user_created sudah membuat profilnya dengan peran
     'menunggu' dan aktif=false. Kalau super admin memang memilih 'menunggu',
     tidak ada yang perlu diubah. */
  if (target !== 'menunggu') {
    const e1 = await rpc('ubah_peran',
      { p_user: uid, p_peran: target, p_agen: agenId });
    if (e1) return res.status(200).json({
      uid, email,
      pesan: `Akun ${email} berhasil dibuat, tapi perannya belum sempat diatur: ${e1} `
           + 'Atur perannya langsung dari tabel Pengguna.',
      sebagian: true });

    const e2 = await rpc('ubah_aktif_pengguna', { p_user: uid, p_aktif: true });
    if (e2) return res.status(200).json({
      uid, email,
      pesan: `Akun ${email} dibuat dan perannya diatur, tapi belum sempat diaktifkan: ${e2} `
           + 'Aktifkan dari kolom Status di tabel Pengguna.',
      sebagian: true });
  }

  return res.status(200).json({ uid, email, peran: target, sebagian: false });
}

function safeJson(t) { try { return JSON.parse(t); } catch { return {}; } }
