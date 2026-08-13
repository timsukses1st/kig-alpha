'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type OvertimeRequest, type Profile, type Project } from '@/lib/types';

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
    description: '', project_id: '',
  });

  const canApprove = profile?.role === 'manager' || profile?.role === 'superadmin';

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('overtime_requests').select('*').order('work_date', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
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

    setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    setEditId(null);
    setForm({
      work_date: todayLocal(),
      start_time: '17:00', end_time: '20:00', description: '',
      project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || ''),
    });
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
      project_id: o.project_id || '',
    });
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.description.trim()) { setError('Isi dulu apa yang dikerjakan.'); return; }
    if (form.start_time === form.end_time) { setError('Jam mulai dan selesai tidak boleh sama.'); return; }
    setBusy(true); setError('');
    const payload = {
      project_id: form.project_id || null,
      work_date: form.work_date,
      start_time: form.start_time,
      end_time: form.end_time,
      description: form.description.trim(),
    };
    let err;
    if (editId) {
      ({ error: err } = await supabase.from('overtime_requests').update(payload).eq('id', editId));
    } else {
      ({ error: err } = await supabase.from('overtime_requests').insert({
        ...payload, requester_id: profile.id, requester_name: profile.full_name || profile.email,
      }));
    }
    setBusy(false);
    if (err) { setError('Gagal menyimpan pengajuan.'); return; }
    setOpen(false);
    load();
  };

  const decide = async (o: OvertimeRequest, approve: boolean) => {
    if (!profile) return;
    let reason: string | null = null;
    if (!approve) {
      const r = window.prompt('Alasan menolak (opsional):');
      if (r === null) return;
      reason = r || null;
    }
    const { error: err } = await supabase.from('overtime_requests').update({
      status: approve ? 'disetujui' : 'ditolak',
      approver_id: profile.id,
      approver_name: profile.full_name || profile.email,
      decided_at: new Date().toISOString(),
      reject_reason: reason,
    }).eq('id', o.id);
    if (err) { window.alert('Gagal — hanya manager yang bisa menyetujui.'); return; }
    setDetail(null); load();
  };

  const removeOwn = async (o: OvertimeRequest) => {
    if (!window.confirm('Hapus pengajuan lembur ini?')) return;
    const { error: err } = await supabase.from('overtime_requests').delete().eq('id', o.id);
    if (err) { window.alert('Gagal menghapus.'); return; }
    load();
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
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
    const map = new Map<string, { name: string; hours: number; count: number }>();
    scoped.filter((r) => r.status === 'disetujui').forEach((r) => {
      const key = r.requester_id || r.requester_name || '?';
      const cur = map.get(key) || { name: r.requester_name || '—', hours: 0, count: 0 };
      cur.hours += durationHours(r.start_time, r.end_time);
      cur.count += 1;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.hours - a.hours);
  }, [scoped]);

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
                    <td>{projName(o.project_id)}</td>
                    <td>
                      <span className="ot-desc-clip">{o.description}</span>
                      {o.reject_reason && <div className="sub" style={{ color: 'var(--red)' }}>Ditolak: {o.reject_reason}</div>}
                    </td>
                    <td><span className="row-avatar">{initials(o.requester_name)}</span>{o.requester_name}</td>
                    <td><span className="status-dot" style={{ background: STATUS_META[o.status]?.color }} />{STATUS_META[o.status]?.label}</td>
                    <td>
                      <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                        {o.status === 'diajukan' && canApprove && (
                          <>
                            <button className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => decide(o, true)}>Setujui</button>
                            <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => decide(o, false)}>Tolak</button>
                          </>
                        )}
                        {o.status === 'diajukan' && o.requester_id === profile?.id && (
                          <>
                            <button className="btn act" onClick={() => openEdit(o)}>Edit</button>
                            <button className="btn act" onClick={() => removeOwn(o)}>Hapus</button>
                          </>
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
                  {rekap.map((r, i) => (
                    <tr key={i}>
                      <td><span className="row-avatar">{initials(r.name)}</span><b>{r.name}</b></td>
                      <td>{r.count}×</td>
                      <td><b>{fmtDur(r.hours)}</b></td>
                    </tr>
                  ))}
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
                  {detail.start_time.slice(0,5)}–{detail.end_time.slice(0,5)} · {fmtDur(durationHours(detail.start_time, detail.end_time))} · {projName(detail.project_id)}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="budget-detail-label">Yang dikerjakan</div>
              <p className="thread-detail" style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</p>
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
                  <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => decide(detail, false)}>Tolak</button>
                  <button className="btn primary" onClick={() => decide(detail, true)}>✓ Setujui</button>
                </>
              )}
              {detail.status === 'diajukan' && detail.requester_id === profile?.id && (
                <button className="btn" onClick={() => openEdit(detail)}>✎ Edit</button>
              )}
              <div className="right">
                <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <label>Project terkait</label>
                <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                  <option value="">— umum —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
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
    </>
  );
}
