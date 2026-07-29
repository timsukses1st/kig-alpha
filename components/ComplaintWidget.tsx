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
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || k;

const STATUS_META: Record<string, { label: string; color: string }> = {
  baru: { label: 'Baru', color: 'var(--st-review)' },
  diproses: { label: 'Diproses', color: 'var(--amber)' },
  selesai: { label: 'Selesai', color: 'var(--green)' },
};

// Tim Delta = penjawab komplain
const isDeltaTeam = (p: Profile | null) =>
  p?.team === 'delta' || p?.role === 'superadmin';

export default function ComplaintWidget({ profile }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'thread' | 'new'>('list');
  const [rows, setRows] = useState<Complaint[]>([]);
  const [active, setActive] = useState<Complaint | null>(null);
  const [messages, setMessages] = useState<ComplaintMessage[]>([]);
  const [reply, setReply] = useState('');
  const [form, setForm] = useState({ category: 'bug', title: '', detail: '' });
  const [busy, setBusy] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);

  const isDelta = isDeltaTeam(profile);

  const load = useCallback(async () => {
    // Delta lihat semua; user biasa lihat miliknya (RLS juga menegakkan)
    let q = supabase.from('complaints').select('*').order('created_at', { ascending: false });
    if (!isDelta && profile) q = q.eq('reporter_id', profile.id);
    const { data } = await q;
    setRows((data as Complaint[]) || []);
  }, [isDelta, profile]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Realtime: dengarkan komplain baru/berubah (untuk list)
  useEffect(() => {
    if (!open) return;
    const ch = supabase
      .channel('cw-complaints')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, load]);

  // Realtime: dengarkan pesan baru pada thread yang sedang dibuka
  useEffect(() => {
    if (!active) return;
    const ch = supabase
      .channel('cw-messages-' + active.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'complaint_messages', filter: 'complaint_id=eq.' + active.id },
        (payload) => {
          const nm = payload.new as ComplaintMessage;
          setMessages((prev) => (prev.some((x) => x.id === nm.id) ? prev : [...prev, nm]));
          setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active]);

  const openThread = async (c: Complaint) => {
    setActive(c);
    setView('thread');
    const { data } = await supabase.from('complaint_messages')
      .select('*').eq('complaint_id', c.id).order('created_at');
    setMessages((data as ComplaintMessage[]) || []);
    setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const refreshThread = async (id: string) => {
    const { data } = await supabase.from('complaint_messages')
      .select('*').eq('complaint_id', id).order('created_at');
    setMessages((data as ComplaintMessage[]) || []);
    setTimeout(() => threadEnd.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const sendReply = async () => {
    if (!reply.trim() || !active || !profile) return;
    setBusy(true);
    const { error } = await supabase.from('complaint_messages').insert({
      complaint_id: active.id,
      author_id: profile.id,
      author_name: profile.full_name || profile.email,
      message: reply.trim(),
    });
    // Delta membalas -> tandai diproses (kalau masih baru)
    if (!error && isDelta && active.status === 'baru') {
      await supabase.from('complaints').update({ status: 'diproses', handler_name: profile.full_name || profile.email }).eq('id', active.id);
    }
    setBusy(false);
    if (error) return;
    setReply('');
    refreshThread(active.id);
    load();
  };

  const createComplaint = async () => {
    if (!form.title.trim() || !profile) return;
    setBusy(true);
    const { data, error } = await supabase.from('complaints').insert({
      category: form.category,
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      reporter_id: profile.id,
      reporter_name: profile.full_name || profile.email,
      status: 'baru',
    }).select().single();
    setBusy(false);
    if (error) return;
    setForm({ category: 'bug', title: '', detail: '' });
    load();
    if (data) openThread(data as Complaint);
  };

  const setStatus = async (c: Complaint, status: string) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'selesai') patch.resolved_at = new Date().toISOString();
    await supabase.from('complaints').update(patch).eq('id', c.id);
    setActive({ ...c, status });
    load();
  };

  const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // statistik untuk Delta: siapa sering komplain + topik
  const stats = useMemo(() => {
    const byPerson = new Map<string, number>();
    const byCat = new Map<string, number>();
    rows.forEach((r) => {
      byPerson.set(r.reporter_name || '—', (byPerson.get(r.reporter_name || '—') || 0) + 1);
      byCat.set(r.category, (byCat.get(r.category) || 0) + 1);
    });
    const topPerson = Array.from(byPerson.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topCat = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { topPerson, topCat, openCount: rows.filter((r) => r.status !== 'selesai').length };
  }, [rows]);

  const unresolved = rows.filter((r) => r.status !== 'selesai').length;

  if (!profile) return null;

  return (
    <>
      {/* Bubble */}
      <button className={`cw-bubble ${open ? 'hidden' : ''}`} onClick={() => { setOpen(true); setView('list'); }} title="Bantuan Alpha">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        {unresolved > 0 && <span className="cw-badge">{unresolved}</span>}
      </button>

      {/* Panel */}
      {open && (
        <div className="cw-panel">
          <div className="cw-head">
            <div className="cw-head-l">
              {view !== 'list' && (
                <button className="cw-back" onClick={() => { setView('list'); setActive(null); }}>‹</button>
              )}
              <div>
                <div className="cw-title">
                  {view === 'thread' && active ? active.title
                    : view === 'new' ? 'Lapor masalah'
                    : 'Bantuan Alpha'}
                </div>
                <div className="cw-sub">
                  {view === 'thread' && active ? catLabel(active.category)
                    : isDelta ? 'Tim Delta · helpdesk' : 'Chat ke tim Delta'}
                </div>
              </div>
            </div>
            <button className="cw-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* LIST */}
          {view === 'list' && (
            <>
              <div className="cw-body">
                {isDelta && rows.length > 0 && (
                  <div className="cw-stats">
                    <div className="cw-stat-row"><span>Belum selesai</span><b>{stats.openCount}</b></div>
                    {stats.topPerson.length > 0 && (
                      <div className="cw-stat-block">
                        <div className="cw-stat-label">Paling sering lapor</div>
                        {stats.topPerson.map(([n, c]) => <div key={n} className="cw-stat-item"><span>{n}</span><span>{c}×</span></div>)}
                      </div>
                    )}
                    {stats.topCat.length > 0 && (
                      <div className="cw-stat-block">
                        <div className="cw-stat-label">Topik terbanyak</div>
                        {stats.topCat.map(([k, c]) => <div key={k} className="cw-stat-item"><span>{catLabel(k)}</span><span>{c}×</span></div>)}
                      </div>
                    )}
                  </div>
                )}
                {rows.length === 0 ? (
                  <div className="cw-empty">{isDelta ? 'Belum ada komplain masuk.' : 'Belum ada laporan. Ada kendala dengan Alpha? Lapor di sini.'}</div>
                ) : (
                  rows.map((c) => (
                    <button key={c.id} className="cw-item" onClick={() => openThread(c)}>
                      <span className="cw-item-dot" style={{ background: STATUS_META[c.status]?.color }} />
                      <div className="cw-item-body">
                        <div className="cw-item-title">{c.title}</div>
                        <div className="cw-item-meta">
                          {isDelta ? `${c.reporter_name} · ` : ''}{catLabel(c.category)} · {fmtTime(c.created_at)}
                        </div>
                      </div>
                      <span className="cw-item-status" style={{ color: STATUS_META[c.status]?.color }}>{STATUS_META[c.status]?.label}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="cw-foot">
                <button className="cw-new-btn" onClick={() => setView('new')}>+ Lapor masalah baru</button>
              </div>
            </>
          )}

          {/* NEW */}
          {view === 'new' && (
            <>
              <div className="cw-body">
                <div className="field"><label>Kategori</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field"><label>Judul masalah</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="mis. Tombol simpan tidak berfungsi" autoFocus />
                </div>
                <div className="field"><label>Detail</label>
                  <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="Ceritakan detail masalahnya…" rows={4} />
                </div>
              </div>
              <div className="cw-foot cw-foot-row">
                <button className="btn" onClick={() => setView('list')}>Batal</button>
                <button className="btn primary" onClick={createComplaint} disabled={busy || !form.title.trim()}>{busy ? 'Mengirim…' : 'Kirim'}</button>
              </div>
            </>
          )}

          {/* THREAD */}
          {view === 'thread' && active && (
            <>
              <div className="cw-thread">
                {active.detail && (
                  <div className="cw-first">
                    <div className="cw-bubble-msg them">
                      <div className="cw-msg-author">{active.reporter_name}</div>
                      {active.detail}
                    </div>
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.author_id === profile.id;
                  return (
                    <div key={m.id} className={`cw-msg-row ${mine ? 'me' : ''}`}>
                      <div className={`cw-bubble-msg ${mine ? 'me' : 'them'}`}>
                        {!mine && <div className="cw-msg-author">{m.author_name}</div>}
                        {m.message}
                        <div className="cw-msg-time">{fmtTime(m.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEnd} />
              </div>
              {isDelta && active.status !== 'selesai' && (
                <div className="cw-status-bar">
                  <span>Status: <b style={{ color: STATUS_META[active.status]?.color }}>{STATUS_META[active.status]?.label}</b></span>
                  <button className="cw-mark" onClick={() => setStatus(active, 'selesai')}>Tandai selesai ✓</button>
                </div>
              )}
              {active.status === 'selesai' ? (
                <div className="cw-foot cw-resolved">Komplain sudah ditandai selesai.</div>
              ) : (
                <div className="cw-reply">
                  <input value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendReply())}
                    placeholder="Tulis pesan…" />
                  <button className="cw-send" onClick={sendReply} disabled={busy || !reply.trim()}>➤</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
