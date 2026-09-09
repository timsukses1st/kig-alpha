'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  akuHrdUntuk, akuLeadUntuk, initials, JENIS_CUTI, jenisCutiDef, statusCutiDef,
  type JenisCuti, type LeaveRequest, type OrangRingkas, type Profile, type Role, type Team,
} from '@/lib/types';

interface Props {
  profile: Profile | null;
}

/**
 * Tanggal hari ini menurut jam LOKAL (WIB), bukan UTC.
 * toISOString() memakai UTC — antara 00:00 dan 07:00 WIB dia masih menunjuk
 * tanggal kemarin, sehingga tanggal bawaan pengajuan meleset sehari.
 */
function hariIni(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fmtTgl = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

const fmtTglJam = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

/** Rentang tanggal ditulis sependek mungkin tanpa jadi ambigu. */
function rentang(o: LeaveRequest): string {
  if (o.start_date === o.end_date) return fmtTgl(o.start_date);
  return `${fmtTgl(o.start_date)} – ${fmtTgl(o.end_date)}`;
}

/**
 * Lama pengajuan, dihitung dari kolom hasil hitungan database.
 *
 * Sengaja TIDAK dihitung ulang di sini: kalau layar dan database punya rumus
 * sendiri-sendiri, cepat atau lambat angkanya berbeda dan yang disalahkan
 * biasanya orangnya, bukan rumusnya.
 */
const lama = (o: LeaveRequest) => `${o.hari_kalender} hari`;

type Tampilan = 'saya' | 'keputusan' | 'semua';

export default function LeaveView({ profile }: Props) {
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [orang, setOrang] = useState<Record<string, OrangRingkas>>({});
  const [loading, setLoading] = useState(true);
  const [tampilan, setTampilan] = useState<Tampilan>('saya');
  const [filter, setFilter] = useState<'all' | string>('all');

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    kind: 'cuti' as JenisCuti,
    start_date: hariIni(),
    end_date: hariIni(),
    reason: '',
  });

  // window.confirm / prompt / alert DIBLOKIR di lingkungan ini — tombol yang
  // memakainya diam saja tanpa pesan apa pun. Semua lewat modal & toast sendiri.
  const [toast, setToast] = useState('');
  const [tolakUntuk, setTolakUntuk] = useState<LeaveRequest | null>(null);
  const [alasanTolak, setAlasanTolak] = useState('');
  const [tarikUntuk, setTarikUntuk] = useState<LeaveRequest | null>(null);
  const [aksiBusy, setAksiBusy] = useState(false);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 3200);
  };

  /**
   * silent = true → muat ulang tanpa menyalakan layar "Memuat…".
   * Dipakai realtime dan sesudah menyimpan; tanpa ini tiap perubahan dari
   * orang lain membuat seluruh halaman berkedip.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);

    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .order('start_date', { ascending: false });
    setRows((data as LeaveRequest[]) || []);

    // Profil dipakai untuk menentukan siapa lead & HRD seorang pemohon.
    // Tanpa role/team/vertical pemohon, tombol Setujui tidak bisa ditentukan
    // dan semua orang akan melihat tombol yang pasti ditolak database.
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, team, vertical, lead_id')
      .eq('is_active', true);

    const peta: Record<string, OrangRingkas> = {};
    ((prof as { id: string; full_name: string | null; email: string; role: Role; team: Team | null; vertical: string | null; lead_id: string | null }[]) || [])
      .forEach((u) => {
        peta[u.id] = {
          id: u.id,
          nama: u.full_name || u.email,
          role: u.role,
          team: u.team,
          vertical: u.vertical,
          lead_id: u.lead_id,
        };
      });
    setOrang(peta);

    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Realtime — layar ikut berubah begitu ada yang mengajukan, menyetujui,
   * menolak, atau menarik pengajuan. Ditunda 250 ms karena satu aksi bisa
   * memicu beberapa kejadian beruntun.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(true); }, 250);
    };
    const ch = supabase
      .channel('leave-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  const pemohonDari = useCallback(
    (o: LeaveRequest): OrangRingkas | null => orang[o.requester_id] || null,
    [orang],
  );

  /** Apakah SAYA yang harus memutus pengajuan ini SEKARANG. */
  const giliranSaya = useCallback((o: LeaveRequest): 'lead' | 'hrd' | null => {
    const p = pemohonDari(o);
    if (o.status === 'menunggu_lead' && akuLeadUntuk(profile, p)) return 'lead';
    if (o.status === 'menunggu_hrd' && akuHrdUntuk(profile, p)) return 'hrd';
    return null;
  }, [profile, pemohonDari]);

  const punyaAntrean = useMemo(
    () => rows.some((o) => giliranSaya(o) !== null),
    [rows, giliranSaya],
  );

  const terlihat = useMemo(() => {
    if (tampilan === 'saya') return rows.filter((o) => o.requester_id === profile?.id);
    if (tampilan === 'keputusan') return rows.filter((o) => giliranSaya(o) !== null);
    return rows;
  }, [rows, tampilan, profile, giliranSaya]);

  const tersaring = useMemo(
    () => terlihat.filter((o) => filter === 'all' || o.status === filter),
    [terlihat, filter],
  );

  const antreanSaya = useMemo(() => rows.filter((o) => giliranSaya(o) !== null).length, [rows, giliranSaya]);
  const pengajuanSayaJalan = useMemo(
    () => rows.filter((o) => o.requester_id === profile?.id
      && (o.status === 'menunggu_lead' || o.status === 'menunggu_hrd')).length,
    [rows, profile],
  );

  /**
   * Rekap hari yang DISETUJUI per orang.
   *
   * Ini bukan sisa jatah cuti — Alpha belum melacak jatah. Angka ini murni
   * penjumlahan hari kalender dari pengajuan yang sudah disetujui penuh,
   * supaya HRD punya gambaran tanpa harus membuka satu per satu.
   */
  const rekap = useMemo(() => {
    const peta: Record<string, { nama: string; hari: number; jml: number; per: Record<string, number> }> = {};
    terlihat.filter((o) => o.status === 'disetujui').forEach((o) => {
      const kunci = o.requester_id;
      if (!peta[kunci]) {
        peta[kunci] = { nama: o.requester_name || orang[kunci]?.nama || '—', hari: 0, jml: 0, per: {} };
      }
      const b = peta[kunci];
      b.hari += o.hari_kalender;
      b.jml += 1;
      b.per[o.kind] = (b.per[o.kind] || 0) + o.hari_kalender;
    });
    // Object.keys + map, BUKAN sebaran Map — tsconfig repo ini jatuh ke ES5.
    return Object.keys(peta)
      .map((k) => peta[k])
      .sort((a, b) => b.hari - a.hari || a.nama.localeCompare(b.nama, 'id'));
  }, [terlihat, orang]);

  const bukaBaru = () => {
    setEditId(null);
    setForm({ kind: 'cuti', start_date: hariIni(), end_date: hariIni(), reason: '' });
    setError('');
    setOpen(true);
  };

  const bukaEdit = (o: LeaveRequest) => {
    setDetail(null);
    setEditId(o.id);
    setForm({ kind: o.kind, start_date: o.start_date, end_date: o.end_date, reason: o.reason });
    setError('');
    setOpen(true);
  };

  /** Perkiraan lama pengajuan di modal, sebelum database menghitungnya. */
  const lamaForm = useMemo(() => {
    const a = new Date(form.start_date + 'T00:00:00').getTime();
    const b = new Date(form.end_date + 'T00:00:00').getTime();
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }, [form.start_date, form.end_date]);

  const simpan = async () => {
    if (!profile) return;
    if (!form.reason.trim()) { setError('Isi dulu alasannya.'); return; }
    if (lamaForm < 1) { setError('Tanggal selesai tidak boleh sebelum tanggal mulai.'); return; }
    setBusy(true); setError('');

    const isi = {
      kind: form.kind,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason.trim(),
    };

    // .select('id') WAJIB: UPDATE/INSERT yang ditolak RLS mengenai 0 baris
    // TANPA melempar error. Tanpa ini, gagal simpan terlihat seperti berhasil.
    let err;
    let kena = 1;
    if (editId) {
      const r = await supabase.from('leave_requests').update(isi).eq('id', editId).select('id');
      err = r.error; kena = r.data ? r.data.length : 0;
    } else {
      const r = await supabase.from('leave_requests').insert({
        ...isi,
        requester_id: profile.id,
        requester_name: profile.full_name || profile.email,
      }).select('id');
      err = r.error; kena = r.data ? r.data.length : 0;
    }

    setBusy(false);
    if (err) { setError(`Gagal menyimpan — ${err.message}`); return; }
    if (kena === 0) {
      setError('Tidak tersimpan — pengajuan ini sudah diputus, jadi tidak bisa diubah lagi.');
      return;
    }
    setOpen(false);
    flash(editId ? 'Pengajuan diperbarui.' : 'Pengajuan terkirim ke lead kamu.');
    load(true);
  };

  /**
   * Satu tombol untuk dua tingkat.
   *
   * Status berikutnya ditentukan dari tingkat mana yang sedang jadi giliran
   * kita — lead meloloskan ke antrean HRD, HRD baru menyetujui penuh. Siapa
   * dan kapan yang memutus TIDAK dikirim dari sini: itu distempel database,
   * supaya tidak ada yang bisa mencantumkan nama orang lain sebagai penyetuju.
   */
  const putuskan = async (o: LeaveRequest, setuju: boolean, alasan: string | null = null) => {
    const tingkat = giliranSaya(o);
    if (!tingkat) { flash('Bukan giliran kamu memutus pengajuan ini.'); return; }

    setAksiBusy(true);
    const status = setuju
      ? (tingkat === 'lead' ? 'menunggu_hrd' : 'disetujui')
      : 'ditolak';

    const { data, error: err } = await supabase
      .from('leave_requests')
      .update({ status, reject_reason: setuju ? null : alasan })
      .eq('id', o.id)
      .select('id');
    setAksiBusy(false);

    if (err) { flash(`Gagal — ${err.message}`); return; }
    if (!data || data.length === 0) {
      flash('Tidak tersimpan — kemungkinan sudah diputus orang lain lebih dulu.');
      load(true);
      return;
    }

    setDetail(null);
    setTolakUntuk(null);
    setAlasanTolak('');
    flash(setuju
      ? (tingkat === 'lead' ? 'Diteruskan ke HRD.' : 'Pengajuan disetujui.')
      : 'Pengajuan ditolak.');
    load(true);
  };

  const tarik = async (o: LeaveRequest) => {
    setAksiBusy(true);
    const { error: err } = await supabase.from('leave_requests').delete().eq('id', o.id);
    setAksiBusy(false);
    setTarikUntuk(null);
    if (err) { flash(`Gagal menarik — ${err.message}`); return; }
    setDetail(null);
    flash('Pengajuan ditarik.');
    load(true);
  };

  /** Boleh diubah/ditarik hanya selama belum diputus siapa pun. */
  const masihMilikSaya = (o: LeaveRequest) =>
    o.requester_id === profile?.id && o.status === 'menunggu_lead';

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Cuti &amp; WFH</h2>
          <span className="top-note">{tersaring.length} pengajuan</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={bukaBaru}>+ Ajukan</button>
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Pengajuan saya berjalan</div>
            <div className="kpi-value" style={{ color: 'var(--st-ide)' }}>{pengajuanSayaJalan}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Menunggu keputusan saya</div>
            <div className="kpi-value" style={{ color: antreanSaya ? 'var(--st-review)' : undefined }}>{antreanSaya}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Disetujui (terlihat)</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>
              {terlihat.filter((o) => o.status === 'disetujui').length}
            </div>
          </div>
        </div>

        <div className="team-filter" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`chip-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Semua</button>
            {(['menunggu_lead', 'menunggu_hrd', 'disetujui', 'ditolak'] as const).map((s) => (
              <button key={s} className={`chip-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                {statusCutiDef(s).label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`chip-btn ${tampilan === 'saya' ? 'active' : ''}`} onClick={() => setTampilan('saya')}>
              Pengajuan saya
            </button>
            {/* Tab antrean hanya muncul untuk yang memang punya antrean —
                buat anggota biasa tab kosong cuma bikin bingung. */}
            {punyaAntrean && (
              <button className={`chip-btn ${tampilan === 'keputusan' ? 'active' : ''}`} onClick={() => setTampilan('keputusan')}>
                Perlu keputusan saya {antreanSaya > 0 && `(${antreanSaya})`}
              </button>
            )}
            <button className={`chip-btn ${tampilan === 'semua' ? 'active' : ''}`} onClick={() => setTampilan('semua')}>
              Semua yang saya lihat
            </button>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <p className="empty">Memuat…</p> : tersaring.length === 0 ? (
            <p className="empty">
              {tampilan === 'keputusan'
                ? 'Tidak ada yang menunggu keputusan kamu.'
                : 'Belum ada pengajuan pada filter ini.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th><th>Jenis</th><th>Lama</th><th>Alasan</th>
                  <th>Pemohon</th><th>Status</th><th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {tersaring.map((o) => {
                  const giliran = giliranSaya(o);
                  const jd = jenisCutiDef(o.kind);
                  const sd = statusCutiDef(o.status);
                  return (
                    <tr key={o.id} className="tracker-row" onClick={() => setDetail(o)}>
                      <td><b>{rentang(o)}</b></td>
                      <td><span className="status-dot" style={{ background: jd.color }} />{jd.label}</td>
                      <td><b>{lama(o)}</b></td>
                      <td>
                        <span className="ot-desc-clip">{o.reason}</span>
                        {o.reject_reason && (
                          <div className="sub" style={{ color: 'var(--red)' }}>
                            Ditolak {o.reject_by === 'hrd' ? 'HRD' : 'lead'}: {o.reject_reason}
                          </div>
                        )}
                      </td>
                      <td><span className="row-avatar">{initials(o.requester_name)}</span>{o.requester_name}</td>
                      <td>
                        <span className="status-dot" style={{ background: sd.color }} />{sd.label}
                        {o.status === 'menunggu_hrd' && o.lead_name && (
                          <div className="sub">lolos lead: {o.lead_name}</div>
                        )}
                      </td>
                      <td>
                        <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                          {giliran && (
                            <>
                              <button className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
                                disabled={aksiBusy} onClick={() => putuskan(o, true)}>
                                {giliran === 'lead' ? 'Teruskan' : 'Setujui'}
                              </button>
                              <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                                disabled={aksiBusy} onClick={() => { setAlasanTolak(''); setTolakUntuk(o); }}>
                                Tolak
                              </button>
                            </>
                          )}
                          {masihMilikSaya(o) && (
                            <>
                              <button className="btn act" onClick={() => bukaEdit(o)}>Edit</button>
                              <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                                onClick={() => setTarikUntuk(o)}>Tarik</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {rekap.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 28 }}>
              Rekap Hari Disetujui
              <span className="sub" style={{ marginLeft: 8, fontWeight: 400, fontSize: 11.5 }}>
                hari kalender terpakai — bukan sisa jatah cuti
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nama</th><th>Pengajuan</th><th>Total hari</th>
                    {JENIS_CUTI.map((j) => <th key={j.key}>{j.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rekap.map((r) => (
                    <tr key={r.nama}>
                      <td><span className="row-avatar">{initials(r.nama)}</span><b>{r.nama}</b></td>
                      <td>{r.jml}×</td>
                      <td><b>{r.hari}</b></td>
                      {JENIS_CUTI.map((j) => (
                        <td key={j.key} style={{ color: r.per[j.key] ? j.color : 'var(--text-3)' }}>
                          {r.per[j.key] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="cal-legend">
          Semua user boleh mengajukan · disetujui <b>lead</b> dulu, lalu <b>HRD</b> · ditolak lead berhenti di situ,
          tidak diteruskan. Alpha belum melacak sisa jatah cuti — angka rekap adalah hari terpakai, bukan sisa.
        </p>
      </div>

      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: statusCutiDef(detail.status).color }} />
                  {jenisCutiDef(detail.kind).label} · {statusCutiDef(detail.status).label}
                </div>
                <div className="modal-title">{rentang(detail)}</div>
                <div className="modal-sub">{lama(detail)} · {detail.requester_name}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="budget-detail-label">Alasan</div>
              <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{detail.reason}</p>

              {/* Jejak dua tingkat. Ditampilkan lengkap supaya karyawan tahu
                  pengajuannya berhenti di mana dan oleh siapa. */}
              <div className="budget-detail-label" style={{ marginTop: 16 }}>Perjalanan persetujuan</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span className="status-dot" style={{
                    background: detail.lead_at
                      ? (detail.reject_by === 'lead' ? 'var(--red)' : 'var(--green)')
                      : 'var(--text-3)',
                  }} />
                  <div style={{ fontSize: 12.5 }}>
                    <b>Lead</b>{' '}
                    {detail.lead_at
                      ? `${detail.reject_by === 'lead' ? 'menolak' : 'meneruskan'} — ${detail.lead_name} · ${fmtTglJam(detail.lead_at)}`
                      : 'belum memutus'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span className="status-dot" style={{
                    background: detail.hrd_at
                      ? (detail.reject_by === 'hrd' ? 'var(--red)' : 'var(--green)')
                      : 'var(--text-3)',
                  }} />
                  <div style={{ fontSize: 12.5 }}>
                    <b>HRD</b>{' '}
                    {detail.hrd_at
                      ? `${detail.reject_by === 'hrd' ? 'menolak' : 'menyetujui'} — ${detail.hrd_name} · ${fmtTglJam(detail.hrd_at)}`
                      : (detail.reject_by === 'lead' ? 'tidak dilanjutkan' : 'belum memutus')}
                  </div>
                </div>
              </div>

              {detail.reject_reason && (
                <>
                  <div className="budget-detail-label" style={{ marginTop: 16 }}>Alasan ditolak</div>
                  <p className="thread-detail" style={{ whiteSpace: 'pre-wrap', color: 'var(--red)' }}>
                    {detail.reject_reason}
                  </p>
                </>
              )}
            </div>
            <div className="modal-foot">
              <div className="right">
                {giliranSaya(detail) && (
                  <>
                    <button className="btn" disabled={aksiBusy}
                      style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                      onClick={() => { setAlasanTolak(''); setTolakUntuk(detail); }}>Tolak</button>
                    <button className="btn primary" disabled={aksiBusy} onClick={() => putuskan(detail, true)}>
                      {giliranSaya(detail) === 'lead' ? 'Teruskan ke HRD' : 'Setujui'}
                    </button>
                  </>
                )}
                {masihMilikSaya(detail) && (
                  <button className="btn" onClick={() => bukaEdit(detail)}>Edit</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tolakUntuk && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !aksiBusy && setTolakUntuk(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Tolak pengajuan</div>
                <div className="modal-title">{tolakUntuk.requester_name}</div>
                <div className="modal-sub">
                  {jenisCutiDef(tolakUntuk.kind).label} · {rentang(tolakUntuk)} · {lama(tolakUntuk)}
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={aksiBusy} onClick={() => setTolakUntuk(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Alasan menolak</label>
                <textarea rows={3} value={alasanTolak} disabled={aksiBusy}
                  placeholder="Supaya orangnya tahu apa yang perlu diperbaiki"
                  onChange={(e) => setAlasanTolak(e.target.value)} />
                {/* Alasan diwajibkan DATABASE, bukan cuma di layar ini —
                    menolak tanpa penjelasan tidak menolong siapa pun. */}
                <div className="hint">Wajib diisi.</div>
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={aksiBusy} onClick={() => setTolakUntuk(null)}>Batal</button>
                <button className="btn" disabled={aksiBusy || !alasanTolak.trim()}
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => putuskan(tolakUntuk, false, alasanTolak.trim())}>
                  {aksiBusy ? 'Menyimpan…' : 'Tolak pengajuan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tarikUntuk && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !aksiBusy && setTarikUntuk(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Tarik pengajuan</div>
                <div className="modal-title">Tarik pengajuan ini?</div>
                <div className="modal-sub">
                  {jenisCutiDef(tarikUntuk.kind).label} · {rentang(tarikUntuk)}
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={aksiBusy} onClick={() => setTarikUntuk(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px', fontSize: 12.5, color: 'var(--text-2)' }}>
              Pengajuannya dihapus dan tidak bisa dikembalikan. Kamu masih bisa mengajukan lagi kapan saja.
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={aksiBusy} onClick={() => setTarikUntuk(null)}>Batal</button>
                <button className="btn" disabled={aksiBusy}
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => tarik(tarikUntuk)}>
                  {aksiBusy ? 'Menghapus…' : 'Tarik pengajuan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--accent)' }} />Cuti &amp; WFH</div>
                <div className="modal-title">{editId ? 'Edit Pengajuan' : 'Ajukan Cuti / WFH'}</div>
                <div className="modal-sub">
                  {editId
                    ? 'Bisa diubah selama lead belum memutus.'
                    : 'Setelah dikirim, lead kamu memutus dulu, baru HRD.'}
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={busy} onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Jenis</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {JENIS_CUTI.map((j) => (
                    <button key={j.key} type="button"
                      className={`chip-btn ${form.kind === j.key ? 'active' : ''}`}
                      onClick={() => setForm({ ...form, kind: j.key })}>
                      {j.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Mulai</label>
                  <input type="date" value={form.start_date} disabled={busy}
                    onChange={(e) => {
                      const mulai = e.target.value;
                      // Tanggal selesai ikut maju kalau jadi lebih awal dari mulai —
                      // kalau dibiarkan, tombol Simpan mati tanpa penjelasan.
                      setForm({
                        ...form,
                        start_date: mulai,
                        end_date: form.end_date < mulai ? mulai : form.end_date,
                      });
                    }} />
                </div>
                <div className="field">
                  <label>Selesai</label>
                  <input type="date" value={form.end_date} min={form.start_date} disabled={busy}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <label>Lama</label>
                  <div className="dur-pill">{lamaForm > 0 ? `${lamaForm} hari` : '—'}</div>
                </div>
              </div>

              <div className="field">
                <label>Alasan</label>
                <textarea rows={3} value={form.reason} disabled={busy}
                  placeholder="Contoh: acara keluarga di luar kota"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>

              <div className="hint">
                Lama dihitung <b>hari kalender</b>, termasuk akhir pekan. Alpha belum melacak sisa jatah cuti —
                perhitungan jatah tetap di HRD.
              </div>

              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Batal</button>
                <button className="btn primary" disabled={busy || !form.reason.trim() || lamaForm < 1} onClick={simpan}>
                  {busy ? 'Menyimpan…' : (editId ? 'Simpan perubahan' : 'Ajukan')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
