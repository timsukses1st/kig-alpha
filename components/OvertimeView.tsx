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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    work_date: new Date().toISOString().slice(0, 10),
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
    setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    setForm({
      work_date: new Date().toISOString().slice(0, 10),
      start_time: '17:00', end_time: '20:00', description: '',
      project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || ''),
    });
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.description.trim()) { setError('Isi dulu apa yang dikerjakan.'); return; }
    if (form.start_time === form.end_time) { setError('Jam mulai dan selesai tidak boleh sama.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.from('overtime_requests').insert({
      project_id: form.project_id || null,
      work_date: form.work_date,
      start_time: form.start_time,
      end_time: form.end_time,
      description: form.description.trim(),
      requester_id: profile.id,
      requester_name: profile.full_name || profile.email,
    });
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
    load();
  };

  const removeOwn = async (o: OvertimeRequest) => {
    if (!window.confirm('Hapus pengajuan lembur ini?')) return;
    const { error: err } = await supabase.from('overtime_requests').delete().eq('id', o.id);
    if (err) { window.alert('Gagal menghapus.'); return; }
    load();
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  const scoped = useMemo(
    () => rows.filter((r) => (scope === 'saya' ? r.requester_id === profile?.id : true)),
    [rows, scope, profile],
  );
  const filtered = useMemo(
    () => scoped.filter((r) => filter === 'all' || r.status === filter),
    [scoped, filter],
  );

  // rekap per orang (hanya yang disetujui)
  const rekap = useMemo(() => {
    const map = new Map<string, { name: string; hours: number; count: number }>();
    rows.filter((r) => r.status === 'disetujui').forEach((r) => {
      const key = r.requester_id || r.requester_name || '?';
      const cur = map.get(key) || { name: r.requester_name || '—', hours: 0, count: 0 };
      cur.hours += durationHours(r.start_time, r.end_time);
      cur.count += 1;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.hours - a.hours);
  }, [rows]);

  const myPending = rows.filter((r) => r.status === 'diajukan' && (scope === 'tim' || r.requester_id === profile?.id)).length;

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
          <div className="kpi"><div className="kpi-label">Disetujui (pengajuan)</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{rows.filter((r) => r.status === 'disetujui').length}</div></div>
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`chip-btn ${scope === 'saya' ? 'active' : ''}`} onClick={() => setScope('saya')}>Lembur saya</button>
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
                  <tr key={o.id}>
                    <td><b>{fmtDate(o.work_date)}</b></td>
                    <td>{o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)}</td>
                    <td><b>{fmtDur(durationHours(o.start_time, o.end_time))}</b></td>
                    <td>{projName(o.project_id)}</td>
                    <td>
                      <span style={{ display: 'block', maxWidth: 260, whiteSpace: 'normal' }}>{o.description}</span>
                      {o.reject_reason && <div className="sub" style={{ color: 'var(--red)' }}>Ditolak: {o.reject_reason}</div>}
                    </td>
                    <td><span className="row-avatar">{initials(o.requester_name)}</span>{o.requester_name}</td>
                    <td><span className="status-dot" style={{ background: STATUS_META[o.status]?.color }} />{STATUS_META[o.status]?.label}</td>
                    <td>
                      <div className="recap-actions">
                        {o.status === 'diajukan' && canApprove && (
                          <>
                            <button className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => decide(o, true)}>Setujui</button>
                            <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => decide(o, false)}>Tolak</button>
                          </>
                        )}
                        {o.status === 'diajukan' && o.requester_id === profile?.id && (
                          <button className="btn act" onClick={() => removeOwn(o)}>Hapus</button>
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
            <div className="section-title" style={{ marginTop: 28 }}>Rekap Jam (disetujui)</div>
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

      {open && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--accent)' }} />Lembur</div>
                <div className="modal-title">Ajukan Lembur</div>
                <div className="modal-sub">Isi manual. Setelah diajukan, manager akan menyetujui atau menolak.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field-row">
                <div className="field">
                  <label>Tanggal</label>
                  <input type="date" value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Mulai</label>
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div className="field">
                  <label>Selesai</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <div className="hint" style={{ marginBottom: 10 }}>
                Durasi: <b>{fmtDur(durationHours(form.start_time, form.end_time))}</b>
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
                  {busy ? 'Mengirim…' : 'Ajukan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
