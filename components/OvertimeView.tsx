'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  boleh, initials, MAKS_FOTO_LEMBUR, TUGAS,
  type OvertimeProof, type OvertimeRequest, type Profile, type Project,
} from '@/lib/types';

interface Props {
  profile: Profile | null;
  projects: Project[];
  projectFilter: string;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  diajukan: { label: 'Diajukan', color: 'var(--st-review)' },
  disetujui: { label: 'Disetujui', color: 'var(--green)' },
  ditolak: { label: 'Ditolak', color: 'var(--red)' },
};

/**
 * Tanggal hari ini menurut jam LOKAL (WIB), bukan UTC.
 * toISOString() memakai UTC — antara 00:00 dan 07:00 WIB dia masih menunjuk
 * tanggal kemarin, sehingga tanggal default pengajuan meleset sehari.
 */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// hitung durasi jam (mendukung lintas tengah malam)
function durationHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // lewat tengah malam
  return mins / 60;
}
const fmtDur = (h: number) => {
  const H = Math.floor(h);
  const M = Math.round((h - H) * 60);
  return M ? `${H}j ${M}m` : `${H}j`;
};

export default function OvertimeView({ profile, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<OvertimeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'diajukan' | 'disetujui' | 'ditolak'>('all');
  const [scope, setScope] = useState<'saya' | 'tim'>('saya');
  /** 'all' atau kunci orang — lihat peopleKey() di bawah. */
  const [person, setPerson] = useState<string>('all');
  /** Daftar akun login, dipakai mengisi pilihan filter Pemohon. */
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OvertimeRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    work_date: todayLocal(),
    start_time: '17:00', end_time: '20:00',
    description: '', project_ids: [] as string[],
  });
  /** Foto bukti. Maks 5 MB per foto — storage Supabase gratis cuma 1 GB dan
      sudah dipakai bersama bukti Sebaran Harian. Maks 3 foto per pengajuan. */
  const MAX_MB = 5;
  /** Foto BARU yang dipilih di modal, belum diunggah. */
  const [fileBaru, setFileBaru] = useState<File[]>([]);
  /** Foto yang SUDAH tersimpan (hanya terisi saat mengedit). */
  const [fotoLama, setFotoLama] = useState<OvertimeProof[]>([]);
  /** Foto lama yang ditandai untuk dibuang saat Simpan ditekan. */
  const [fotoDibuang, setFotoDibuang] = useState<OvertimeProof[]>([]);
  /** Signed URL foto di modal detail, per path. Umur pendek, diambil ulang
      tiap modal detail dibuka. */
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  /** Foto yang sedang dibuka besar (lightbox). */
  const [fotoBesar, setFotoBesar] = useState<string | null>(null);

  /** Pratinjau foto baru: object URL dibuat sekali per file, lalu dilepas
   *  supaya tidak bocor memori. */
  const [pratinjau, setPratinjau] = useState<string[]>([]);
  useEffect(() => {
    const urls = fileBaru.map((f) => URL.createObjectURL(f));
    setPratinjau(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [fileBaru]);

  const sisaSlot = MAKS_FOTO_LEMBUR - (fotoLama.length + fileBaru.length);

  /** Menambahkan file dari input. Dipotong di sisa slot, ditolak kalau
   *  kebesaran — supaya tidak baru ketahuan saat menekan Simpan. */
  const pilihFoto = (list: FileList | null) => {
    if (!list) return;
    // Array.from — BUKAN [...list]. tsconfig repo target ES5, spread pada
    // FileList/Set gagal saat build di Vercel.
    const dipilih = Array.from(list);
    const kebesaran = dipilih.filter((f) => f.size > MAX_MB * 1024 * 1024);
    const muat = dipilih.filter((f) => f.size <= MAX_MB * 1024 * 1024).slice(0, Math.max(sisaSlot, 0));
    if (muat.length) setFileBaru(fileBaru.concat(muat));
    if (kebesaran.length) {
      setError(`${kebesaran.length} foto dilewati karena lebih dari ${MAX_MB} MB.`);
    } else if (dipilih.length > muat.length) {
      setError(`Maksimal ${MAKS_FOTO_LEMBUR} foto — sisanya tidak ikut.`);
    } else {
      setError('');
    }
  };

  /** Foto tersimpan milik satu pengajuan, sudah menangani baris lama yang
   *  masih memakai kolom proof_path tunggal. */
  const fotoDari = (o: OvertimeRequest): OvertimeProof[] => {
    const baru = Array.isArray(o.proofs) ? o.proofs : [];
    if (baru.length) return baru;
    if (o.proof_path) return [{ path: o.proof_path, name: o.proof_name || 'Foto bukti' }];
    return [];
  };

  const canApprove = boleh(profile, TUGAS.lemburPutuskan);
  /** Hanya superadmin yang boleh menghapus pengajuan milik orang lain. */
  // Cerminan policy ot_delete:
  //   (requester_id = auth.uid() AND status='diajukan') OR boleh('lembur_hapus_orang')
  const isSuper = boleh(profile, TUGAS.lemburHapusOrang);

  /**
   * window.confirm / prompt / alert DIBLOKIR di lingkungan ini — tombol yang
   * memakainya tidak melakukan apa pun tanpa pesan apa pun. Semua diganti
   * modal & toast di dalam aplikasi.
   */
  const [toast, setToast] = useState('');
  const [confirmDel, setConfirmDel] = useState<OvertimeRequest | null>(null);
  const [rejectFor, setRejectFor] = useState<OvertimeRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actBusy, setActBusy] = useState(false);

  const flashToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 3200);
  };

  /**
   * silent = true → muat ulang tanpa menyalakan layar "Memuat…".
   * Dipakai oleh realtime dan oleh aksi simpan: kalau tidak, tiap perubahan
   * dari orang lain membuat seluruh halaman berkedip.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let q = supabase.from('overtime_requests').select('*').order('work_date', { ascending: false });
    // `contains` supaya lembur yang mencakup beberapa project ikut muncul di
    // tiap project-nya, bukan cuma di project utama.
    if (projectFilter !== 'all') q = q.contains('project_ids', [projectFilter]);
    const { data } = await q;
    setRows((data as OvertimeRequest[]) || []);

    // Daftar akun diambil dari tabel profiles supaya setiap user baru yang
    // ditambahkan lewat Kelola Akses langsung muncul di filter — tanpa perlu
    // mengubah kode. Kalau RLS menutup tabel ini untuk sebagian peran,
    // errornya sengaja diabaikan: daftarnya masih bisa disusun dari data
    // lembur yang ada (lihat peopleOptions).
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('is_active', true);
    setUsers(
      ((prof as { id: string; full_name: string | null; email: string }[]) || [])
        .map((u) => ({ id: u.id, name: u.full_name || u.email })),
    );

    if (!silent) setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  /**
   * Realtime — layar ikut berubah begitu ada yang mengajukan, menyetujui,
   * menolak, atau menghapus lembur. Tidak perlu refresh manual.
   *
   * Penyegarannya SENYAP (load(true)) supaya tidak ada kedipan, dan ditunda
   * 250 ms: satu aksi bisa memicu beberapa kejadian beruntun, dan tanpa jeda
   * ini database dipanggil berkali-kali untuk hasil yang sama.
   *
   * ⚠️ Butuh Replication tabel overtime_requests dinyalakan di Supabase.
   * Kalau belum, kodenya tetap aman — hanya tidak terjadi apa-apa.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(true); }, 250);
    };

    const ch = supabase
      .channel('overtime-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests' }, segarkan)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [load]);

  const openModal = () => {
    setEditId(null);
    setForm({
      work_date: todayLocal(),
      start_time: '17:00', end_time: '20:00', description: '',
      project_ids: projectFilter !== 'all' ? [projectFilter] : [],
    });
    setFileBaru([]);
    setFotoLama([]);
    setFotoDibuang([]);
    setError('');
    setOpen(true);
  };

  const openEdit = (o: OvertimeRequest) => {
    setDetail(null);
    setEditId(o.id);
    setForm({
      work_date: o.work_date,
      start_time: o.start_time.slice(0, 5),
      end_time: o.end_time.slice(0, 5),
      description: o.description,
      project_ids: idsProject(o),
    });
    setFileBaru([]);
    setFotoLama(fotoDari(o));
    setFotoDibuang([]);
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.description.trim()) { setError('Isi dulu apa yang dikerjakan.'); return; }
    if (form.start_time === form.end_time) { setError('Jam mulai dan selesai tidak boleh sama.'); return; }
    if (fotoLama.length + fileBaru.length > MAKS_FOTO_LEMBUR) {
      setError(`Maksimal ${MAKS_FOTO_LEMBUR} foto per pengajuan.`); return;
    }
    setBusy(true); setError('');

    // Unggah foto baru satu per satu. Kalau ada yang gagal, yang sudah
    // terlanjur naik dibuang lagi supaya tidak jadi sampah di storage.
    const terunggah: OvertimeProof[] = [];
    for (let i = 0; i < fileBaru.length; i++) {
      const f = fileBaru[i];
      const aman = f.name.replace(/[^\w.\-]+/g, '_');
      const path = `${profile.id}/${Date.now()}_${i}_${aman}`;
      const up = await supabase.storage.from('lembur').upload(path, f);
      if (up.error) {
        if (terunggah.length) {
          await supabase.storage.from('lembur').remove(terunggah.map((p) => p.path));
        }
        setBusy(false);
        setError(`Gagal mengunggah "${f.name}". Pengajuan belum tersimpan.`);
        return;
      }
      terunggah.push({ path, name: f.name });
    }
    const bukti: OvertimeProof[] = fotoLama.concat(terunggah);

    const payload: Record<string, unknown> = {
      // project_id tetap diisi project pertama: policy RLS lama masih
      // memakainya, jadi kalau dikosongkan pengajuannya bisa ditolak database.
      project_id: form.project_ids[0] || null,
      project_ids: form.project_ids,
      work_date: form.work_date,
      start_time: form.start_time,
      end_time: form.end_time,
      description: form.description.trim(),
    };
    // Daftar foto selalu ditulis apa adanya: gabungan foto lama yang tidak
    // dibuang + foto baru. Jadi menghapus foto pun tersimpan.
    payload.proofs = bukti;
    // Kolom tunggal lama dikosongkan supaya tidak ada foto dobel di tampilan
    // (fotoDari() memakai proof_path hanya kalau proofs masih kosong).
    payload.proof_path = null;
    payload.proof_name = null;

    let err;
    // .select('id') wajib: UPDATE/DELETE yang ditolak RLS mengenai 0 baris
    // TANPA error. Tanpa ini, gagal simpan terlihat seperti berhasil.
    let kena = 1;
    if (editId) {
      const r = await supabase.from('overtime_requests').update(payload).eq('id', editId).select('id');
      err = r.error;
      kena = r.data ? r.data.length : 0;
    } else {
      const r = await supabase.from('overtime_requests').insert({
        ...payload, requester_id: profile.id, requester_name: profile.full_name || profile.email,
      }).select('id');
      err = r.error;
      kena = r.data ? r.data.length : 0;
    }
    if (err || kena === 0) {
      // Simpan gagal — foto yang baru saja naik dibuang lagi.
      if (terunggah.length) {
        await supabase.storage.from('lembur').remove(terunggah.map((p) => p.path));
      }
      setBusy(false);
      setError(err ? 'Gagal menyimpan pengajuan.' : 'Tidak tersimpan — kamu tidak punya izin mengubah pengajuan ini.');
      return;
    }

    // Baru sekarang foto yang dibuang benar-benar dihapus dari storage,
    // supaya kalau simpan gagal fotonya masih utuh.
    if (fotoDibuang.length) {
      await supabase.storage.from('lembur').remove(fotoDibuang.map((p) => p.path));
    }

    setBusy(false);
    setOpen(false);
    setFileBaru([]);
    setFotoLama([]);
    setFotoDibuang([]);
    load(true);
  };

  /** Menyetujui langsung; menolak lewat modal alasan (lihat rejectFor). */
  const decide = async (o: OvertimeRequest, approve: boolean, reason: string | null = null) => {
    if (!profile) return;
    setActBusy(true);
    const { error: err } = await supabase.from('overtime_requests').update({
      status: approve ? 'disetujui' : 'ditolak',
      approver_id: profile.id,
      approver_name: profile.full_name || profile.email,
      decided_at: new Date().toISOString(),
      reject_reason: reason,
    }).eq('id', o.id);
    setActBusy(false);
    if (err) {
      flashToast(`Gagal — ${err.message}`);
      return;
    }
    flashToast(approve ? 'Lembur disetujui.' : 'Lembur ditolak.');
    setDetail(null);
    setRejectFor(null);
    setRejectReason('');
    load(true);
  };

  /** Penghapusan sebenarnya. Konfirmasinya ditangani modal confirmDel. */
  /** URL foto bukti berumur pendek; diambil ulang tiap modal detail dibuka. */
  useEffect(() => {
    let batal = false;
    setProofUrls({});
    setFotoBesar(null);
    if (!detail) return;
    const daftar = fotoDari(detail);
    if (!daftar.length) return;
    supabase.storage.from('lembur')
      .createSignedUrls(daftar.map((p) => p.path), 300)
      .then(({ data }) => {
        if (batal || !data) return;
        const peta: Record<string, string> = {};
        data.forEach((d) => { if (d.path && d.signedUrl) peta[d.path] = d.signedUrl; });
        setProofUrls(peta);
      });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const doDelete = async (o: OvertimeRequest) => {
    setActBusy(true);
    // Buang fotonya lebih dulu supaya tidak jadi sampah yang tetap makan kuota.
    const fotoIkut = fotoDari(o);
    if (fotoIkut.length) {
      await supabase.storage.from('lembur').remove(fotoIkut.map((p) => p.path));
    }
    const { error: err } = await supabase.from('overtime_requests').delete().eq('id', o.id);
    setActBusy(false);
    setConfirmDel(null);
    if (err) {
      flashToast(`Gagal menghapus — ${err.message}`);
      return;
    }
    flashToast('Pengajuan lembur dihapus.');
    setDetail(null);
    load(true);
  };

  /** Boleh menghapus: superadmin (apa pun status & pemiliknya), atau pemilik
   *  selama pengajuannya masih menunggu keputusan. */
  const bolehHapus = (o: OvertimeRequest) =>
    isSuper || (o.status === 'diajukan' && o.requester_id === profile?.id);

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';

  /** Larik project sebuah pengajuan. Baris lama yang belum sempat terisi
      larik tetap terbaca lewat project_id-nya. */
  const idsProject = (o: OvertimeRequest): string[] =>
    (o.project_ids && o.project_ids.length ? o.project_ids : (o.project_id ? [o.project_id] : []));

  /** Semua nama project dirangkai jadi satu teks. */
  const namaProject = (o: OvertimeRequest): string => {
    const ids = idsProject(o);
    if (!ids.length) return '— umum —';
    return ids.map((id) => projName(id)).join(', ');
  };
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  /**
   * Kunci identitas pemohon. Pakai requester_id kalau ada — nama bisa berubah
   * atau kembar, ID tidak. Baris lama yang tidak punya id disimpan dengan
   * awalan 'nama:' supaya riwayatnya tetap bisa disaring.
   */
  const peopleKey = (r: OvertimeRequest) =>
    r.requester_id || `nama:${r.requester_name || '—'}`;

  /**
   * Pilihan filter Pemohon = gabungan dua sumber:
   *  1. akun aktif dari Kelola Akses — supaya orang baru langsung muncul
   *  2. nama yang benar-benar ada di data lembur — supaya riwayat orang yang
   *     akunnya sudah dihapus tidak ikut hilang dari filter
   */
  const peopleOptions = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => map.set(u.id, u.name));
    rows.forEach((r) => {
      const k = peopleKey(r);
      if (!map.has(k)) map.set(k, r.requester_name || '—');
    });
    return Array.from(map, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [users, rows]);

  /** Dasar semua hitungan di layar ini — KPI, tabel, dan rekap ikut filter orang. */
  const personRows = useMemo(
    () => (person === 'all' ? rows : rows.filter((r) => peopleKey(r) === person)),
    [rows, person],
  );

  const scoped = useMemo(
    () => personRows.filter((r) => (scope === 'saya' ? r.requester_id === profile?.id : true)),
    [personRows, scope, profile],
  );
  const filtered = useMemo(
    () => scoped.filter((r) => filter === 'all' || r.status === filter),
    [scoped, filter],
  );

  /**
   * Rekap & KPI memakai `scoped`, bukan `personRows` — supaya ikut tombol
   * "Lembur saya / Semua tim" persis seperti tabelnya.
   *
   * Sebelumnya keduanya memakai data penuh, sehingga di layar yang sama tabel
   * bisa menampilkan 1 baris sementara rekap di bawahnya menampilkan 3 orang.
   * Yang TIDAK ikut cuma saringan status (Diajukan/Disetujui/Ditolak) — rekap
   * memang perlu semuanya untuk bisa memisahkan mana yang disetujui.
   */
  const rekap = useMemo(() => {
    const map = new Map<string, {
      key: string; name: string; hours: number; count: number;
      /** Rincian pengajuannya, supaya barisnya bisa dibuka untuk melihat
       *  pekerjaan apa saja yang menghasilkan jam tersebut. */
      items: OvertimeRequest[];
    }>();
    scoped.filter((r) => r.status === 'disetujui').forEach((r) => {
      const key = peopleKey(r);
      const cur = map.get(key) || { key, name: r.requester_name || '—', hours: 0, count: 0, items: [] };
      cur.hours += durationHours(r.start_time, r.end_time);
      cur.count += 1;
      cur.items.push(r);
      map.set(key, cur);
    });
    return Array.from(map.values())
      .map((v) => ({ ...v, items: v.items.sort((a, b) => b.work_date.localeCompare(a.work_date)) }))
      .sort((a, b) => b.hours - a.hours);
  }, [scoped]);

  /** Baris rekap yang sedang dibuka rinciannya. */
  const [openRekap, setOpenRekap] = useState<string | null>(null);

  // `scoped` sudah menerapkan Lembur saya / Semua tim, jadi tidak perlu diulang di sini.
  const myPending = scoped.filter((r) => r.status === 'diajukan').length;

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Lembur</h2>
          <span className="top-note">{scoped.length} pengajuan</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={openModal}>+ Ajukan lembur</button>
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">Menunggu keputusan</div><div className="kpi-value" style={{ color: 'var(--st-review)' }}>{myPending}</div></div>
          <div className="kpi"><div className="kpi-label">Disetujui (pengajuan)</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{scoped.filter((r) => r.status === 'disetujui').length}</div></div>
          <div className="kpi"><div className="kpi-label">Total jam disetujui</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmtDur(rekap.reduce((a, r) => a + r.hours, 0))}</div></div>
        </div>

        <div className="team-filter" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'diajukan', 'disetujui', 'ditolak'] as const).map((f) => (
              <button key={f} className={`chip-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Semua' : STATUS_META[f].label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Filter per orang hanya untuk yang berwenang melihat lembur tim —
                buat anggota biasa pilihannya tidak ada gunanya dan justru
                memperlihatkan nama rekan yang tidak perlu dia lihat. */}
            {canApprove && (
              <select
                value={person}
                onChange={(e) => {
                  const v = e.target.value;
                  setPerson(v);
                  // Memilih orang lain sementara tampilan masih "Lembur saya"
                  // akan menghasilkan tabel kosong dan terlihat seperti bug.
                  if (v !== 'all') setScope('tim');
                }}
                style={{
                  padding: '6px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                  background: person === 'all' ? 'var(--raised)' : 'var(--accent-soft)',
                  border: `1px solid ${person === 'all' ? 'var(--border-strong)' : 'var(--accent)'}`,
                  color: person === 'all' ? 'var(--text-2)' : 'var(--accent)',
                  maxWidth: 200,
                }}
                title="Saring berdasarkan pemohon"
              >
                <option value="all">Semua orang ({peopleOptions.length})</option>
                {peopleOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button className={`chip-btn ${scope === 'saya' ? 'active' : ''}`}
              onClick={() => { setScope('saya'); setPerson('all'); }}>Lembur saya</button>
            {canApprove && <button className={`chip-btn ${scope === 'tim' ? 'active' : ''}`} onClick={() => setScope('tim')}>Semua tim</button>}
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <p className="empty">Memuat…</p> : filtered.length === 0 ? (
            <p className="empty">Belum ada pengajuan lembur pada filter ini.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Tanggal</th><th>Jam</th><th>Durasi</th><th>Project</th><th>Yang dikerjakan</th><th>Pemohon</th><th>Status</th><th style={{ width: 150 }}></th></tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="tracker-row" onClick={() => setDetail(o)}>
                    <td><b>{fmtDate(o.work_date)}</b></td>
                    <td>{o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)}</td>
                    <td><b>{fmtDur(durationHours(o.start_time, o.end_time))}</b></td>
                    <td>{namaProject(o)}</td>
                    <td>
                      <span className="ot-desc-clip">{o.description}</span>
                      {fotoDari(o).length > 0 && (
                        <span
                          title={`${fotoDari(o).length} foto bukti`}
                          style={{ marginLeft: 6, fontSize: 11.5, color: 'var(--text-3)', whiteSpace: 'nowrap' }}
                        >
                          📎 {fotoDari(o).length}
                        </span>
                      )}
                      {o.reject_reason && <div className="sub" style={{ color: 'var(--red)' }}>Ditolak: {o.reject_reason}</div>}
                    </td>
                    <td><span className="row-avatar">{initials(o.requester_name)}</span>{o.requester_name}</td>
                    <td><span className="status-dot" style={{ background: STATUS_META[o.status]?.color }} />{STATUS_META[o.status]?.label}</td>
                    <td>
                      <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                        {o.status === 'diajukan' && canApprove && (
                          <>
                            <button className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => decide(o, true)}>Setujui</button>
                            <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                              onClick={() => { setRejectReason(''); setRejectFor(o); }}>Tolak</button>
                          </>
                        )}
                        {o.status === 'diajukan' && o.requester_id === profile?.id && (
                          <button className="btn act" onClick={() => openEdit(o)}>Edit</button>
                        )}
                        {bolehHapus(o) && (
                          <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                            title={isSuper ? 'Hapus permanen (punya siapa pun)' : 'Hapus pengajuan ini'}
                            onClick={() => setConfirmDel(o)}>Hapus</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {rekap.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 28 }}>
              Rekap Jam (disetujui)
              <span className="sub" style={{ marginLeft: 8, fontWeight: 400, fontSize: 11.5 }}>
                klik nama untuk melihat rincian pekerjaannya
              </span>
              {person !== 'all' && (
                <span className="sub" style={{ marginLeft: 8, fontWeight: 400 }}>
                  · {peopleOptions.find((p) => p.id === person)?.name || ''}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nama</th><th>Jumlah pengajuan</th><th>Total jam lembur</th></tr></thead>
                <tbody>
                  {rekap.map((r) => {
                    const buka = openRekap === r.key;
                    return (
                      <Fragment key={r.key}>
                        <tr
                          className="tracker-row"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setOpenRekap(buka ? null : r.key)}
                          title={buka ? 'Tutup rincian' : 'Lihat pekerjaan yang dikerjakan'}
                        >
                          <td>
                            <span className="row-avatar">{initials(r.name)}</span>
                            <b>{r.name}</b>
                            <span style={{
                              marginLeft: 8, color: 'var(--text-3)', fontSize: 11,
                              display: 'inline-block',
                              transform: buka ? 'rotate(90deg)' : 'none',
                              transition: 'transform .12s',
                            }}>▸</span>
                          </td>
                          <td>{r.count}×</td>
                          <td><b>{fmtDur(r.hours)}</b></td>
                        </tr>

                        {buka && (
                          <tr>
                            {/* Rincian sengaja dipasang sebagai baris terpisah selebar
                                tabel, bukan kolom baru. Uraian pekerjaan panjang-panjang;
                                kalau dijejalkan jadi kolom, tabelnya melebar dan judulnya
                                terpotong. */}
                            <td colSpan={3} style={{ background: 'var(--raised)', padding: '4px 16px 12px' }}>
                              {r.items.map((o) => (
                                <div
                                  key={o.id}
                                  style={{
                                    display: 'flex', gap: 12, alignItems: 'flex-start',
                                    padding: '9px 0', borderTop: '1px solid var(--border)',
                                  }}
                                >
                                  <div style={{ minWidth: 108, flexShrink: 0 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtDate(o.work_date)}</div>
                                    <div className="sub" style={{ fontSize: 11 }}>
                                      {o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)}
                                    </div>
                                  </div>
                                  <div style={{ minWidth: 54, flexShrink: 0, fontSize: 12.5, fontWeight: 700 }}>
                                    {fmtDur(durationHours(o.start_time, o.end_time))}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                      {o.description}
                                    </div>
                                    <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>
                                      {namaProject(o)}
                                      {o.approver_name ? ` · disetujui ${o.approver_name}` : ''}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="cal-legend">
          Semua user boleh mengajukan · <b>Manager</b> menyetujui/menolak · rekap jam dihitung dari pengajuan yang disetujui. Jam diisi manual.
        </p>
      </div>

      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: STATUS_META[detail.status]?.color }} />
                  Lembur · {STATUS_META[detail.status]?.label}
                </div>
                <div className="modal-title">{fmtDate(detail.work_date)}</div>
                <div className="modal-sub">
                  {detail.start_time.slice(0,5)}–{detail.end_time.slice(0,5)} · {fmtDur(durationHours(detail.start_time, detail.end_time))} · {namaProject(detail)}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="budget-detail-label">Yang dikerjakan</div>
              <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</p>
              {fotoDari(detail).length > 0 && (
                <>
                  <div className="budget-detail-label" style={{ marginTop: 16 }}>
                    Foto bukti ({fotoDari(detail).length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {fotoDari(detail).map((p) => (
                      <div key={p.path} style={{ width: 150 }}>
                        {proofUrls[p.path] ? (
                          <img
                            src={proofUrls[p.path]}
                            alt={p.name}
                            title="Klik untuk memperbesar"
                            onClick={() => setFotoBesar(proofUrls[p.path])}
                            style={{
                              width: '100%', height: 110, objectFit: 'cover', cursor: 'zoom-in',
                              borderRadius: 8, border: '1px solid var(--line)', display: 'block',
                            }}
                          />
                        ) : (
                          <div className="notes-empty" style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            Memuat…
                          </div>
                        )}
                        <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="budget-detail-label" style={{ marginTop: 16 }}>Riwayat</div>
              <div className="budget-trace">
                <div><b>Diajukan</b> oleh {detail.requester_name}</div>
                {detail.approver_name && <div><b>{detail.status === 'ditolak' ? 'Ditolak' : 'Disetujui'}</b> oleh {detail.approver_name}</div>}
                {detail.reject_reason && <div style={{ color: 'var(--red)' }}>Alasan: {detail.reject_reason}</div>}
              </div>
            </div>
            <div className="modal-foot">
              {detail.status === 'diajukan' && canApprove && (
                <>
                  <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                    onClick={() => { setRejectReason(''); setRejectFor(detail); }}>Tolak</button>
                  <button className="btn primary" disabled={actBusy} onClick={() => decide(detail, true)}>✓ Setujui</button>
                </>
              )}
              {detail.status === 'diajukan' && detail.requester_id === profile?.id && (
                <button className="btn" onClick={() => openEdit(detail)}>✎ Edit</button>
              )}
              {bolehHapus(detail) && (
                <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => setConfirmDel(detail)}>Hapus</button>
              )}
              <div className="right">
                <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Konfirmasi hapus (menggantikan window.confirm yang diblokir) ---- */}
      {confirmDel && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus pengajuan
                </div>
                <div className="modal-title">{fmtDate(confirmDel.work_date)}</div>
                <div className="modal-sub">
                  {confirmDel.requester_name} · {confirmDel.start_time.slice(0, 5)}–{confirmDel.end_time.slice(0, 5)} ·{' '}
                  {fmtDur(durationHours(confirmDel.start_time, confirmDel.end_time))}
                </div>
              </div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{confirmDel.description}</p>
              <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--red)' }}>
                Terhapus permanen — tidak bisa dikembalikan, termasuk riwayat persetujuannya.
              </p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={actBusy} onClick={() => setConfirmDel(null)}>Batal</button>
                <button className="btn" disabled={actBusy}
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => doDelete(confirmDel)}>
                  {actBusy ? 'Menghapus…' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Alasan menolak (menggantikan window.prompt yang diblokir) ---- */}
      {rejectFor && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRejectFor(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Tolak lembur
                </div>
                <div className="modal-title">{fmtDate(rejectFor.work_date)}</div>
                <div className="modal-sub">
                  {rejectFor.requester_name} · {fmtDur(durationHours(rejectFor.start_time, rejectFor.end_time))}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setRejectFor(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Alasan menolak (opsional)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="mis. jam tidak sesuai catatan kehadiran"
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Alasan ini ikut tersimpan dan terlihat oleh pemohon.
              </p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={actBusy} onClick={() => setRejectFor(null)}>Batal</button>
                <button className="btn" disabled={actBusy}
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => decide(rejectFor, false, rejectReason.trim() || null)}>
                  {actBusy ? 'Menyimpan…' : 'Tolak pengajuan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--accent)' }} />Lembur</div>
                <div className="modal-title">{editId ? 'Edit Lembur' : 'Ajukan Lembur'}</div>
                <div className="modal-sub">{editId ? 'Perubahan hanya bisa selama status masih Diajukan.' : 'Isi manual. Setelah diajukan, manager akan menyetujui atau menolak.'}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Tanggal</label>
                <input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Mulai</label>
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div className="field">
                  <label>Selesai</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <label>Durasi</label>
                  <div className="dur-pill">{fmtDur(durationHours(form.start_time, form.end_time))}</div>
                </div>
              </div>
              <div className="field">
                <label>
                  Project terkait <span style={{ color: 'var(--text-3)' }}>(boleh lebih dari satu)</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {projects.map((p) => {
                    const dipilih = form.project_ids.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip-btn ${dipilih ? 'active' : ''}`}
                        onClick={() => setForm({
                          ...form,
                          project_ids: dipilih
                            ? form.project_ids.filter((x) => x !== p.id)
                            : [...form.project_ids, p.id],
                        })}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                <div className="hint">
                  {form.project_ids.length
                    ? `${form.project_ids.length} project dipilih`
                    : 'Belum ada yang dipilih — akan dicatat sebagai lembur umum'}
                </div>
              </div>

              <div className="field">
                <label>
                  Foto bukti <span style={{ color: 'var(--text-3)' }}>(opsional)</span>
                </label>

                {(fotoLama.length > 0 || fileBaru.length > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {/* Foto yang sudah tersimpan. Dibuang dari daftar dulu;
                        file di storage baru benar-benar dihapus saat Simpan. */}
                    {fotoLama.map((p) => (
                      <div key={p.path} style={{ position: 'relative', width: 96 }}>
                        <div
                          style={{
                            height: 72, borderRadius: 8, border: '1px solid var(--line)',
                            background: 'var(--raised)', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 20,
                          }}
                        >
                          🖼
                        </div>
                        <button
                          type="button"
                          className="btn act"
                          title="Buang foto ini"
                          onClick={() => {
                            setFotoLama(fotoLama.filter((x) => x.path !== p.path));
                            setFotoDibuang(fotoDibuang.concat([p]));
                            setError('');
                          }}
                          style={{ position: 'absolute', top: 2, right: 2, padding: '0 6px', lineHeight: '18px' }}
                        >
                          ✕
                        </button>
                        <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                      </div>
                    ))}

                    {/* Foto baru yang belum diunggah — dengan pratinjau asli. */}
                    {fileBaru.map((f, i) => (
                      <div key={`${f.name}-${i}`} style={{ position: 'relative', width: 96 }}>
                        {pratinjau[i] ? (
                          <img
                            src={pratinjau[i]}
                            alt={f.name}
                            style={{
                              width: '100%', height: 72, objectFit: 'cover', display: 'block',
                              borderRadius: 8, border: '1px solid var(--line)',
                            }}
                          />
                        ) : (
                          <div style={{ height: 72, borderRadius: 8, border: '1px solid var(--line)' }} />
                        )}
                        <button
                          type="button"
                          className="btn act"
                          title="Batalkan foto ini"
                          onClick={() => { setFileBaru(fileBaru.filter((_, j) => j !== i)); setError(''); }}
                          style={{ position: 'absolute', top: 2, right: 2, padding: '0 6px', lineHeight: '18px' }}
                        >
                          ✕
                        </button>
                        <div className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {sisaSlot > 0 && (
                  <input
                    type="file"
                    multiple
                    // image/* supaya di HP muncul pilihan Kamera maupun Galeri.
                    accept="image/png,image/jpeg,image/webp,image/*"
                    onChange={(e) => {
                      pilihFoto(e.target.files);
                      // Dikosongkan lagi supaya memilih file yang sama dua kali
                      // (mis. setelah dibatalkan) tetap memicu onChange.
                      e.target.value = '';
                    }}
                  />
                )}
                <div className="hint">
                  {sisaSlot > 0
                    ? `Boleh sekaligus beberapa · sisa ${sisaSlot} dari ${MAKS_FOTO_LEMBUR} foto · maks ${MAX_MB} MB per foto`
                    : `Sudah ${MAKS_FOTO_LEMBUR} foto — buang salah satu dulu kalau mau ganti`}
                </div>
              </div>
              <div className="field">
                <label>Apa saja yang dikerjakan</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="mis. Edit 5 reels REXONA, revisi caption, jadwalkan upload" />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.description.trim()}>
                  {busy ? 'Menyimpan…' : (editId ? 'Simpan perubahan' : 'Ajukan')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Foto diperbesar. Klik di mana saja untuk menutup. */}
      {fotoBesar && (
        <div
          onClick={() => setFotoBesar(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, cursor: 'zoom-out',
          }}
        >
          <img
            src={fotoBesar}
            alt="Foto bukti lembur"
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }}
          />
        </div>
      )}
    </>
  );
}
