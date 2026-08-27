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
  const [catFilter, setCatFilter] = useState('all');
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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let q = supabase.from('distribution_logs').select('*').order('created_at', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
    const { data } = await q;
    setRows((data as DistributionLog[]) || []);
    if (!silent) setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: laporan sebaran dari anggota lain ---
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current(true); }, 250);
    };
    const ch = supabase
      .channel('sebaran-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'distribution_logs' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  // Tutup modal detail otomatis kalau barisnya sudah dihapus orang lain.
  useEffect(() => {
    setDetail((cur) => (cur ? rows.find((r) => r.id === cur.id) || null : cur));
  }, [rows]);

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
      .split(/[\n,;|/\u2022\u00b7]+/)
      .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*+>])\s*/, '').trim())
      .filter(Boolean)
      .forEach((s) => {
        const key = s.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) { seen.add(key); out.push(s); }
      });
    return out;
  };

  const countGroups = (text: string) => parseGroups(text).length || 1;

  // Kunci tanggal versi WIB (UTC+7) — batas hari jam 00.00 WIB, bukan 07.00
  const wibKey = (iso: string) =>
    new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

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
    load(true);
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
    const { error: err } = await supabase.from('distribution_logs').delete().eq('id', d.id);
    setActBusy(false);
    if (err) { setConfirmDel(null); flashToast('Gagal menghapus — hanya pelapor atau superadmin.'); return; }
    setConfirmDel(null); setDetail(null);
    flashToast('Laporan sebaran dihapus.');
    load(true);
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
  const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const isImage = (name: string | null) => !!name && /\.(png|jpe?g|webp|gif)$/i.test(name);

  const scoped = useMemo(
    () => rows.filter((r) => (scope === 'saya' ? r.reporter_id === profile?.id : true)),
    [rows, scope, profile],
  );
  const filtered = useMemo(
    () => scoped.filter((r) =>
      (platFilter === 'all' || r.platform === platFilter)
      && (catFilter === 'all' || r.content_category === catFilter)),
    [scoped, platFilter, catFilter],
  );

  const todayKey = wibKey(new Date().toISOString());
  const stats = useMemo(() => {
    // pakai `scoped` agar konsisten dengan toggle "Sebaran saya / Semua tim"
    const today = scoped.filter((r) => wibKey(r.created_at) === todayKey);
    return {
      todayCount: today.length,
      todayGroups: today.reduce((a, r) => a + (r.group_count || 0), 0),
      totalGroups: scoped.reduce((a, r) => a + (r.group_count || 0), 0),
    };
  }, [scoped, todayKey]);

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
          <div className="kpi"><div className="kpi-label">Laporan hari ini ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value">{stats.todayCount}</div></div>
          <div className="kpi"><div className="kpi-label">Grup hari ini ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.todayGroups}</div></div>
          <div className="kpi"><div className="kpi-label">Total grup ({scope === 'saya' ? 'saya' : 'tim'})</div><div className="kpi-value" style={{ fontSize: 20 }}>{stats.totalGroups}</div></div>
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
