'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type BudgetRequest, type Profile, type Project } from '@/lib/types';

interface Props {
  profile: Profile | null;
  projects: Project[];
  projectFilter: string;
}

const CATEGORIES = [
  { key: 'ads', label: 'Ads' },
  { key: 'boosting', label: 'Boosting' },
  { key: 'langganan', label: 'Langganan Tools' },
  { key: 'buzzer', label: 'Buzzer' },
  { key: 'clipper', label: 'Clipper' },
  { key: 'homeless', label: 'Homeless (media paid)' },
  { key: 'kol', label: 'KOL' },
  { key: 'lainnya', label: 'Lainnya' },
];
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || k;

const STATUS_META: Record<string, { label: string; color: string }> = {
  diajukan: { label: 'Diajukan', color: 'var(--st-review)' },
  disetujui: { label: 'Disetujui (ke Finance)', color: 'var(--amber)' },
  dibayar: { label: 'Dibayar', color: 'var(--green)' },
  ditolak: { label: 'Ditolak', color: 'var(--red)' },
};

const MAX_MB = 10;
const rupiah = (n: number) => 'Rp' + (n || 0).toLocaleString('id-ID');

export default function BudgetView({ profile, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<BudgetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'diajukan' | 'disetujui' | 'dibayar' | 'ditolak'>('all');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', category: 'ads', amount: '', description: '', urgency: 'normal', project_id: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<BudgetRequest | null>(null);
  const [reqProofUrl, setReqProofUrl] = useState<string | null>(null);
  const [payProofUrl, setPayProofUrl] = useState<string | null>(null);

  // --- notifikasi & konfirmasi in-app (window.alert/prompt diblokir di browser) ---
  const [toast, setToast] = useState('');
  const [rejectFor, setRejectFor] = useState<BudgetRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmDel, setConfirmDel] = useState<BudgetRequest | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const isPM = profile?.team === 'pm' || profile?.role === 'superadmin';
  const isFinance = profile?.team === 'finance' || profile?.role === 'superadmin';
  const canRequest = profile?.role === 'tim' || profile?.role === 'manager' || profile?.role === 'superadmin';

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    let q = supabase.from('budget_requests').select('*').order('created_at', { ascending: false });
    if (projectFilter !== 'all') q = q.eq('project_id', projectFilter);
    const { data } = await q;
    setRows((data as BudgetRequest[]) || []);
    if (!silent) setLoading(false);
  }, [projectFilter]);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: dengarkan perubahan budget_requests dari user lain ---
  // Pakai ref supaya channel tidak di-subscribe ulang tiap kali projectFilter ganti.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current(true); }, 250);
    };
    const ch = supabase
      .channel('budget-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_requests' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  // Kalau modal detail sedang terbuka, ikut segarkan isinya saat data berubah.
  useEffect(() => {
    setDetail((cur) => (cur ? rows.find((r) => r.id === cur.id) || cur : cur));
  }, [rows]);

  const openModal = () => {
    setEditId(null);
    setForm({ title: '', category: 'ads', amount: '', description: '', urgency: 'normal', project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '') });
    setFile(null);
    setError('');
    setOpen(true);
  };

  const openEdit = (b: BudgetRequest) => {
    setEditId(b.id);
    setForm({
      title: b.title,
      category: b.category,
      amount: String(b.amount || ''),
      description: b.description || '',
      urgency: b.urgency || 'normal',
      project_id: b.project_id || '',
    });
    setFile(null);
    setError('');
    setDetail(null);
    setOpen(true);
  };

  const canEdit = (b: BudgetRequest) =>
    b.status === 'diajukan' && (b.requester_id === profile?.id || profile?.role === 'superadmin');

  // Cerminan persis policy RLS "budget_delete" di database: superadmin saja.
  // Kalau tombolnya ditampilkan lebih longgar dari policy, user akan menekan
  // tombol yang "berhasil" tapi tidak menghapus apa pun.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const bolehHapus = (_b: BudgetRequest) => profile?.role === 'superadmin';

  const doDelete = async () => {
    const b = confirmDel;
    if (!b) return;
    setActBusy(true);

    // Bersihkan bukti di storage dulu supaya tidak jadi sampah yang tetap kena kuota.
    const berkas = [b.request_proof_path, b.payment_proof_path].filter(Boolean) as string[];
    if (berkas.length) await supabase.storage.from('budget').remove(berkas);

    // .select() dipakai supaya kita tahu baris benar-benar terhapus. Tanpa ini,
    // RLS yang menolak akan menghapus 0 baris TANPA error — tombol terlihat sukses.
    const { data, error: err } = await supabase
      .from('budget_requests').delete().eq('id', b.id).select('id');
    setActBusy(false);

    if (err) { setConfirmDel(null); flashToast('Gagal menghapus: ' + err.message); return; }
    if (!data || data.length === 0) {
      setConfirmDel(null);
      flashToast('Tidak ada data yang terhapus — wewenang akunmu tidak mencukupi untuk pengajuan ini.');
      load(true);
      return;
    }

    setConfirmDel(null); setDetail(null);
    flashToast('Pengajuan dihapus.');
    load(true);
  };

  const uploadProof = async (f: File, prefix: string): Promise<{ path: string; name: string } | null> => {
    const safe = f.name.replace(/[^\w.\-]+/g, '_');
    const path = `${prefix}/${Date.now()}_${safe}`;
    const up = await supabase.storage.from('budget').upload(path, f);
    if (up.error) return null;
    return { path, name: f.name };
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.title.trim()) { setError('Judul wajib diisi.'); return; }
    const amount = parseInt(form.amount.replace(/\D/g, ''), 10) || 0;
    if (amount <= 0) { setError('Jumlah harus lebih dari 0.'); return; }
    if (file && file.size > MAX_MB * 1024 * 1024) { setError(`Bukti maksimal ${MAX_MB} MB.`); return; }
    setBusy(true); setError('');

    let proof: { path: string; name: string } | null = null;
    if (file) {
      proof = await uploadProof(file, 'request');
      if (!proof) { setBusy(false); setError('Gagal mengunggah bukti.'); return; }
    }

    if (editId) {
      // update — hanya field yang boleh diubah; bukti hanya diganti kalau upload baru
      const patch: Record<string, unknown> = {
        project_id: form.project_id || null,
        category: form.category,
        title: form.title.trim(),
        description: form.description.trim() || null,
        amount,
        urgency: form.urgency,
      };
      if (proof) { patch.request_proof_path = proof.path; patch.request_proof_name = proof.name; }
      const { error: err } = await supabase.from('budget_requests').update(patch).eq('id', editId);
      setBusy(false);
      if (err) { setError('Gagal menyimpan perubahan.'); return; }
      setOpen(false);
      flashToast('Perubahan pengajuan tersimpan.');
      load(true);
      return;
    }

    const { error: err } = await supabase.from('budget_requests').insert({
      project_id: form.project_id || null,
      category: form.category,
      title: form.title.trim(),
      description: form.description.trim() || null,
      amount,
      urgency: form.urgency,
      request_proof_path: proof?.path || null,
      request_proof_name: proof?.name || null,
      requester_id: profile.id,
      requester_name: profile.full_name || profile.email,
    });
    setBusy(false);
    if (err) { setError('Gagal menyimpan pengajuan.'); return; }
    setOpen(false);
    flashToast('Pengajuan budget terkirim.');
    load(true);
  };

  const approve = async (b: BudgetRequest) => {
    if (!profile) return;
    setActBusy(true);
    const { error: err } = await supabase.from('budget_requests').update({
      status: 'disetujui', approver_id: profile.id,
      approver_name: profile.full_name || profile.email, approved_at: new Date().toISOString(),
    }).eq('id', b.id);
    setActBusy(false);
    if (err) { flashToast('Gagal menyetujui — hanya PM yang boleh ACC.'); return; }
    setDetail(null);
    flashToast('Pengajuan disetujui, diteruskan ke Finance.');
    load(true);
  };

  const doReject = async () => {
    const b = rejectFor;
    if (!b || !profile) return;
    setActBusy(true);
    const { error: err } = await supabase.from('budget_requests').update({
      status: 'ditolak', approver_id: profile.id,
      approver_name: profile.full_name || profile.email,
      reject_reason: rejectReason.trim() || null,
    }).eq('id', b.id);
    setActBusy(false);
    if (err) { flashToast('Gagal menolak pengajuan.'); return; }
    setRejectFor(null); setRejectReason(''); setDetail(null);
    flashToast('Pengajuan ditolak.');
    load(true);
  };

  const markPaid = async (b: BudgetRequest, f: File | null) => {
    if (!profile) return;
    let proof: { path: string; name: string } | null = null;
    if (f) {
      if (f.size > MAX_MB * 1024 * 1024) { flashToast(`Bukti maksimal ${MAX_MB} MB.`); return; }
      setActBusy(true);
      proof = await uploadProof(f, 'payment');
      if (!proof) { setActBusy(false); flashToast('Gagal mengunggah bukti pembayaran.'); return; }
    }
    setActBusy(true);
    const { error: err } = await supabase.from('budget_requests').update({
      status: 'dibayar', payer_id: profile.id,
      payer_name: profile.full_name || profile.email, paid_at: new Date().toISOString(),
      payment_proof_path: proof?.path || null, payment_proof_name: proof?.name || null,
    }).eq('id', b.id);
    setActBusy(false);
    if (err) { flashToast('Gagal menandai dibayar — hanya Finance.'); return; }
    setDetail(null);
    flashToast('Ditandai sudah dibayar.');
    load(true);
  };

  const signed = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await supabase.storage.from('budget').createSignedUrl(path, 300);
    return data?.signedUrl || null;
  };

  const openDetail = async (b: BudgetRequest) => {
    setDetail(b);
    setReqProofUrl(null);
    setPayProofUrl(null);
    setReqProofUrl(await signed(b.request_proof_path));
    setPayProofUrl(await signed(b.payment_proof_path));
  };

  const isImage = (name: string | null) => !!name && /\.(png|jpe?g|webp|gif)$/i.test(name);

  const filtered = useMemo(() => rows.filter((r) => filter === 'all' || r.status === filter), [rows, filter]);
  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || '—';

  const stats = useMemo(() => {
    const sum = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + (r.amount || 0), 0);
    return {
      diajukan: sum('diajukan'), disetujui: sum('disetujui'), dibayar: sum('dibayar'),
      countDiajukan: rows.filter((r) => r.status === 'diajukan').length,
    };
  }, [rows]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Pengajuan Budget</h2>
          <span className="top-note">{rows.length} pengajuan</span>
        </div>
        <div className="top-actions">
          {canRequest && <button className="btn primary" onClick={openModal}>+ Ajukan budget</button>}
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">Menunggu ACC</div><div className="kpi-value" style={{ color: 'var(--st-review)' }}>{stats.countDiajukan}</div></div>
          <div className="kpi"><div className="kpi-label">Diajukan (Rp)</div><div className="kpi-value" style={{ fontSize: 18 }}>{rupiah(stats.diajukan)}</div></div>
          <div className="kpi"><div className="kpi-label">Disetujui, blm dibayar</div><div className="kpi-value" style={{ fontSize: 18, color: 'var(--amber)' }}>{rupiah(stats.disetujui)}</div></div>
          <div className="kpi"><div className="kpi-label">Sudah dibayar</div><div className="kpi-value" style={{ fontSize: 18, color: 'var(--green)' }}>{rupiah(stats.dibayar)}</div></div>
        </div>

        <div className="team-filter">
          {(['all', 'diajukan', 'disetujui', 'dibayar', 'ditolak'] as const).map((f) => (
            <button key={f} className={`chip-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Semua' : STATUS_META[f].label}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? <p className="empty">Memuat…</p> : filtered.length === 0 ? (
            <p className="empty">Belum ada pengajuan pada filter ini.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Pengajuan</th><th>Project</th><th>Kategori</th><th>Jumlah</th><th>Pemohon</th><th>Status</th><th style={{ width: 200 }}></th></tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="tracker-row" onClick={() => openDetail(b)}>
                    <td>
                      <b className="budget-title-link">{b.title}</b>
                      {b.urgency === 'mendesak' && <span className="manual-tag" style={{ color: 'var(--red)', borderColor: 'var(--red)', marginLeft: 6 }}>mendesak</span>}
                      {b.description && <div className="sub" style={{ fontFamily: 'inherit' }}>{b.description.slice(0, 70)}{b.description.length > 70 ? '…' : ''}</div>}
                      {b.reject_reason && <div className="sub" style={{ color: 'var(--red)' }}>Ditolak: {b.reject_reason}</div>}
                    </td>
                    <td>{projName(b.project_id)}</td>
                    <td><span className="link-tag">{catLabel(b.category)}</span></td>
                    <td><b>{rupiah(b.amount)}</b></td>
                    <td>
                      <span className="row-avatar">{initials(b.requester_name)}</span>{b.requester_name}
                      <div className="sub" style={{ marginLeft: 40 }}>{fmt(b.created_at)}</div>
                    </td>
                    <td>
                      <span className="status-dot" style={{ background: STATUS_META[b.status]?.color }} />
                      {STATUS_META[b.status]?.label || b.status}
                    </td>
                    <td>
                      <div className="recap-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn act" onClick={() => openDetail(b)}>Detail</button>
                        {b.status === 'diajukan' && isPM && (
                          <>
                            <button className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => approve(b)}>ACC</button>
                            <button className="btn act" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => { setRejectReason(''); setRejectFor(b); }}>Tolak</button>
                          </>
                        )}
                        {b.status === 'disetujui' && isFinance && (
                          <label className="btn act" style={{ borderColor: 'var(--green)', color: 'var(--green)', cursor: 'pointer' }}>
                            ✓ Dibayar
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                              onChange={(e) => markPaid(b, e.target.files?.[0] || null)} />
                          </label>
                        )}
                        {bolehHapus(b) && (
                          <button className="icon-del" title="Hapus pengajuan" onClick={() => setConfirmDel(b)}>
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
          Alur: <b>Team/Manager ajukan</b> (+ bukti) → <b>PM ACC</b> → <b>Finance tandai dibayar</b> (+ struk). Ikut tembok unit project.
        </p>
      </div>

      {detail && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: STATUS_META[detail.status]?.color }} />
                  {catLabel(detail.category)} · {STATUS_META[detail.status]?.label}
                </div>
                <div className="modal-title">{detail.title}</div>
                <div className="modal-sub">{projName(detail.project_id)} · {rupiah(detail.amount)}{detail.urgency === 'mendesak' ? ' · MENDESAK' : ''}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {detail.description && <p className="thread-detail">{detail.description}</p>}

              {/* Bukti QR / payment */}
              <div className="budget-detail-label">Bukti pengajuan</div>
              {detail.request_proof_path ? (
                isImage(detail.request_proof_name)
                  ? (reqProofUrl
                      ? <img className="budget-qr" src={reqProofUrl} alt="Bukti pengajuan" />
                      : <div className="notes-empty">Memuat bukti…</div>)
                  : <a className="btn" href={reqProofUrl || '#'} target="_blank" rel="noopener noreferrer">Buka bukti (PDF) ↗</a>
              ) : <div className="notes-empty">Tidak ada bukti dilampirkan.</div>}

              {/* Bukti pembayaran */}
              {detail.status === 'dibayar' && (
                <>
                  <div className="budget-detail-label" style={{ marginTop: 16 }}>Bukti pembayaran</div>
                  {detail.payment_proof_path ? (
                    isImage(detail.payment_proof_name)
                      ? (payProofUrl
                          ? <img className="budget-qr" src={payProofUrl} alt="Bukti pembayaran" />
                          : <div className="notes-empty">Memuat…</div>)
                      : <a className="btn" href={payProofUrl || '#'} target="_blank" rel="noopener noreferrer">Buka struk (PDF) ↗</a>
                  ) : <div className="notes-empty">Tidak ada struk.</div>}
                </>
              )}

              {/* Riwayat */}
              <div className="budget-detail-label" style={{ marginTop: 16 }}>Riwayat</div>
              <div className="budget-trace">
                <div><b>Diajukan</b> oleh {detail.requester_name} · {fmt(detail.created_at)}</div>
                {detail.approver_name && <div><b>{detail.status === 'ditolak' ? 'Ditolak' : 'Disetujui'}</b> oleh {detail.approver_name}{detail.approved_at ? ' · ' + fmt(detail.approved_at) : ''}</div>}
                {detail.reject_reason && <div style={{ color: 'var(--red)' }}>Alasan: {detail.reject_reason}</div>}
                {detail.payer_name && <div><b>Dibayar</b> oleh {detail.payer_name}{detail.paid_at ? ' · ' + fmt(detail.paid_at) : ''}</div>}
              </div>
            </div>
            <div className="modal-foot">
              {canEdit(detail) && (
                <button className="btn" onClick={() => openEdit(detail)}>✎ Edit</button>
              )}
              {bolehHapus(detail) && (
                <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => setConfirmDel(detail)}>Hapus</button>
              )}
              {detail.status === 'diajukan' && isPM && (
                <>
                  <button className="btn" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => { setRejectReason(''); setRejectFor(detail); }}>Tolak</button>
                  <button className="btn primary" onClick={() => approve(detail)}>✓ ACC</button>
                </>
              )}
              {detail.status === 'disetujui' && isFinance && (
                <label className="btn primary" style={{ cursor: 'pointer' }}>
                  ✓ Tandai dibayar (pilih struk)
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                    onChange={(e) => markPaid(detail, e.target.files?.[0] || null)} />
                </label>
              )}
              <div className="right">
                <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
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
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--accent)' }} />Budget</div>
                <div className="modal-title">{editId ? 'Edit Pengajuan' : 'Ajukan Budget'}</div>
                <div className="modal-sub">{editId ? 'Perubahan hanya bisa selama status masih Diajukan.' : 'Pengajuan masuk antrian → di-ACC PM → diproses Finance.'}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Judul / keperluan</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="mis. Boosting konten REXONA minggu ini" />
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
                  <label>Kategori</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Jumlah (Rp)</label>
                  <input value={form.amount} inputMode="numeric"
                    onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/\D/g, '') })}
                    placeholder="500000" />
                  {form.amount && <div className="hint">{rupiah(parseInt(form.amount, 10) || 0)}</div>}
                </div>
                <div className="field">
                  <label>Urgensi</label>
                  <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
                    <option value="normal">Normal</option>
                    <option value="mendesak">Mendesak</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Bukti (QR / halaman payment)</label>
                <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <div className="hint">{file ? file.name : (editId ? 'Kosongkan bila tidak ingin mengganti bukti lama' : `Opsional · maks ${MAX_MB} MB`)}</div>
              </div>
              <div className="field">
                <label>Keterangan</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detail keperluan / rincian" />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.title.trim()}>
                  {busy ? 'Menyimpan…' : (editId ? 'Simpan perubahan' : 'Ajukan')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal alasan menolak (pengganti window.prompt yang diblokir browser) */}
      {rejectFor && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setRejectFor(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Tolak pengajuan</div>
                <div className="modal-title">{rejectFor.title}</div>
                <div className="modal-sub">{rupiah(rejectFor.amount)} · {rejectFor.requester_name}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setRejectFor(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Alasan menolak <span style={{ color: 'var(--text-3)' }}>(opsional, tapi sangat membantu pemohon)</span></label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="mis. nominal di luar plafon bulan ini, ajukan ulang minggu depan" rows={3} />
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setRejectFor(null)} disabled={actBusy}>Batal</button>
                <button className="btn primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={doReject} disabled={actBusy}>
                  {actBusy ? 'Memproses…' : 'Tolak pengajuan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus (pengganti window.confirm yang diblokir browser) */}
      {confirmDel && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Hapus pengajuan</div>
                <div className="modal-title">{confirmDel.title}</div>
                <div className="modal-sub">
                  {rupiah(confirmDel.amount)} · {projName(confirmDel.project_id)} · {confirmDel.requester_name}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setConfirmDel(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail">
                Pengajuan ini akan dihapus permanen beserta bukti yang diunggah, dan tidak bisa dikembalikan.
              </p>
              {confirmDel.status === 'dibayar' && (
                <p className="error-msg" style={{ marginTop: 10 }}>
                  Perhatian: status pengajuan ini sudah <b>Dibayar</b>. Menghapusnya berarti jejak pengeluaran ini
                  hilang dari rekap Finance.
                </p>
              )}
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
