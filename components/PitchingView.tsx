'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PilihCari from '@/components/PilihCari';
import {
  boleh, initials, PITCH_AKTIF, PITCH_STATUS, pitchStatusDef, TUGAS,
  type Pitch, type PitchStatus, type Profile,
} from '@/lib/types';

interface Props {
  profile: Profile | null;
}

const rupiah = (n: number) => 'Rp' + (n || 0).toLocaleString('id-ID');

/** Rp 25.000.000 → "25 jt"; Rp 1.500.000.000 → "1,5 M". Untuk kartu KPI yang
 *  sempit — angka penuhnya tetap ada di tabel. */
const rupiahSingkat = (n: number): string => {
  const v = n || 0;
  if (v >= 1e9) return 'Rp' + (Math.round((v / 1e9) * 10) / 10).toLocaleString('id-ID') + ' M';
  if (v >= 1e6) return 'Rp' + Math.round(v / 1e6).toLocaleString('id-ID') + ' jt';
  return rupiah(v);
};

export default function PitchingView({ profile }: Props) {
  const [rows, setRows] = useState<Pitch[]>([]);
  const [orang, setOrang] = useState<{ id: string; nama: string; tim: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'aktif' | PitchStatus>('aktif');

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    campaign: '', brand: '', client: '', pic_id: '',
    estimated_revenue: '', status: 'listing' as PitchStatus, note: '',
  });

  const [detail, setDetail] = useState<Pitch | null>(null);
  const [confirmDel, setConfirmDel] = useState<Pitch | null>(null);
  const [actBusy, setActBusy] = useState(false);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  /**
   * Boleh menambah & mengubah.
   *
   * Cerminan policy `pitches_insert` / `pitches_update` yang memakai
   * boleh('pitching_kelola'). Sengaja lewat matriks Izin Peran, BUKAN
   * `team === 'sm'` dan kawan-kawan yang ditulis mati — supaya menambah tim
   * yang boleh cukup lewat Kelola Akses, tanpa deploy.
   */
  const bisaKelola = boleh(profile, TUGAS.pitchingKelola);
  /** Menghapus tetap superadmin saja — cerminan policy `pitches_delete`. */
  const bisaHapus = profile?.role === 'superadmin';

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('pitches').select('*').order('created_at', { ascending: false });
    setRows((data as Pitch[]) || []);

    // Daftar PIC diambil dari akun aktif, bukan diketik bebas — supaya tidak
    // ada "Fafa", "fafa", dan "Fafaa" yang tidak bisa direkap jadi satu orang.
    const { data: prof } = await supabase
      .from('profiles').select('id, full_name, email, team').eq('is_active', true);
    setOrang(
      ((prof as { id: string; full_name: string | null; email: string; team: string | null }[]) || [])
        .map((u) => ({ id: u.id, nama: u.full_name || u.email, tim: u.team }))
        .sort((a, b) => a.nama.localeCompare(b.nama, 'id')),
    );
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime: Board Pitching dibaca beberapa orang sekaligus (Pak Febry, Dewa,
  // Budi, 3 PM) — tanpa ini mereka saling menimpa tanpa sadar.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current(true); }, 250);
    };
    const ch = supabase
      .channel('pitching-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pitches' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  // Modal detail ikut segar kalau barisnya berubah dari perangkat lain.
  useEffect(() => {
    setDetail((cur) => (cur ? rows.find((r) => r.id === cur.id) || null : cur));
  }, [rows]);

  const namaOrang = (id: string | null) => orang.find((o) => o.id === id)?.nama || null;

  const openTambah = () => {
    setEditId(null);
    setForm({
      campaign: '', brand: '', client: '',
      pic_id: profile?.id || '', estimated_revenue: '',
      status: 'listing', note: '',
    });
    setError('');
    setOpen(true);
  };

  const openEdit = (p: Pitch) => {
    setDetail(null);
    setEditId(p.id);
    setForm({
      campaign: p.campaign,
      brand: p.brand || '',
      client: p.client || '',
      pic_id: p.pic_id || '',
      estimated_revenue: String(p.estimated_revenue || ''),
      status: p.status,
      note: p.note || '',
    });
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.campaign.trim()) { setError('Nama campaign wajib diisi.'); return; }
    const nilai = parseInt(form.estimated_revenue.replace(/\D/g, ''), 10) || 0;
    setBusy(true); setError('');

    const isi: Record<string, unknown> = {
      campaign: form.campaign.trim(),
      brand: form.brand.trim() || null,
      client: form.client.trim() || null,
      pic_id: form.pic_id || null,
      // Nama ikut disalin: kalau akunnya kelak dihapus, pic_id jadi NULL dan
      // riwayat pitching-nya tidak boleh ikut kehilangan nama PIC-nya.
      pic_name: form.pic_id ? namaOrang(form.pic_id) : null,
      estimated_revenue: nilai,
      status: form.status,
      note: form.note.trim() || null,
    };

    // .select('id') wajib: penolakan RLS mengenai 0 baris TANPA error, jadi
    // tanpa ini simpan yang gagal terlihat berhasil.
    let err;
    let kena = 1;
    if (editId) {
      const r = await supabase.from('pitches').update(isi).eq('id', editId).select('id');
      err = r.error; kena = r.data ? r.data.length : 0;
    } else {
      const r = await supabase.from('pitches').insert({
        ...isi,
        vertical: profile.vertical === 'ALL' ? 'KC' : (profile.vertical || 'KC'),
        created_by: profile.id,
        created_by_name: profile.full_name || profile.email,
      }).select('id');
      err = r.error; kena = r.data ? r.data.length : 0;
    }
    setBusy(false);
    if (err || kena === 0) {
      setError(err
        ? `Gagal menyimpan: ${err.message}`
        : 'Tidak tersimpan — akunmu tidak punya izin mengubah Board Pitching.');
      return;
    }
    setOpen(false);
    flashToast(editId ? 'Perubahan tersimpan.' : 'Pitching ditambahkan.');
    load(true);
  };

  /** Pindah tahap langsung dari tabel, tanpa membuka modal. */
  const gantiStatus = async (p: Pitch, status: PitchStatus) => {
    const { data, error: err } = await supabase
      .from('pitches').update({ status }).eq('id', p.id).select('id');
    if (err || !data || data.length === 0) {
      flashToast('Gagal mengubah tahap — cek wewenang akunmu.');
      load(true);
      return;
    }
    flashToast(`Tahap diubah ke "${pitchStatusDef(status).label}".`);
    load(true);
  };

  const doDelete = async () => {
    const p = confirmDel;
    if (!p) return;
    setActBusy(true);
    const { data, error: err } = await supabase
      .from('pitches').delete().eq('id', p.id).select('id');
    setActBusy(false);
    setConfirmDel(null);
    if (err || !data || data.length === 0) {
      flashToast('Gagal menghapus — hanya superadmin.');
      return;
    }
    setDetail(null);
    flashToast('Pitching dihapus.');
    load(true);
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'aktif') return PITCH_AKTIF.indexOf(r.status) !== -1;
    return r.status === filter;
  }), [rows, filter]);

  const stats = useMemo(() => {
    const aktif = rows.filter((r) => PITCH_AKTIF.indexOf(r.status) !== -1);
    const perStatus: Record<string, number> = {};
    rows.forEach((r) => { perStatus[r.status] = (perStatus[r.status] || 0) + 1; });
    return {
      jumlahAktif: aktif.length,
      nilaiAktif: aktif.reduce((a, r) => a + (r.estimated_revenue || 0), 0),
      // Waiting Confirm dipisah sebagai kartu sendiri: itu yang paling dekat
      // jadi uang, dan yang paling perlu ditagih kalau menggantung terlalu lama.
      nilaiMenunggu: rows.filter((r) => r.status === 'waiting_confirm')
        .reduce((a, r) => a + (r.estimated_revenue || 0), 0),
      perStatus,
    };
  }, [rows]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  const picOptions = useMemo(
    () => orang.map((o) => ({ id: o.id, label: o.nama, sub: o.tim || undefined })),
    [orang],
  );

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Board Pitching</h2>
          <span className="top-note">{filtered.length} dari {rows.length} pitching</span>
        </div>
        <div className="top-actions">
          {bisaKelola && <button className="btn primary" onClick={openTambah}>+ Pitching baru</button>}
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Pitching berjalan</div>
            <div className="kpi-value">{stats.jumlahAktif}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Nilai pipeline</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>{rupiahSingkat(stats.nilaiAktif)}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Menunggu konfirmasi</div>
            <div className="kpi-value" style={{ fontSize: 20, color: 'var(--st-review)' }}>
              {rupiahSingkat(stats.nilaiMenunggu)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Cancel</div>
            <div className="kpi-value" style={{ color: 'var(--red)' }}>{stats.perStatus.cancel || 0}</div>
          </div>
        </div>

        <div className="team-filter" style={{ flexWrap: 'wrap' }}>
          <button className={`chip-btn ${filter === 'aktif' ? 'active' : ''}`} onClick={() => setFilter('aktif')}>
            Berjalan ({stats.jumlahAktif})
          </button>
          <button className={`chip-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            Semua ({rows.length})
          </button>
          {PITCH_STATUS.map((s) => (
            <button
              key={s.key}
              className={`chip-btn ${filter === s.key ? 'active' : ''}`}
              onClick={() => setFilter(s.key)}
              style={filter === s.key ? { borderColor: s.color, color: s.color } : undefined}
            >
              <span className="status-dot" style={{ background: s.color }} />
              {s.label} ({stats.perStatus[s.key] || 0})
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? <p className="empty">Memuat…</p> : filtered.length === 0 ? (
            <p className="empty">
              {rows.length === 0
                ? 'Belum ada pitching yang dicatat.'
                : 'Tidak ada pitching pada filter ini.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Campaign</th><th>Brand / PH</th><th>Klien / Agency</th>
                  <th>PIC</th><th>Est. Revenue</th><th>Status</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const def = pitchStatusDef(p.status);
                  return (
                    <tr key={p.id} className="tracker-row" onClick={() => setDetail(p)}>
                      <td>
                        <b>{p.campaign}</b>
                        {p.note && (
                          <div className="sub" style={{ fontFamily: 'inherit' }}>
                            {p.note.slice(0, 70)}{p.note.length > 70 ? '…' : ''}
                          </div>
                        )}
                      </td>
                      <td>{p.brand || <span className="sub">—</span>}</td>
                      <td>{p.client || <span className="sub">—</span>}</td>
                      <td>
                        {(p.pic_name || namaOrang(p.pic_id)) ? (
                          <>
                            <span className="row-avatar">{initials(p.pic_name || namaOrang(p.pic_id))}</span>
                            {p.pic_name || namaOrang(p.pic_id)}
                          </>
                        ) : <span className="sub">—</span>}
                      </td>
                      <td><b>{rupiah(p.estimated_revenue)}</b></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {bisaKelola ? (
                          <select
                            value={p.status}
                            onChange={(e) => gantiStatus(p, e.target.value as PitchStatus)}
                            style={{ color: def.color, borderColor: def.color, fontWeight: 600 }}
                          >
                            {PITCH_STATUS.map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <span className="status-dot" style={{ background: def.color }} />
                            {def.label}
                          </>
                        )}
                      </td>
                      <td>
                        <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn act" onClick={() => setDetail(p)}>Detail</button>
                          {bisaKelola && <button className="btn act" onClick={() => openEdit(p)}>✎ Edit</button>}
                          {bisaHapus && (
                            <button
                              className="btn act"
                              style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                              onClick={() => setConfirmDel(p)}
                            >Hapus</button>
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

        <div className="cal-legend" style={{ maxWidth: 760 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div>
              <b>Tahapnya</b> — Listing → Deck Strategy → Offering → Waiting Confirm.
              <b> Hold</b> untuk yang ditahan sementara, <b>Cancel</b> untuk yang batal.
            </div>
            <div>
              <b>Nilai pipeline</b> — jumlah Est. Revenue semua pitching yang masih berjalan.
              Hold ikut dihitung; ditahan bukan berarti batal. Cancel tidak.
            </div>
            <div>
              <b>Siapa yang bisa</b> — diatur di Kelola Akses → Izin Peran, kelompok <b>Pitching</b>.
              Bawaannya Pimpinan, HO, LO, SM, dan PM. Menghapus tetap superadmin saja.
            </div>
            <div>
              Perubahan tahap dan nilai tercatat di <b>Log Aktivitas</b>. Pitching yang batal
              cukup diberi status <b>Cancel</b> — riwayat penawarannya masih berguna nanti.
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Detail ---------------- */}
      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: pitchStatusDef(detail.status).color }} />
                  Pitching · {pitchStatusDef(detail.status).label}
                </div>
                <div className="modal-title">{detail.campaign}</div>
                <div className="modal-sub">{rupiah(detail.estimated_revenue)}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="budget-detail-label">Brand / PH</div>
              <p className="thread-detail">{detail.brand || '—'}</p>

              <div className="budget-detail-label" style={{ marginTop: 14 }}>Klien / Agency</div>
              <p className="thread-detail">{detail.client || '—'}</p>

              <div className="budget-detail-label" style={{ marginTop: 14 }}>PIC</div>
              <p className="thread-detail">{detail.pic_name || namaOrang(detail.pic_id) || '—'}</p>

              {detail.note && (
                <>
                  <div className="budget-detail-label" style={{ marginTop: 14 }}>Keterangan</div>
                  <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{detail.note}</p>
                </>
              )}

              <div className="budget-detail-label" style={{ marginTop: 16 }}>Riwayat</div>
              <div className="budget-trace">
                <div><b>Dicatat</b> oleh {detail.created_by_name || '—'} · {fmt(detail.created_at)}</div>
                {detail.updated_at !== detail.created_at && (
                  <div><b>Terakhir diubah</b> · {fmt(detail.updated_at)}</div>
                )}
              </div>
            </div>
            <div className="modal-foot">
              {bisaKelola && <button className="btn" onClick={() => openEdit(detail)}>✎ Edit</button>}
              {bisaHapus && (
                <button
                  className="btn"
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => setConfirmDel(detail)}
                >Hapus</button>
              )}
              <div className="right">
                <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Tambah / Edit ---------------- */}
      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
          <div className="modal" style={{ maxWidth: 470 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />Pitching
                </div>
                <div className="modal-title">{editId ? 'Edit Pitching' : 'Pitching Baru'}</div>
                <div className="modal-sub">
                  Catatan penawaran ke calon klien — sebelum jadi project.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={busy} onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Nama campaign</label>
                <input
                  value={form.campaign}
                  onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                  placeholder="mis. Ramadan Campaign 2027"
                  autoFocus
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Nama brand / PH</label>
                  <input
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    placeholder="mis. Rexona"
                  />
                </div>
                <div className="field">
                  <label>Nama klien / agency</label>
                  <input
                    value={form.client}
                    onChange={(e) => setForm({ ...form, client: e.target.value })}
                    placeholder="mis. Mindshare"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>PIC</label>
                  <PilihCari
                    value={form.pic_id}
                    options={picOptions}
                    kosongLabel="— belum ditentukan —"
                    placeholder="Ketik nama…"
                    onChange={(id) => setForm({ ...form, pic_id: id })}
                  />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as PitchStatus })}
                    style={{ color: pitchStatusDef(form.status).color, fontWeight: 600 }}
                  >
                    {PITCH_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Estimated revenue (Rp)</label>
                <input
                  value={form.estimated_revenue}
                  inputMode="numeric"
                  onChange={(e) => setForm({ ...form, estimated_revenue: e.target.value.replace(/\D/g, '') })}
                  placeholder="25000000"
                />
                {form.estimated_revenue && (
                  <div className="hint">{rupiah(parseInt(form.estimated_revenue, 10) || 0)}</div>
                )}
              </div>
              <div className="field">
                <label>Keterangan <span style={{ color: 'var(--text-3)' }}>(opsional)</span></label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="mis. menunggu revisi deck dari klien, target closing akhir bulan"
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button
                  className="btn primary"
                  onClick={submit}
                  disabled={busy || !form.campaign.trim()}
                >
                  {busy ? 'Menyimpan…' : (editId ? 'Simpan perubahan' : 'Tambahkan')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Konfirmasi hapus ---------------- */}
      {confirmDel && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !actBusy && setConfirmDel(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Hapus pitching</div>
                <div className="modal-title">{confirmDel.campaign}</div>
                <div className="modal-sub">
                  {confirmDel.client || confirmDel.brand || '—'} · {rupiah(confirmDel.estimated_revenue)}
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={actBusy} onClick={() => setConfirmDel(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail">
                Terhapus permanen. Kalau cuma batal, lebih baik ubah statusnya jadi <b>Cancel</b> —
                riwayat penawarannya masih berguna untuk pitching berikutnya ke klien yang sama.
              </p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setConfirmDel(null)} disabled={actBusy}>Batal</button>
                <button
                  className="btn primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={doDelete}
                  disabled={actBusy}
                >
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
