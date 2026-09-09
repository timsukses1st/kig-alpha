'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, PILLAR_LABEL, type DistributionLog, type Pillar, type Profile, type Project } from '@/lib/types';

interface Props {
  profile: Profile | null;
  projects: Project[];
  projectFilter: string;
}

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook', color: '#4267B2' },
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
  { key: 'telegram', label: 'Telegram', color: '#0088cc' },
];
const platMeta = (k: string) => PLATFORMS.find((p) => p.key === k) || { label: k, color: 'var(--text-3)' };
/** Urutan platform di dalam satu tanggal — tetap, tidak ikut jumlah laporan,
 *  supaya letaknya tidak berpindah tiap kali ada laporan baru masuk. */
const urutPlat = (k: string) => {
  const i = PLATFORMS.findIndex((p) => p.key === k);
  return i === -1 ? 99 : i;
};

// hitung SHA-256 file -> hex (untuk deteksi duplikat)
async function fileHash(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_MB = 10;

/** Rentang yang ditarik dari database. Bukan cuma soal enak dibaca — inilah
 *  yang menahan layar ini tetap ringan waktu isinya sudah puluhan ribu baris. */
const RENTANG = [
  { key: '30', label: '30 hari terakhir', hari: 30 },
  { key: '90', label: '90 hari terakhir', hari: 90 },
  { key: 'all', label: 'Semua waktu', hari: 0 },
];

interface RingkasBaris {
  tanggal: string;
  platform: string;
  content_category: string;
  laporan: number;
  grup: number;
}
interface RekapOrang {
  reporter_id: string | null;
  reporter_name: string | null;
  laporan: number;
  grup: number;
}

export default function SebaranView({ profile, projects, projectFilter }: Props) {
  /**
   * Layar ini TIDAK lagi menarik seluruh baris `distribution_logs`.
   *
   * Yang ditarik cuma ringkasannya (tanggal × platform × kategori + hitungan)
   * lewat fungsi `sebaran_ringkas`. Barisnya sendiri baru diambil saat sebuah
   * tanggal dibuka, dan hanya untuk tanggal itu. Satu hari bisa ratusan
   * laporan begitu semua project jalan — menarik semuanya di depan cuma untuk
   * digambar sebagai daftar panjang itu mubazir, dan makin lama makin berat.
   */
  const [ringkas, setRingkas] = useState<RingkasBaris[]>([]);
  const [rekap, setRekap] = useState<RekapOrang[]>([]);
  const [loading, setLoading] = useState(true);
  const [rentang, setRentang] = useState('30');
  const [scope, setScope] = useState<'saya' | 'tim'>('saya');
  const [platFilter, setPlatFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');

  /** Tanggal & platform yang sedang dibuka. Semua tertutup saat layar dibuka. */
  const [bukaTgl, setBukaTgl] = useState<Record<string, boolean>>({});
  const [bukaPlat, setBukaPlat] = useState<Record<string, boolean>>({});
  /** Baris per tanggal, diambil sekali lalu dipakai ulang oleh semua platform
   *  di tanggal itu — bukan sekali per platform. */
  const [barisTgl, setBarisTgl] = useState<Record<string, DistributionLog[]>>({});
  const [muatTgl, setMuatTgl] = useState<Record<string, boolean>>({});

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const [form, setForm] = useState({ platform: 'whatsapp', content_category: 'lagi_ramai', group_names: '', content_url: '', note: '', project_id: '' });
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<DistributionLog | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const canSeeAll = profile?.role === 'manager' || profile?.role === 'superadmin';

  // --- notifikasi & konfirmasi in-app (window.confirm/alert diblokir di browser) ---
  const [toast, setToast] = useState('');
  const [confirmDel, setConfirmDel] = useState<DistributionLog | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Kunci tanggal versi WIB (UTC+7) — batas hari jam 00.00 WIB, bukan 07.00
  const wibKey = (iso: string) =>
    new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const todayKey = wibKey(new Date().toISOString());
  const kemarinKey = wibKey(new Date(Date.now() - 86400000).toISOString());

  const dariTanggal = useMemo(() => {
    const def = RENTANG.find((r) => r.key === rentang);
    if (!def || def.hari === 0) return null;
    return wibKey(new Date(Date.now() - (def.hari - 1) * 86400000).toISOString());
  }, [rentang]);

  /* ---------------- pengambilan data ---------------- */

  const muatRingkas = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const p = {
      p_project: projectFilter === 'all' ? null : projectFilter,
      p_hanya_saya: scope === 'saya',
      p_dari: dariTanggal,
      p_sampai: null,
    };
    const { data, error: err } = await supabase.rpc('sebaran_ringkas', p);
    if (!err) setRingkas((data as RingkasBaris[]) || []);
    if (!silent) setLoading(false);
  }, [projectFilter, scope, dariTanggal]);

  const muatRekap = useCallback(async () => {
    if (scope !== 'tim') { setRekap([]); return; }
    const { data, error: err } = await supabase.rpc('sebaran_rekap_orang', {
      p_project: projectFilter === 'all' ? null : projectFilter,
      p_dari: dariTanggal,
      p_sampai: null,
    });
    if (!err) setRekap((data as RekapOrang[]) || []);
  }, [projectFilter, scope, dariTanggal]);

  /** Batas hari versi WIB diterjemahkan ke UTC, karena `created_at` disimpan
   *  dalam UTC. `2026-09-09` WIB = 2026-09-08T17:00Z sampai 2026-09-09T17:00Z. */
  const batasHariUtc = (tgl: string) => {
    const awal = new Date(`${tgl}T00:00:00+07:00`);
    const akhir = new Date(awal.getTime() + 86400000);
    return { awal: awal.toISOString(), akhir: akhir.toISOString() };
  };

  const muatBarisTanggal = useCallback(async (tgl: string) => {
    setMuatTgl((m) => ({ ...m, [tgl]: true }));
    const { awal, akhir } = batasHariUtc(tgl);
    let q = supabase.from('distribution_logs').select('*')
      .gte('created_at', awal).lt('created_at', akhir)
      .order('created_at', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
    const { data } = await q;
    setBarisTgl((b) => ({ ...b, [tgl]: (data as DistributionLog[]) || [] }));
    setMuatTgl((m) => ({ ...m, [tgl]: false }));
  }, [projectFilter]);

  useEffect(() => { muatRingkas(); }, [muatRingkas]);
  useEffect(() => { muatRekap(); }, [muatRekap]);

  /**
   * Ganti project atau rentang = daftar tanggalnya berubah. Baris yang sudah
   * terlanjur diambil untuk project lama harus dibuang, bukan dipakai ulang.
   */
  useEffect(() => {
    setBarisTgl({});
    setBukaTgl({});
    setBukaPlat({});
  }, [projectFilter, rentang]);

  // --- REALTIME: laporan sebaran dari anggota lain ---
  const segarRef = useRef<() => void>(() => {});
  useEffect(() => {
    segarRef.current = () => {
      muatRingkas(true);
      muatRekap();
      // Tanggal yang sedang terbuka ikut ditarik ulang — kalau tidak, laporan
      // baru dari rekan hanya menambah angka di kepala folder tanpa munculkan
      // barisnya, dan itu terlihat seperti Alpha-nya salah hitung.
      Object.keys(bukaTgl).forEach((t) => { if (bukaTgl[t]) muatBarisTanggal(t); });
    };
  }, [muatRingkas, muatRekap, muatBarisTanggal, bukaTgl]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { segarRef.current(); }, 400);
    };
    const ch = supabase
      .channel('sebaran-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'distribution_logs' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  // Tutup modal detail otomatis kalau barisnya sudah dihapus orang lain.
  useEffect(() => {
    setDetail((cur) => {
      if (!cur) return cur;
      const kunci = wibKey(cur.created_at);
      const daftar = barisTgl[kunci];
      if (!daftar) return cur; // tanggalnya belum/tidak dimuat — biarkan
      return daftar.find((r) => r.id === cur.id) || null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barisTgl]);

  /* ---------------- susunan folder ---------------- */

  const ringkasTersaring = useMemo(
    () => ringkas.filter((r) =>
      (platFilter === 'all' || r.platform === platFilter)
      && (catFilter === 'all' || r.content_category === catFilter)),
    [ringkas, platFilter, catFilter],
  );

  interface FolderPlat { platform: string; laporan: number; grup: number }
  interface FolderTgl { tanggal: string; laporan: number; grup: number; plat: FolderPlat[] }

  const folder = useMemo<FolderTgl[]>(() => {
    const peta: Record<string, { laporan: number; grup: number; plat: Record<string, FolderPlat> }> = {};
    ringkasTersaring.forEach((r) => {
      if (!peta[r.tanggal]) peta[r.tanggal] = { laporan: 0, grup: 0, plat: {} };
      const d = peta[r.tanggal];
      d.laporan += r.laporan;
      d.grup += r.grup;
      if (!d.plat[r.platform]) d.plat[r.platform] = { platform: r.platform, laporan: 0, grup: 0 };
      d.plat[r.platform].laporan += r.laporan;
      d.plat[r.platform].grup += r.grup;
    });
    return Object.keys(peta).sort().reverse().map((tgl) => ({
      tanggal: tgl,
      laporan: peta[tgl].laporan,
      grup: peta[tgl].grup,
      plat: Object.keys(peta[tgl].plat)
        .map((k) => peta[tgl].plat[k])
        .sort((a, b) => urutPlat(a.platform) - urutPlat(b.platform)),
    }));
  }, [ringkasTersaring]);

  const totalLaporan = useMemo(() => folder.reduce((a, f) => a + f.laporan, 0), [folder]);

  const stats = useMemo(() => {
    const hariIni = folder.find((f) => f.tanggal === todayKey);
    return {
      todayCount: hariIni ? hariIni.laporan : 0,
      todayGroups: hariIni ? hariIni.grup : 0,
      totalGroups: folder.reduce((a, f) => a + f.grup, 0),
    };
  }, [folder, todayKey]);

  const adaYangTerbuka = useMemo(
    () => Object.keys(bukaTgl).some((k) => bukaTgl[k]),
    [bukaTgl],
  );

  const toggleTgl = (tgl: string) => {
    const nanti = !bukaTgl[tgl];
    setBukaTgl((b) => ({ ...b, [tgl]: nanti }));
    if (nanti && !barisTgl[tgl] && !muatTgl[tgl]) muatBarisTanggal(tgl);
    // Kalau tanggalnya cuma punya satu platform, platformnya ikut dibuka —
    // menyuruh orang mengklik dua kali untuk sesuatu yang tidak bercabang itu
    // cuma bikin kesal.
    if (nanti) {
      const f = folder.find((x) => x.tanggal === tgl);
      if (f && f.plat.length === 1) {
        setBukaPlat((b) => ({ ...b, [`${tgl}|${f.plat[0].platform}`]: true }));
      }
    }
  };

  const tutupSemua = () => { setBukaTgl({}); setBukaPlat({}); };

  /** Baris untuk satu kotak tanggal+platform, sudah lewat semua penyaring. */
  const barisUntuk = (tgl: string, platform: string): DistributionLog[] => {
    const semua = barisTgl[tgl] || [];
    return semua.filter((r) =>
      r.platform === platform
      && (scope === 'saya' ? r.reporter_id === profile?.id : true)
      && (catFilter === 'all' || (r.content_category || '') === catFilter));
  };

  /* ---------------- lapor / detail / hapus ---------------- */

  const openModal = () => {
    setForm({ platform: 'whatsapp', content_category: 'lagi_ramai', group_names: '', content_url: '', note: '', project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '') });
    setFile(null);
    setDupWarn(null);
    setError('');
    setOpen(true);
  };

  // saat pilih file: hitung hash & cek duplikat
  const onPickFile = async (f: File | null) => {
    setFile(f);
    setDupWarn(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { setError(`Bukti maksimal ${MAX_MB} MB.`); setFile(null); return; }
    try {
      const h = await fileHash(f);
      const { data } = await supabase.from('distribution_logs')
        .select('created_at, reporter_name').eq('proof_hash', h).limit(1);
      if (data && data.length) {
        const d = data[0] as { created_at: string; reporter_name: string | null };
        // Jam ikut ditampilkan: kalau fotonya diunggah dua kali di hari yang
        // sama, jam yang membedakan mana yang mana.
        const wd = new Date(d.created_at);
        const when =
          wd.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
          ' · ' +
          wd.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        setDupWarn(`⚠️ Foto ini identik dengan bukti yang sudah pernah diunggah (${d.reporter_name || '—'} · ${when}). Pastikan ini bukti baru.`);
      }
    } catch { /* hash gagal -> lanjut tanpa cek */ }
  };

  // Pecah daftar grup: pemisah baris/koma/titik-koma/pipe/slash/bullet,
  // buang penomoran di awal baris (1. 2) - * >), lalu buang duplikat.
  // Tanda hubung "-" di TENGAH nama sengaja tidak dipakai sebagai pemisah
  // karena banyak nama grup memuatnya (mis. "Info Film - Jakarta").
  const parseGroups = (text: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    text
      .split(/[\n,;|/•·]+/)
      .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*+>])\s*/, '').trim())
      .filter(Boolean)
      .forEach((s) => {
        const key = s.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) { seen.add(key); out.push(s); }
      });
    return out;
  };

  const countGroups = (text: string) => parseGroups(text).length || 1;

  const submit = async () => {
    if (!profile) return;
    if (!form.group_names.trim()) { setError('Isi minimal satu nama grup/komunitas.'); return; }
    setBusy(true); setError('');

    let proofPath: string | null = null, proofName: string | null = null, proofHash: string | null = null;
    if (file) {
      try { proofHash = await fileHash(file); } catch { /* skip */ }
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${profile.id}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from('sebaran').upload(path, file);
      if (up.error) { setBusy(false); setError('Gagal mengunggah bukti.'); return; }
      proofPath = path; proofName = file.name;
    }

    const { error: err } = await supabase.from('distribution_logs').insert({
      project_id: form.project_id || null,
      platform: form.platform,
      content_category: form.content_category,
      group_names: parseGroups(form.group_names).join('\n'),
      group_count: countGroups(form.group_names),
      content_url: form.content_url.trim() || null,
      note: form.note.trim() || null,
      proof_path: proofPath, proof_name: proofName, proof_hash: proofHash,
      reporter_id: profile.id,
      reporter_name: profile.full_name || profile.email,
    });
    setBusy(false);
    if (err) { setError('Gagal menyimpan laporan.'); return; }
    setOpen(false);
    flashToast('Laporan sebaran tersimpan.');
    // Folder hari ini langsung dibuka supaya laporan yang barusan dikirim
    // kelihatan, bukan tersembunyi di balik folder yang masih tertutup.
    setBukaTgl((b) => ({ ...b, [todayKey]: true }));
    setBukaPlat((b) => ({ ...b, [`${todayKey}|${form.platform}`]: true }));
    muatRingkas(true);
    muatRekap();
    muatBarisTanggal(todayKey);
  };

  const openDetail = async (d: DistributionLog) => {
    setDetail(d);
    setProofUrl(null);
    if (d.proof_path) {
      const { data } = await supabase.storage.from('sebaran').createSignedUrl(d.proof_path, 300);
      setProofUrl(data?.signedUrl || null);
    }
  };

  const doDelete = async () => {
    const d = confirmDel;
    if (!d) return;
    setActBusy(true);
    // .select('id') supaya penolakan RLS — yang mengenai 0 baris TANPA error —
    // tidak terlihat seperti berhasil.
    const { data, error: err } = await supabase.from('distribution_logs').delete().eq('id', d.id).select('id');
    setActBusy(false);
    if (err || !data || data.length === 0) {
      setConfirmDel(null);
      flashToast('Gagal menghapus — hanya pelapor atau superadmin.');
      return;
    }
    setConfirmDel(null); setDetail(null);
    flashToast('Laporan sebaran dihapus.');
    muatRingkas(true);
    muatRekap();
    muatBarisTanggal(wibKey(d.created_at));
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
  const fmtJam = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const isImage = (name: string | null) => !!name && /\.(png|jpe?g|webp|gif)$/i.test(name);

  const judulTanggal = (tgl: string) => {
    const d = new Date(`${tgl}T00:00:00`);
    const panjang = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const hari = d.toLocaleDateString('id-ID', { weekday: 'long' });
    if (tgl === todayKey) return { utama: 'Hari ini', sub: `${hari}, ${panjang}` };
    if (tgl === kemarinKey) return { utama: 'Kemarin', sub: `${hari}, ${panjang}` };
    return { utama: panjang, sub: hari };
  };

  const Panah = ({ buka }: { buka: boolean }) => (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: 12, flexShrink: 0, fontSize: 10,
        color: 'var(--text-3)', transition: 'transform .12s ease',
        transform: buka ? 'rotate(90deg)' : 'none',
      }}
    >▶</span>
  );

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Sebaran Harian</h2>
          <span className="top-note">{totalLaporan} laporan · {folder.length} hari</span>
        </div>
        <div className="top-actions">
          {adaYangTerbuka && <button className="btn ghost" onClick={tutupSemua}>Tutup semua</button>}
          <button className="btn primary" onClick={openModal}>+ Lapor sebaran</button>
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">Laporan hari ini ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value">{stats.todayCount}</div></div>
          <div className="kpi"><div className="kpi-label">Grup hari ini ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.todayGroups}</div></div>
          <div className="kpi">
            <div className="kpi-label">
              Total grup ({scope === 'saya' ? 'saya' : 'tim'} · {rentang === 'all' ? 'semua waktu' : `${rentang} hari`})
            </div>
            <div className="kpi-value" style={{ fontSize: 20 }}>{stats.totalGroups}</div>
          </div>
        </div>

        <div className="team-filter" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`chip-btn ${platFilter === 'all' ? 'active' : ''}`} onClick={() => setPlatFilter('all')}>Semua platform</button>
            {PLATFORMS.map((p) => (
              <button key={p.key} className={`chip-btn ${platFilter === p.key ? 'active' : ''}`} onClick={() => setPlatFilter(p.key)}>{p.label}</button>
            ))}
            <select className="cat-filter" style={{ marginLeft: 4 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="all">Semua kategori</option>
              {(Object.keys(PILLAR_LABEL) as Pillar[]).map((k) => <option key={k} value={k}>{PILLAR_LABEL[k]}</option>)}
            </select>
            <select className="cat-filter" value={rentang} onChange={(e) => setRentang(e.target.value)}>
              {RENTANG.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`chip-btn ${scope === 'saya' ? 'active' : ''}`} onClick={() => setScope('saya')}>Sebaran saya</button>
            {canSeeAll && <button className={`chip-btn ${scope === 'tim' ? 'active' : ''}`} onClick={() => setScope('tim')}>Semua tim</button>}
          </div>
        </div>

        {/* ---- Folder: Tanggal → Platform → laporan ---- */}
        {loading ? (
          <p className="empty">Memuat…</p>
        ) : folder.length === 0 ? (
          <p className="empty">Belum ada laporan sebaran pada filter ini.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {folder.map((f) => {
              const jt = judulTanggal(f.tanggal);
              const terbuka = !!bukaTgl[f.tanggal];
              return (
                <div
                  key={f.tanggal}
                  style={{
                    border: '1px solid var(--border)', borderRadius: 12,
                    background: 'var(--panel)', overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleTgl(f.tanggal)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '13px 16px', border: 0, background: terbuka ? 'var(--raised)' : 'transparent',
                      textAlign: 'left', font: 'inherit', cursor: 'pointer',
                    }}
                  >
                    <Panah buka={terbuka} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>
                        {jt.utama}
                        {f.tanggal === todayKey && (
                          <span style={{
                            marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                            textTransform: 'uppercase', color: 'var(--green)',
                          }}>aktif</span>
                        )}
                      </span>
                      <span className="sub" style={{ fontFamily: 'inherit', fontSize: 11.5 }}>{jt.sub}</span>
                    </span>
                    <span style={{ flexShrink: 0, display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
                      <span><b>{f.laporan}</b> laporan</span>
                      <span style={{ color: 'var(--green)' }}><b>{f.grup}</b> grup</span>
                      <span style={{ display: 'flex', gap: 4 }}>
                        {f.plat.map((p) => (
                          <span
                            key={p.platform}
                            title={`${platMeta(p.platform).label} · ${p.laporan} laporan`}
                            style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: platMeta(p.platform).color, display: 'inline-block',
                            }}
                          />
                        ))}
                      </span>
                    </span>
                  </button>

                  {terbuka && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      {f.plat.map((p) => {
                        const kunci = `${f.tanggal}|${p.platform}`;
                        const bukaP = !!bukaPlat[kunci];
                        const baris = barisUntuk(f.tanggal, p.platform);
                        const sedangMuat = !!muatTgl[f.tanggal];
                        return (
                          <div key={p.platform}>
                            <button
                              type="button"
                              onClick={() => setBukaPlat((b) => ({ ...b, [kunci]: !bukaP }))}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '10px 16px 10px 34px', border: 0, background: 'transparent',
                                textAlign: 'left', font: 'inherit', fontSize: 12.5, cursor: 'pointer',
                              }}
                            >
                              <Panah buka={bukaP} />
                              <span className="plat-dot" style={{ background: platMeta(p.platform).color }} />
                              <span style={{ flex: 1, fontWeight: 600 }}>{platMeta(p.platform).label}</span>
                              <span style={{ color: 'var(--text-3)' }}>
                                <b style={{ color: 'var(--text)' }}>{p.laporan}</b> laporan ·{' '}
                                <b style={{ color: 'var(--green)' }}>{p.grup}</b> grup
                              </span>
                            </button>

                            {bukaP && (
                              <div style={{ padding: '0 12px 12px 34px' }}>
                                {sedangMuat && baris.length === 0 ? (
                                  <p className="empty" style={{ padding: '14px 0' }}>Memuat laporan…</p>
                                ) : baris.length === 0 ? (
                                  <p className="empty" style={{ padding: '14px 0' }}>
                                    Tidak ada laporan di sini pada filter yang aktif.
                                  </p>
                                ) : (
                                  <div className="table-wrap">
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>Waktu lapor</th><th>Grup</th><th>Project</th>
                                          <th>Kategori</th><th>Pelapor</th><th>Bukti</th>
                                          <th style={{ width: 90 }}></th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {baris.map((d) => (
                                          <tr key={d.id} className="tracker-row" onClick={() => openDetail(d)}>
                                            <td>
                                              <b>{fmtJam(d.created_at)}</b>
                                              <div className="sub" style={{ fontFamily: 'inherit' }}>timestamp server</div>
                                            </td>
                                            <td><b>{d.group_count}</b> grup</td>
                                            <td>{projName(d.project_id)}</td>
                                            <td>{d.content_category ? (PILLAR_LABEL[d.content_category as Pillar] || d.content_category) : '—'}</td>
                                            <td><span className="row-avatar">{initials(d.reporter_name)}</span>{d.reporter_name}</td>
                                            <td>{d.proof_path ? <span className="link-tag" style={{ color: 'var(--green)' }}>ada</span> : <span className="sub">—</span>}</td>
                                            <td>
                                              <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                                                <button className="btn act" onClick={() => openDetail(d)}>Detail</button>
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rekap.length > 0 && scope === 'tim' && (
          <>
            <div className="section-title" style={{ marginTop: 28 }}>
              Rekap per Orang <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                ({rentang === 'all' ? 'semua waktu' : `${rentang} hari terakhir`})
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nama</th><th>Jumlah laporan</th><th>Total grup disebar</th></tr></thead>
                <tbody>
                  {rekap.map((r, i) => (
                    <tr key={r.reporter_id || i}>
                      <td><span className="row-avatar">{initials(r.reporter_name)}</span><b>{r.reporter_name || '—'}</b></td>
                      <td>{r.laporan}×</td>
                      <td><b>{r.grup}</b> grup</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="cal-legend">
          Laporan dikelompokkan otomatis per <b>tanggal</b> lalu per <b>platform</b> — tidak ada folder yang perlu dibuat dulu,
          dan laporan baru langsung mendarat di tempatnya. Isi tiap folder baru diambil saat dibuka, jadi layarnya tetap ringan
          walau laporannya sudah puluhan ribu. Project mengikuti pilihan di sidebar.
          Waktu lapor memakai <b>timestamp server</b> (tidak bisa diubah). Foto bukti dicek otomatis terhadap duplikat.
          Verifikasi akhir tetap oleh atasan.
        </p>
      </div>

      {/* Modal detail */}
      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: platMeta(detail.platform).color }} />{platMeta(detail.platform).label} · {detail.group_count} grup</div>
                <div className="modal-title">Laporan Sebaran</div>
                <div className="modal-sub">{fmtDateTime(detail.created_at)} · {detail.reporter_name} · {projName(detail.project_id)}{detail.content_category ? ' · ' + (PILLAR_LABEL[detail.content_category as Pillar] || detail.content_category) : ''}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="budget-detail-label">Grup / komunitas</div>
              <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{detail.group_names}</p>
              {detail.content_url && (
                <>
                  <div className="budget-detail-label" style={{ marginTop: 14 }}>Link konten</div>
                  <a className="link-tag" href={detail.content_url} target="_blank" rel="noopener noreferrer">{detail.content_url} ↗</a>
                </>
              )}
              {detail.note && (<><div className="budget-detail-label" style={{ marginTop: 14 }}>Catatan</div><p className="thread-detail">{detail.note}</p></>)}
              <div className="budget-detail-label" style={{ marginTop: 14 }}>Bukti</div>
              {detail.proof_path ? (
                isImage(detail.proof_name)
                  ? (proofUrl ? <img className="budget-qr" src={proofUrl} alt="Bukti sebaran" style={{ maxWidth: 340 }} /> : <div className="notes-empty">Memuat…</div>)
                  : <a className="btn" href={proofUrl || '#'} target="_blank" rel="noopener noreferrer">Buka bukti ↗</a>
              ) : <div className="notes-empty">Tidak ada bukti dilampirkan.</div>}
            </div>
            <div className="modal-foot">
              {(detail.reporter_id === profile?.id || profile?.role === 'superadmin') && (
                <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => setConfirmDel(detail)}>Hapus</button>
              )}
              <div className="right"><button className="btn" onClick={() => setDetail(null)}>Tutup</button></div>
            </div>
          </div>
        </div>
      )}

      {/* Modal lapor */}
      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--accent)' }} />Sebaran</div>
                <div className="modal-title">Lapor Sebaran</div>
                <div className="modal-sub">Waktu lapor otomatis tercatat (timestamp server). Foto dicek terhadap duplikat.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field-row">
                <div className="field">
                  <label>Platform</label>
                  <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                    {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Project</label>
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                    <option value="">— umum —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Kategori konten</label>
                <select value={form.content_category} onChange={(e) => setForm({ ...form, content_category: e.target.value })}>
                  {(Object.keys(PILLAR_LABEL) as Pillar[]).map((k) => <option key={k} value={k}>{PILLAR_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Nama grup / komunitas <span style={{ color: 'var(--text-3)' }}>(1 per baris, boleh banyak)</span></label>
                <textarea value={form.group_names} onChange={(e) => setForm({ ...form, group_names: e.target.value })}
                  placeholder={'Komunitas Film Indonesia\nGrup Pecinta Sinema\nInfo Film Terbaru'} rows={3} />
                <div className="hint">
                  Terdeteksi <b>{parseGroups(form.group_names).length}</b> grup
                  {parseGroups(form.group_names).length > 0 && (
                    <span style={{ color: 'var(--text-3)' }}>
                      {' '}— pastikan sesuai sebelum kirim
                    </span>
                  )}
                </div>
                {parseGroups(form.group_names).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {parseGroups(form.group_names).map((g, i) => (
                      <span key={g + i} style={{
                        fontSize: 11.5, padding: '3px 9px', borderRadius: 20,
                        background: 'var(--raised, rgba(255,255,255,.06))',
                        border: '1px solid var(--border, rgba(255,255,255,.08))',
                      }}>{i + 1}. {g}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="field">
                <label>Link konten yang disebar <span style={{ color: 'var(--text-3)' }}>(opsional)</span></label>
                <input value={form.content_url} onChange={(e) => setForm({ ...form, content_url: e.target.value })} placeholder="https://instagram.com/p/..." />
              </div>
              <div className="field">
                <label>Foto bukti <span style={{ color: 'var(--text-3)' }}>(screenshot chat grup)</span></label>
                <input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
                <div className="hint">{file ? file.name : `Opsional · maks ${MAX_MB} MB`}</div>
                {dupWarn && <p className="error-msg" style={{ marginTop: 8 }}>{dupWarn}</p>}
              </div>
              <div className="field">
                <label>Catatan <span style={{ color: 'var(--text-3)' }}>(opsional)</span></label>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="mis. sebar sore, respons ramai" />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.group_names.trim()}>
                  {busy ? 'Menyimpan…' : 'Kirim laporan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus (pengganti window.confirm yang diblokir browser) */}
      {confirmDel && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Hapus laporan</div>
                <div className="modal-title">Hapus laporan sebaran ini?</div>
                <div className="modal-sub">
                  {platMeta(confirmDel.platform).label} · {confirmDel.group_count} grup · {confirmDel.reporter_name}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setConfirmDel(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail">Data laporan akan hilang permanen dan tidak bisa dikembalikan. Bukti yang sudah diunggah tetap tersimpan di storage.</p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setConfirmDel(null)} disabled={actBusy}>Batal</button>
                <button className="btn primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={doDelete} disabled={actBusy}>
                  {actBusy ? 'Menghapus…' : 'Ya, hapus'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
