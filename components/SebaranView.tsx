'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type DistributionLog, type Profile, type Project } from '@/lib/types';

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

// hitung SHA-256 file -> hex (untuk deteksi duplikat)
async function fileHash(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_MB = 10;

export default function SebaranView({ profile, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<DistributionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'saya' | 'tim'>('saya');
  const [platFilter, setPlatFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const [form, setForm] = useState({ platform: 'whatsapp', group_names: '', content_url: '', note: '', project_id: '' });
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<DistributionLog | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const canSeeAll = profile?.role === 'manager' || profile?.role === 'superadmin';

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('distribution_logs').select('*').order('created_at', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
    const { data } = await q;
    setRows((data as DistributionLog[]) || []);
    setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    setForm({ platform: 'whatsapp', group_names: '', content_url: '', note: '', project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '') });
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
        const when = new Date(d.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        setDupWarn(`⚠️ Foto ini identik dengan bukti yang sudah pernah diunggah (${d.reporter_name || '—'} · ${when}). Pastikan ini bukti baru.`);
      }
    } catch { /* hash gagal -> lanjut tanpa cek */ }
  };

  const countGroups = (text: string) =>
    text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length || 1;

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
      group_names: form.group_names.trim(),
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
    load();
  };

  const openDetail = async (d: DistributionLog) => {
    setDetail(d);
    setProofUrl(null);
    if (d.proof_path) {
      const { data } = await supabase.storage.from('sebaran').createSignedUrl(d.proof_path, 300);
      setProofUrl(data?.signedUrl || null);
    }
  };

  const removeOwn = async (d: DistributionLog) => {
    if (!window.confirm('Hapus laporan sebaran ini?')) return;
    const { error: err } = await supabase.from('distribution_logs').delete().eq('id', d.id);
    if (err) { window.alert('Gagal menghapus.'); return; }
    setDetail(null); load();
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const isImage = (name: string | null) => !!name && /\.(png|jpe?g|webp|gif)$/i.test(name);

  const scoped = useMemo(
    () => rows.filter((r) => (scope === 'saya' ? r.reporter_id === profile?.id : true)),
    [rows, scope, profile],
  );
  const filtered = useMemo(
    () => scoped.filter((r) => platFilter === 'all' || r.platform === platFilter),
    [scoped, platFilter],
  );

  const todayKey = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const today = rows.filter((r) => r.created_at.slice(0, 10) === todayKey);
    return {
      todayCount: today.length,
      todayGroups: today.reduce((a, r) => a + (r.group_count || 0), 0),
      totalGroups: scoped.reduce((a, r) => a + (r.group_count || 0), 0),
    };
  }, [rows, scoped, todayKey]);

  // rekap per orang
  const rekap = useMemo(() => {
    const map = new Map<string, { name: string; logs: number; groups: number }>();
    rows.forEach((r) => {
      const key = r.reporter_id || r.reporter_name || '?';
      const cur = map.get(key) || { name: r.reporter_name || '—', logs: 0, groups: 0 };
      cur.logs += 1; cur.groups += r.group_count || 0;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.groups - a.groups);
  }, [rows]);

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Sebaran Harian</h2>
          <span className="top-note">{scoped.length} laporan</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={openModal}>+ Lapor sebaran</button>
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">Laporan hari ini</div><div className="kpi-value">{stats.todayCount}</div></div>
          <div className="kpi"><div className="kpi-label">Grup disebar hari ini</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.todayGroups}</div></div>
          <div className="kpi"><div className="kpi-label">Total grup ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value" style={{ fontSize: 20 }}>{stats.totalGroups}</div></div>
        </div>

        <div className="team-filter" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`chip-btn ${platFilter === 'all' ? 'active' : ''}`} onClick={() => setPlatFilter('all')}>Semua platform</button>
            {PLATFORMS.map((p) => (
              <button key={p.key} className={`chip-btn ${platFilter === p.key ? 'active' : ''}`} onClick={() => setPlatFilter(p.key)}>{p.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`chip-btn ${scope === 'saya' ? 'active' : ''}`} onClick={() => setScope('saya')}>Sebaran saya</button>
            {canSeeAll && <button className={`chip-btn ${scope === 'tim' ? 'active' : ''}`} onClick={() => setScope('tim')}>Semua tim</button>}
          </div>
        </div>

        <div className="table-wrap">
          {loading ? <p className="empty">Memuat…</p> : filtered.length === 0 ? (
            <p className="empty">Belum ada laporan sebaran pada filter ini.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Waktu lapor</th><th>Platform</th><th>Grup</th><th>Project</th><th>Pelapor</th><th>Bukti</th><th style={{ width: 90 }}></th></tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className="tracker-row" onClick={() => openDetail(d)}>
                    <td><b>{fmtDateTime(d.created_at)}</b><div className="sub" style={{ fontFamily: 'inherit' }}>timestamp server</div></td>
                    <td><span className="plat-dot" style={{ background: platMeta(d.platform).color }} />{platMeta(d.platform).label}</td>
                    <td><b>{d.group_count}</b> grup</td>
                    <td>{projName(d.project_id)}</td>
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
          )}
        </div>

        {rekap.length > 0 && scope === 'tim' && (
          <>
            <div className="section-title" style={{ marginTop: 28 }}>Rekap per Orang</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nama</th><th>Jumlah laporan</th><th>Total grup disebar</th></tr></thead>
                <tbody>
                  {rekap.map((r, i) => (
                    <tr key={i}>
                      <td><span className="row-avatar">{initials(r.name)}</span><b>{r.name}</b></td>
                      <td>{r.logs}×</td>
                      <td><b>{r.groups}</b> grup</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="cal-legend">
          Waktu lapor memakai <b>timestamp server</b> (tidak bisa diubah). Foto bukti dicek otomatis terhadap duplikat. Verifikasi akhir tetap oleh atasan.
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
                <div className="modal-sub">{fmtDateTime(detail.created_at)} · {detail.reporter_name} · {projName(detail.project_id)}</div>
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
                <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => removeOwn(detail)}>Hapus</button>
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
                <label>Nama grup / komunitas <span style={{ color: 'var(--text-3)' }}>(1 per baris, boleh banyak)</span></label>
                <textarea value={form.group_names} onChange={(e) => setForm({ ...form, group_names: e.target.value })}
                  placeholder={'Komunitas Film Indonesia\nGrup Pecinta Sinema\nInfo Film Terbaru'} rows={3} />
                <div className="hint">Terdeteksi: <b>{countGroups(form.group_names)}</b> grup</div>
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
    </>
  );
}
