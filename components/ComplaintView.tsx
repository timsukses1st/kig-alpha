'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type Complaint, type ComplaintMessage, type Profile } from '@/lib/types';

interface Props {
  profile: Profile | null;
}

const CATEGORIES = [
  { key: 'bug', label: 'Bug / error' },
  { key: 'fitur', label: 'Usulan fitur' },
  { key: 'akses', label: 'Akses & login' },
  { key: 'data', label: 'Data tidak sesuai' },
  { key: 'proses', label: 'Alur kerja' },
  { key: 'lainnya', label: 'Lainnya' },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  baru: { label: 'Baru', color: 'var(--st-review)' },
  diproses: { label: 'Diproses', color: 'var(--amber)' },
  selesai: { label: 'Selesai', color: 'var(--green)' },
};

const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || k;

export default function ComplaintView({ profile }: Props) {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'baru' | 'diproses' | 'selesai'>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: 'bug', title: '', detail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [active, setActive] = useState<Complaint | null>(null);
  const [messages, setMessages] = useState<ComplaintMessage[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);

  const isLead = profile?.role === 'superadmin' || profile?.role === 'manager';

  // --- notifikasi in-app (window.alert diblokir di browser) ---
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
    setRows((data as Complaint[]) || []);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: daftar komplain ---
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(true); }, 250);
    };
    const ch = supabase
      .channel('complaint-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  // Sinkronkan modal thread yang sedang terbuka dengan data terbaru.
  useEffect(() => {
    setActive((cur) => (cur ? rows.find((r) => r.id === cur.id) || cur : cur));
  }, [rows]);

  const loadMessages = async (id: string) => {
    const { data } = await supabase
      .from('complaint_messages')
      .select('*')
      .eq('complaint_id', id)
      .order('created_at', { ascending: true });
    setMessages((data as ComplaintMessage[]) || []);
  };

  // --- REALTIME: balasan pada thread yang sedang dibuka ---
  const activeId = active?.id || null;
  useEffect(() => {
    if (!activeId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadMessages(activeId); }, 200);
    };
    const ch = supabase
      .channel(`complaint-msg-${activeId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'complaint_messages',
        filter: `complaint_id=eq.${activeId}`,
      }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const openThread = (c: Complaint) => {
    setActive(c);
    setMessages([]);
    setNewMsg('');
    loadMessages(c.id);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.title.trim()) { setError('Judul komplain wajib diisi.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.from('complaints').insert({
      category: form.category,
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      reporter_id: profile.id,
      reporter_name: profile.full_name || profile.email,
    });
    setBusy(false);
    if (err) { setError('Gagal mengirim komplain.'); return; }
    setOpen(false);
    setForm({ category: 'bug', title: '', detail: '' });
    flashToast('Komplain terkirim. Lead akan menindaklanjuti.');
    load(true);
  };

  const sendMsg = async () => {
    if (!active || !newMsg.trim() || !profile) return;
    setMsgBusy(true);
    const { error: err } = await supabase.from('complaint_messages').insert({
      complaint_id: active.id,
      author_id: profile.id,
      author_name: profile.full_name || profile.email,
      message: newMsg.trim(),
    });
    setMsgBusy(false);
    if (!err) { setNewMsg(''); loadMessages(active.id); }
  };

  const setStatus = async (c: Complaint, status: string) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'selesai') {
      patch.resolved_at = new Date().toISOString();
      patch.handler_name = profile?.full_name || profile?.email || null;
    }
    const { error: err } = await supabase.from('complaints').update(patch).eq('id', c.id);
    if (err) { flashToast('Gagal mengubah status — cek wewenang akunmu.'); return; }
    if (active?.id === c.id) setActive({ ...active, status });
    flashToast(`Status diubah ke "${STATUS_META[status]?.label || status}".`);
    load(true);
  };

  const filtered = useMemo(
    () => rows.filter((r) => filter === 'all' || r.status === filter),
    [rows, filter]
  );

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {};
    const byPerson: Record<string, number> = {};
    for (const r of rows) {
      byCat[r.category] = (byCat[r.category] || 0) + 1;
      const p = r.reporter_name || 'anonim';
      byPerson[p] = (byPerson[p] || 0) + 1;
    }
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const topPerson = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      total: rows.length,
      baru: rows.filter((r) => r.status === 'baru').length,
      diproses: rows.filter((r) => r.status === 'diproses').length,
      selesai: rows.filter((r) => r.status === 'selesai').length,
      topCat,
      topPerson,
    };
  }, [rows]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Komplain</h2>
          <span className="top-note">{isLead ? 'semua laporan' : 'laporan saya'}</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={() => { setOpen(true); setError(''); }}>+ Lapor kendala</button>
        </div>
      </div>

      <div className="content-area">
        {isLead && (
          <>
            <div className="kpi-row">
              <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-value">{stats.total}</div></div>
              <div className="kpi"><div className="kpi-label">Baru</div><div className="kpi-value" style={{ color: 'var(--st-review)' }}>{stats.baru}</div></div>
              <div className="kpi"><div className="kpi-label">Diproses</div><div className="kpi-value" style={{ color: 'var(--amber)' }}>{stats.diproses}</div></div>
              <div className="kpi"><div className="kpi-label">Selesai</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.selesai}</div></div>
            </div>

            {stats.total > 0 && (
              <div className="stat-grid">
                <div className="stat-box">
                  <div className="modal-col-label">Masalah tersering</div>
                  {stats.topCat.map(([k, n]) => (
                    <div className="stat-line" key={k}>
                      <span>{catLabel(k)}</span>
                      <div className="stat-bar"><span style={{ width: `${(n / stats.total) * 100}%` }} /></div>
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
                <div className="stat-box">
                  <div className="modal-col-label">Pelapor teraktif</div>
                  {stats.topPerson.map(([name, n]) => (
                    <div className="stat-line" key={name}>
                      <span>{name}</span>
                      <div className="stat-bar"><span style={{ width: `${(n / stats.total) * 100}%` }} /></div>
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="team-filter">
          {(['all', 'baru', 'diproses', 'selesai'] as const).map((f) => (
            <button key={f} className={`chip-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Semua' : STATUS_META[f].label}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? (
            <p className="empty">Memuat komplain…</p>
          ) : filtered.length === 0 ? (
            <p className="empty">Belum ada komplain pada filter ini.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Komplain</th><th>Kategori</th><th>Pelapor</th><th>Status</th><th style={{ width: 110 }}></th></tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <b>{c.title}</b>
                      {c.detail && <div className="sub" style={{ fontFamily: 'inherit' }}>{c.detail.slice(0, 90)}{c.detail.length > 90 ? '…' : ''}</div>}
                    </td>
                    <td><span className="link-tag">{catLabel(c.category)}</span></td>
                    <td>
                      <span className="row-avatar">{initials(c.reporter_name)}</span>
                      {c.reporter_name}
                      <div className="sub" style={{ marginLeft: 40 }}>{fmt(c.created_at)}</div>
                    </td>
                    <td>
                      {isLead ? (
                        <select value={c.status} onChange={(e) => setStatus(c, e.target.value)}
                          style={{ color: STATUS_META[c.status]?.color, borderColor: STATUS_META[c.status]?.color }}>
                          <option value="baru">Baru</option>
                          <option value="diproses">Diproses</option>
                          <option value="selesai">Selesai</option>
                        </select>
                      ) : (
                        <>
                          <span className="status-dot" style={{ background: STATUS_META[c.status]?.color }} />
                          {STATUS_META[c.status]?.label || c.status}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="recap-actions">
                        <button className="btn act" onClick={() => openThread(c)}>💬 Balasan</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="cal-legend">
          Komplain kamu hanya terlihat olehmu dan lead. Semua laporan &amp; perubahan statusnya tercatat di Log Aktivitas.
        </p>
      </div>

      {/* modal lapor */}
      {open && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--st-review)' }} />
                  Komplain
                </div>
                <div className="modal-title">Lapor Kendala</div>
                <div className="modal-sub">Kendala aplikasi, data, akses, atau usulan perbaikan alur kerja.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Kategori</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Judul</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="mis. Tombol ACC tidak muncul di kartu Review" />
              </div>
              <div className="field">
                <label>Detail</label>
                <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })}
                  placeholder="Langkah yang dilakukan, apa yang terjadi, dan apa yang diharapkan" />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.title.trim()}>
                  {busy ? 'Mengirim…' : 'Kirim'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* modal thread */}
      {active && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: STATUS_META[active.status]?.color }} />
                  {catLabel(active.category)} · {STATUS_META[active.status]?.label}
                </div>
                <div className="modal-title">{active.title}</div>
                <div className="modal-sub">{active.reporter_name} · {fmt(active.created_at)}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setActive(null)}>✕</button>
            </div>
            <div style={{ padding: '14px 24px' }}>
              {active.detail && <p className="thread-detail">{active.detail}</p>}
              <div className="thread-box">
                {messages.length === 0 && <div className="notes-empty">Belum ada balasan.</div>}
                {messages.map((m) => (
                  <div className="note-item" key={m.id}>
                    <span className="row-avatar note-avatar">{initials(m.author_name)}</span>
                    <div className="note-body">
                      <div className="note-meta">
                        <b>{m.author_name || 'anonim'}</b>
                        <span>{new Date(m.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="note-text">{m.message}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="note-input">
                <input value={newMsg} placeholder="Tulis balasan…"
                  onChange={(e) => setNewMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMsg()} />
                <button className="btn" onClick={sendMsg} disabled={msgBusy || !newMsg.trim()}>Kirim</button>
              </div>
            </div>
            <div className="modal-foot">
              {isLead && active.status !== 'selesai' && (
                <button className="btn" onClick={() => setStatus(active, 'selesai')}>✓ Tandai selesai</button>
              )}
              <div className="right">
                <button className="btn primary" onClick={() => setActive(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
