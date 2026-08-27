'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type Profile, type Project, type RecapReport } from '@/lib/types';

interface Props {
  profile: Profile | null;
  projects: Project[];
  projectFilter: string;
}

const MAX_MB = 20;

const detectLinkType = (url: string): string => {
  const u = url.toLowerCase();
  if (u.includes('docs.google.com/presentation')) return 'slides';
  if (u.includes('docs.google.com/document')) return 'docs';
  if (u.includes('docs.google.com/spreadsheets')) return 'sheets';
  if (u.includes('drive.google.com')) return 'drive';
  return 'lainnya';
};

const LINK_LABEL: Record<string, string> = {
  slides: 'Google Slides',
  docs: 'Google Docs',
  sheets: 'Google Sheets',
  drive: 'Google Drive',
  lainnya: 'Link',
};

// ubah URL Google Slides jadi versi embed untuk pratinjau
const toEmbed = (url: string): string | null => {
  const m = url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`;
  const d = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (d) return `https://docs.google.com/document/d/${d[1]}/preview`;
  const s = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (s) return `https://docs.google.com/spreadsheets/d/${s[1]}/preview`;
  return null;
};

const fmtSize = (b: number | null) => {
  if (!b) return '—';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
};

export default function RecapView({ profile, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<RecapReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', period: '', note: '', project_id: '', link_url: '' });
  const [preview, setPreview] = useState<RecapReport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- notifikasi & konfirmasi in-app (window.confirm/alert diblokir di browser) ---
  const [toast, setToast] = useState('');
  const [confirmDel, setConfirmDel] = useState<RecapReport | null>(null);
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
    let q = supabase.from('recap_reports').select('*').order('created_at', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
    const { data } = await q;
    setRows((data as RecapReport[]) || []);
    if (!silent) setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: laporan baru / dihapus oleh anggota lain ---
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current(true); }, 250);
    };
    const ch = supabase
      .channel('recap-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recap_reports' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  // Tutup pratinjau otomatis kalau laporannya sudah dihapus orang lain.
  useEffect(() => {
    setPreview((cur) => (cur ? rows.find((r) => r.id === cur.id) || null : cur));
  }, [rows]);

  const openModal = () => {
    setForm({
      title: '',
      period: '',
      note: '',
      project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || ''),
      link_url: '',
    });
    setFile(null);
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.title.trim()) { setError('Judul laporan wajib diisi.'); return; }
    const link = form.link_url.trim();
    if (!link && !file) { setError('Isi link Google Slides atau unggah file — salah satu wajib ada.'); return; }
    if (link && !/^https?:\/\//i.test(link)) { setError('Link harus diawali https://'); return; }
    if (file && file.size > MAX_MB * 1024 * 1024) {
      setError(`Ukuran file maksimal ${MAX_MB} MB. Untuk file besar, unggah ke Drive lalu tempel linknya di catatan.`);
      return;
    }
    setBusy(true);
    setError('');

    let filePath: string | null = null;
    if (file) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_');
      filePath = `${form.project_id || 'umum'}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from('reports').upload(filePath, file);
      if (up.error) {
        setBusy(false);
        setError('Gagal mengunggah file. Cek koneksi atau ukuran file.');
        return;
      }
    }

    const { error: err } = await supabase.from('recap_reports').insert({
      project_id: form.project_id || null,
      title: form.title.trim(),
      period: form.period.trim() || null,
      note: form.note.trim() || null,
      file_path: filePath,
      file_name: file?.name || null,
      file_size: file?.size || null,
      link_url: link || null,
      link_type: link ? detectLinkType(link) : null,
      uploaded_by: profile.id,
      uploader_name: profile.full_name || profile.email,
    });
    setBusy(false);
    if (err) { setError('Gagal menyimpan data laporan.'); return; }
    setOpen(false);
    flashToast('Laporan tersimpan.');
    load(true);
  };

  const download = async (r: RecapReport) => {
    if (!r.file_path) return;
    const { data, error: err } = await supabase.storage.from('reports').createSignedUrl(r.file_path, 60);
    if (err || !data) { flashToast('Gagal membuka file.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const doDelete = async () => {
    const r = confirmDel;
    if (!r) return;
    setActBusy(true);
    if (r.file_path) await supabase.storage.from('reports').remove([r.file_path]);
    const { error: err } = await supabase.from('recap_reports').delete().eq('id', r.id);
    setActBusy(false);
    if (err) { setConfirmDel(null); flashToast('Gagal menghapus — hanya pengunggah atau lead.'); return; }
    setConfirmDel(null);
    flashToast('Laporan dihapus.');
    load(true);
  };

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';
  const canDelete = (r: RecapReport) =>
    profile?.id === r.uploaded_by || profile?.role === 'superadmin' || profile?.role === 'manager';

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Recap Report</h2>
          <span className="top-note">{rows.length} laporan</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={openModal}>+ Unggah laporan</button>
        </div>
      </div>

      <div className="content-area">
        <div className="table-wrap">
          {loading ? (
            <p className="empty">Memuat laporan…</p>
          ) : rows.length === 0 ? (
            <p className="empty">Belum ada laporan. Unggah rekap mingguan/bulanan agar tersimpan rapi per project.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Laporan</th><th>Project</th><th>Periode</th><th>Berkas</th><th>Diunggah</th><th style={{ width: 210 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.title}</b>
                      {r.note && <div className="sub" style={{ fontFamily: 'inherit' }}>{r.note}</div>}
                    </td>
                    <td>{projName(r.project_id)}</td>
                    <td>{r.period || '—'}</td>
                    <td>
                      {r.link_url && (
                        <div className="link-tag">{LINK_LABEL[r.link_type || 'lainnya']}</div>
                      )}
                      {r.file_name && (
                        <>
                          <div style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.file_name}</div>
                          <div className="sub">{fmtSize(r.file_size)}</div>
                        </>
                      )}
                      {!r.link_url && !r.file_name && '—'}
                    </td>
                    <td>
                      <span className="row-avatar">{initials(r.uploader_name)}</span>
                      {r.uploader_name}
                      <div className="sub" style={{ marginLeft: 40 }}>
                        {new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}
                        {new Date(r.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>
                      <div className="recap-actions">
                        {r.link_url && toEmbed(r.link_url) && (
                          <button className="btn act" onClick={() => setPreview(r)}>▶ Lihat</button>
                        )}
                        {r.link_url && (
                          <a className="btn act" href={r.link_url} target="_blank" rel="noopener noreferrer">Buka ↗</a>
                        )}
                        {r.file_path && <button className="btn act" onClick={() => download(r)}>↓ Unduh</button>}
                        {canDelete(r) && (
                          <button className="icon-del" title="Hapus laporan" onClick={() => setConfirmDel(r)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="cal-legend">
          Laporan bisa berupa <b>link Google Slides/Docs/Sheets</b> (bisa dipratinjau langsung di sini) atau file unggahan maks {MAX_MB} MB.
          File video sebaiknya tetap di Drive — cukup tempel linknya.
        </p>
      </div>

      {preview && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal preview-modal">
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  {LINK_LABEL[preview.link_type || 'lainnya']}
                </div>
                <div className="modal-title">{preview.title}</div>
                <div className="modal-sub">{preview.period || 'Tanpa periode'} · {projName(preview.project_id)}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="preview-frame">
              <iframe
                src={toEmbed(preview.link_url || '') || ''}
                title={preview.title}
                allowFullScreen
              />
            </div>
            <div className="modal-foot">
              <span className="foot-note">Pratinjau hanya tampil bila akses link terbuka untuk tim.</span>
              <div className="right">
                <a className="btn" href={preview.link_url || '#'} target="_blank" rel="noopener noreferrer">Buka di tab baru ↗</a>
                <button className="btn primary" onClick={() => setPreview(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  Recap Report
                </div>
                <div className="modal-title">Unggah Laporan</div>
                <div className="modal-sub">Arsip laporan per project — bisa diunduh anggota tim yang punya akses project ini.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Judul laporan</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="mis. Rekap performa konten Juli"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Project</label>
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                    <option value="">— umum —</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Periode</label>
                  <input
                    value={form.period}
                    onChange={(e) => setForm({ ...form, period: e.target.value })}
                    placeholder="mis. Juli 2026"
                  />
                </div>
              </div>
              <div className="field">
                <label>
                  Link Google Slides / Docs / Sheets
                  {/^https?:\/\//i.test(form.link_url.trim()) && (
                    <a className="open-link" href={form.link_url.trim()} target="_blank" rel="noopener noreferrer">Buka ↗</a>
                  )}
                </label>
                <input
                  value={form.link_url}
                  onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                  placeholder="https://docs.google.com/presentation/d/…"
                />
                <div className="hint">
                  Pastikan akses link disetel &ldquo;siapa saja yang memiliki link&rdquo; agar tim bisa membuka.
                </div>
              </div>
              <div className="field">
                <label>Atau unggah file</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.docx,.pptx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <div className="hint">{file ? `${file.name} · ${fmtSize(file.size)}` : `Opsional · maks ${MAX_MB} MB`}</div>
              </div>
              <div className="field">
                <label>Catatan</label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Ringkasan singkat / link Drive bila file besar"
                />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.title.trim()}>
                  {busy ? 'Mengunggah…' : 'Simpan'}
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
                <div className="modal-title">{confirmDel.title}</div>
                <div className="modal-sub">{projName(confirmDel.project_id)} · {confirmDel.uploader_name}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setConfirmDel(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail">
                Laporan ini akan dihapus permanen{confirmDel.file_path ? ', termasuk berkas yang diunggah' : ''}. Tindakan ini tidak bisa dibatalkan.
              </p>
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
