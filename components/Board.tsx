'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DIVISIONS, PILLAR_LABEL, STATUSES,
  canEditRow, initials, statusDef,
  type Account, type ContentRow, type ContentStatus, type Division, type Pillar, type Profile, type TeamMember, type ContentNote, type ContentRequest, type Project,
} from '@/lib/types';

interface Props {
  profile: Profile | null;
  accounts: Account[];
  projects: Project[];
  projectFilter: string; // 'all' | project id
}

type Range = 'today' | 'yesterday' | 'week' | 'all';

const EMPTY_FORM = {
  title: '',
  project_id: '',
  account_id: '',
  pillar: 'lagi_ramai' as Pillar,
  status: 'drafting' as ContentStatus,
  pic_creative: '',
  pic_distribution: '',
  pic_ads: '',
  deadline: '',
  publish_date: '',
  caption: '',
  asset_url: '',
  visual_hook: '',
  production_note: '',
  potensi_fyp: false,
};

const isUrl = (s: string | null | undefined) => !!s && /^https?:\/\//i.test(s.trim());

const growRef = (el: HTMLTextAreaElement | null) => {
  if (el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 2, 340) + 'px';
  }
};

const autoGrow = (e: React.FormEvent<HTMLTextAreaElement>) => growRef(e.currentTarget);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// **teks** -> <b>teks</b> (aman: semua HTML lain di-escape dulu)
const mdToHtml = (s: string) =>
  escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

// serialisasi balik contentEditable -> teks dengan **bold**
const htmlToMd = (node: Node): string => {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      const tag = el.tagName;
      if (tag === 'B' || tag === 'STRONG') out += '**' + htmlToMd(el) + '**';
      else if (tag === 'BR') out += '\n';
      else if (tag === 'DIV' || tag === 'P') out += '\n' + htmlToMd(el);
      else out += htmlToMd(el);
    }
  });
  return out;
};

export default function Board({ profile, accounts, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [division, setDivision] = useState<Division>('semua');
  const [range, setRange] = useState<Range>('all');
  const [catFilter, setCatFilter] = useState<'all' | Pillar>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContentRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<ContentNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [openNoteField, setOpenNoteField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, m, rq] = await Promise.all([
      supabase.from('contents').select('*').order('updated_at', { ascending: false }),
      supabase.from('team_members').select('*').eq('is_active', true).order('name'),
      supabase.from('content_requests').select('*').eq('status', 'pending').order('requested_date', { ascending: true }),
    ]);
    setRows((c.data as ContentRow[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setRequests((rq.data as ContentRequest[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const inRange = useCallback((r: ContentRow) => {
    if (range === 'all') return true;
    const d = new Date(r.updated_at);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === 'today') return d >= startToday;
    if (range === 'yesterday') {
      const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
      return d >= startYest && d < startToday;
    }
    const start7 = new Date(startToday); start7.setDate(start7.getDate() - 6);
    return d >= start7;
  }, [range]);

  const filtered = useMemo(
    () => rows.filter((r) =>
      (projectFilter === 'all' || r.project_id === projectFilter)
      && (catFilter === 'all' || r.pillar === catFilter)
      && inRange(r)),
    [rows, projectFilter, catFilter, inRange]
  );

  const visibleRequests = useMemo(
    () => requests.filter((rq) => projectFilter === 'all' || rq.project_id === projectFilter),
    [requests, projectFilter]
  );

  const divCounts = useMemo(() => {
    const m: Record<Division, number> = { semua: filtered.length, creative: 0, distribution: 0, ads: 0 };
    for (const r of filtered) {
      const t = statusDef(r.status).ownerTeam;
      if (t === 'creative') m.creative++;
      else if (t === 'distribution') m.distribution++;
      else if (t === 'ads') m.ads++;
    }
    return m;
  }, [filtered]);

  const activeDiv = DIVISIONS.find((d) => d.key === division)!;
  const columns = activeDiv.statuses.map((k) => statusDef(k));
  const byStatus = useMemo(() => {
    const m: Record<string, ContentRow[]> = {};
    for (const s of STATUSES) m[s.key] = [];
    for (const r of filtered) (m[r.status] || (m[r.status] = [])).push(r);
    return m;
  }, [filtered]);

  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.handle || 'Akun belum ditentukan';
  const accountsOfProject = (projId: string) =>
    projId ? accounts.filter((a) => a.project_id === projId || !a.project_id) : accounts;
  const personName = (id: string | null) => members.find((m) => m.id === id)?.name || null;
  const membersOf = (team: 'creative' | 'distribution' | 'ads') =>
    members.filter((m) => m.team === team || m.team === 'delta');
  const picForCard = (r: ContentRow) => {
    const team = statusDef(r.status).ownerTeam;
    const id = team === 'creative' ? r.pic_creative : team === 'distribution' ? r.pic_distribution : r.pic_ads;
    return personName(id);
  };

  const canCreate =
    !!profile &&
    (profile.role === 'superadmin' || profile.role === 'manager' ||
      profile.team === 'creative' || profile.team === 'delta');

  const openCreate = () => {
    setEditing(null);
    setNotes([]);
    setNewNote('');
    setOpenNoteField(null);
    setForm({ ...EMPTY_FORM, project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || '') });
    setError('');
    setModalOpen(true);
  };

  const loadNotes = async (contentId: string) => {
    const { data } = await supabase
      .from('content_notes')
      .select('*')
      .eq('content_id', contentId)
      .order('created_at', { ascending: true });
    setNotes((data as ContentNote[]) || []);
  };

  const addNote = async (field: string) => {
    if (!editing || !newNote.trim() || !profile) return;
    setNoteBusy(true);
    const { error: err } = await supabase.from('content_notes').insert({
      content_id: editing.id,
      author_id: profile.id,
      author_name: profile.full_name || profile.email,
      field,
      note: newNote.trim(),
    });
    setNoteBusy(false);
    if (!err) { setNewNote(''); loadNotes(editing.id); }
  };

  const deleteNote = async (n: ContentNote) => {
    if (!editing) return;
    await supabase.from('content_notes').delete().eq('id', n.id);
    loadNotes(editing.id);
  };

  const openEdit = (row: ContentRow) => {
    setEditing(row);
    setNotes([]);
    setNewNote('');
    setOpenNoteField(null);
    loadNotes(row.id);
    setForm({
      title: row.title,
      project_id: row.project_id || '',
      account_id: row.account_id || '',
      pillar: row.pillar,
      status: row.status,
      pic_creative: row.pic_creative || '',
      pic_distribution: row.pic_distribution || '',
      pic_ads: row.pic_ads || '',
      deadline: row.deadline || '',
      publish_date: row.publish_date || '',
      caption: row.caption || '',
      asset_url: row.asset_url || '',
      visual_hook: row.visual_hook || '',
      production_note: row.production_note || '',
      potensi_fyp: row.potensi_fyp,
    });
    setError('');
    setModalOpen(true);
  };

  const readOnly = editing ? !canEditRow(profile, editing.status) : false;

  const save = async () => {
    if (!form.title.trim()) { setError('Hook / brief konten wajib diisi.'); return; }
    setSaving(true); setError('');
    const payload = {
      title: form.title.trim(),
      project_id: form.project_id || null,
      account_id: form.account_id || null,
      pillar: form.pillar,
      pic_creative: form.pic_creative || null,
      pic_distribution: form.pic_distribution || null,
      pic_ads: form.pic_ads || null,
      deadline: form.deadline || null,
      publish_date: form.publish_date || null,
      caption: form.caption.trim() || null,
      asset_url: form.asset_url.trim() || null,
      visual_hook: form.visual_hook.trim() || null,
      production_note: form.production_note.trim() || null,
      potensi_fyp: form.potensi_fyp,
    };
    let err = null;
    if (editing) {
      const res = await supabase.from('contents').update(payload).eq('id', editing.id);
      err = res.error;
    } else {
      const res = await supabase.from('contents').insert({ ...payload, status: 'drafting' as ContentStatus, created_by: profile?.id || null });
      err = res.error;
    }
    setSaving(false);
    if (err) { setError('Gagal menyimpan. Cek wewenang tim kamu untuk tahap ini.'); return; }
    setModalOpen(false);
    load();
  };

  const [accBusy, setAccBusy] = useState<string | null>(null);
  const canAcc = profile?.role === 'superadmin' || profile?.role === 'manager';

  const accRow = async (row: ContentRow) => {
    setAccBusy(row.id);
    const { error: err } = await supabase.from('contents').update({ status: 'siap_upload' }).eq('id', row.id);
    setAccBusy(null);
    if (err) window.alert('Gagal ACC — cek hak akses.');
    load();
  };

  const ORDER: ContentStatus[] = ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan'];
  const [flowBusy, setFlowBusy] = useState(false);

  const nextActionFor = (s: ContentStatus): { target: ContentStatus; label: string; allowed: boolean } | null => {
    const priv = canAcc;
    const team = profile?.team;
    switch (s) {
      case 'drafting':
        return { target: 'review', label: 'Selesai → Kirim ke Review', allowed: priv || team === 'creative' || team === 'delta' };
      case 'review':
        return { target: 'siap_upload', label: '✓ ACC → Siap Upload (lead)', allowed: priv };
      case 'siap_upload':
        return { target: 'terjadwal', label: 'Jadwalkan → Terjadwal', allowed: priv || team === 'distribution' || team === 'delta' };
      case 'terjadwal':
        return { target: 'published', label: 'Tandai Sudah Tayang', allowed: priv || team === 'distribution' || team === 'delta' };
      case 'published':
        return { target: 'diiklankan', label: 'Tandai Diiklankan', allowed: priv || team === 'ads' || team === 'delta' };
      default:
        return null;
    }
  };

  const moveTo = async (target: ContentStatus) => {
    if (!editing) return;
    if (target === 'terjadwal' && !form.publish_date) {
      setError('Isi Tanggal tayang dulu sebelum menjadwalkan.');
      return;
    }
    setFlowBusy(true);
    setError('');
    const { error: err } = await supabase.from('contents').update({ status: target }).eq('id', editing.id);
    setFlowBusy(false);
    if (err) { setError('Gagal memindahkan — cek wewenang tim.'); return; }
    setModalOpen(false);
    load();
  };

  const canRequest = canAcc || profile?.team === 'pm';
  const canLift = canAcc || profile?.team === 'creative' || profile?.team === 'delta';
  const [reqModalOpen, setReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState({ title: '', account_id: '', requested_date: '', note: '' });
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const [reqError, setReqError] = useState('');

  const submitRequest = async () => {
    if (!reqForm.title.trim() || !profile) { setReqError('Judul/brief request wajib diisi.'); return; }
    setReqBusy('submit');
    setReqError('');
    const { error: err } = await supabase.from('content_requests').insert({
      title: reqForm.title.trim(),
      project_id: projectFilter !== 'all' ? projectFilter : (projects[0]?.id || null),
      account_id: reqForm.account_id || null,
      requested_date: reqForm.requested_date || null,
      note: reqForm.note.trim() || null,
      requester_id: profile.id,
      requester_name: profile.full_name || profile.email,
    });
    setReqBusy(null);
    if (err) { setReqError('Gagal mengirim request — hanya PM/lead yang bisa request.'); return; }
    setReqModalOpen(false);
    setReqForm({ title: '', account_id: '', requested_date: '', note: '' });
    load();
  };

  const liftRequest = async (rq: ContentRequest) => {
    if (!profile) return;
    setReqBusy(rq.id);
    const ins = await supabase
      .from('contents')
      .insert({
        title: rq.title,
        project_id: rq.project_id,
        account_id: rq.account_id,
        pillar: 'lagi_ramai',
        status: 'drafting' as ContentStatus,
        publish_date: rq.requested_date,
        production_note: ['Request oleh ' + (rq.requester_name || 'PM'), rq.note].filter(Boolean).join(' · '),
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (!ins.error && ins.data) {
      await supabase.from('content_requests')
        .update({ status: 'diangkat', created_content_id: (ins.data as { id: string }).id })
        .eq('id', rq.id);
    }
    setReqBusy(null);
    if (ins.error) window.alert('Gagal mengangkat request — cek wewenang.');
    load();
  };

  const rejectRequest = async (rq: ContentRequest) => {
    if (!window.confirm(`Tolak request "${rq.title}"?`)) return;
    setReqBusy(rq.id);
    await supabase.from('content_requests').update({ status: 'ditolak' }).eq('id', rq.id);
    setReqBusy(null);
    load();
  };

  const remove = async () => {
    if (!editing) return;
    if (!window.confirm(`Hapus konten "${editing.title}"?`)) return;
    setSaving(true);
    const { error: err } = await supabase.from('contents').delete().eq('id', editing.id);
    setSaving(false);
    if (err) { setError('Gagal menghapus. Hanya superadmin/manager yang bisa menghapus.'); return; }
    setModalOpen(false);
    load();
  };

  const canDelete = profile?.role === 'superadmin' || profile?.role === 'manager';
  const nextStep = editing ? nextActionFor(editing.status) : null;
  const prevIdx = editing ? ORDER.indexOf(editing.status) : -1;
  const prevStep = editing && prevIdx > 0 ? ORDER[prevIdx - 1] : null;
  const editingDef = statusDef(form.status);

  const NOTE_FIELD_LABELS: Record<string, string> = {
    title: 'Hook / Brief',
    visual_hook: 'Visual Hook',
    production_note: 'Catatan produksi',
    caption: 'Caption',
    account: 'Akun',
    pillar: 'Category Content',
    status: 'Status',
    deadline: 'Deadline',
    publish_date: 'Tanggal tayang',
    pic: 'PIC',
    asset_url: 'Link Drive',
    umum: 'Catatan umum',
  };

  const fieldNotes = (field: string) => notes.filter((n) => n.field === field);

  const noteBtn = (field: string) => {
    if (!editing) return null;
    const count = fieldNotes(field).length;
    return (
      <button
        type="button"
        className={`note-btn ${count ? 'has' : ''} ${openNoteField === field ? 'open' : ''}`}
        title={count ? `${count} catatan` : 'Tambah catatan'}
        onClick={() => { setOpenNoteField(openNoteField === field ? null : field); setNewNote(''); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {count > 0 && <span>{count}</span>}
      </button>
    );
  };

  const noteSidePanel = () => {
    if (!editing || !openNoteField) return null;
    const field = openNoteField;
    const list = fieldNotes(field);
    return (
      <div className="note-side">
        <div className="note-side-head">
          <div>
            <div className="modal-col-label" style={{ marginBottom: 2 }}>Catatan</div>
            <b>{NOTE_FIELD_LABELS[field] || field}</b>
          </div>
          <button className="btn ghost" onClick={() => setOpenNoteField(null)}>✕</button>
        </div>
        <div className="note-side-body">
          {list.length === 0 && <div className="notes-empty">Belum ada catatan di field ini.</div>}
          {list.map((n) => (
            <div className="note-item" key={n.id}>
              <span className="row-avatar note-avatar">{initials(n.author_name)}</span>
              <div className="note-body">
                <div className="note-meta">
                  <b>{n.author_name || 'anonim'}</b>
                  <span>{new Date(n.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="note-text">{n.note}</div>
              </div>
              {(profile?.id === n.author_id || canDelete) && (
                <button className="note-del" title="Hapus catatan" onClick={() => deleteNote(n)}>✕</button>
              )}
            </div>
          ))}
        </div>
        <div className="note-input">
          <input
            autoFocus
            value={newNote}
            placeholder="Tulis catatan…"
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote(field)}
          />
          <button className="btn" onClick={() => addNote(field)} disabled={noteBusy || !newNote.trim()}>Kirim</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Board Pipeline</h2>
          <span className="top-note">{filtered.length} konten</span>
        </div>
        <div className="top-actions">
          {canRequest && (
            <button className="btn" onClick={() => { setReqModalOpen(true); setReqError(''); }}>
              ✦ Request konten{visibleRequests.length > 0 ? ` (${visibleRequests.length})` : ''}
            </button>
          )}
          {canCreate && <button className="btn primary" onClick={openCreate}>+ Konten baru</button>}
        </div>
      </div>

      <div className="div-tabs">
        {DIVISIONS.map((d) => (
          <button key={d.key} className={`div-tab ${division === d.key ? 'active' : ''}`} onClick={() => setDivision(d.key)}>
            <span className="div-dot" style={{ background: d.color }} />
            {d.label}
            <span className="div-count">{divCounts[d.key]}</span>
          </button>
        ))}
      </div>

      <div className="div-desc">
        <span className="bar" style={{ background: activeDiv.color }} />
        <span className="div-name">{division === 'semua' ? 'Semua Divisi' : `Divisi ${activeDiv.label}`}</span>
        <span>· {activeDiv.desc}</span>
        <select className="cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value as 'all' | Pillar)}>
          <option value="all">Semua kategori</option>
          {(Object.keys(PILLAR_LABEL) as Pillar[]).map((k) => (
            <option key={k} value={k}>{PILLAR_LABEL[k]}</option>
          ))}
        </select>
        <div className="range-tabs">
          {([['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['week', '7 Hari'], ['all', 'Semua']] as [Range, string][]).map(([k, label]) => (
            <button key={k} className={`range-tab ${range === k ? 'active' : ''}`} onClick={() => setRange(k)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="empty">Memuat board…</p>
      ) : (
        <div className="board">
          {(division === 'semua' || division === 'creative') && visibleRequests.length > 0 && (
            <div className="column">
              <div className="column-head">
                <span className="st-square" style={{ background: 'var(--req)' }} />
                <h3 style={{ color: 'var(--req)' }}>Request</h3>
                <span className="count">{visibleRequests.length}</span>
                <span className="owner-chip">pm</span>
              </div>
              <div className="col-body">
                {visibleRequests.map((rq) => (
                  <div className="card" key={rq.id} style={{ ['--card-accent' as never]: 'var(--req)' }}>
                    <div className="card-title">{rq.title}</div>
                    <div className="card-acc">
                      <span className="sq" />
                      {accName(rq.account_id)}
                    </div>
                    {rq.note && <div className="req-note">{rq.note}</div>}
                    {canLift && (
                      <button className="acc-btn lift-btn" disabled={reqBusy === rq.id}
                        onClick={(e) => { e.stopPropagation(); liftRequest(rq); }}>
                        {reqBusy === rq.id ? 'Memproses…' : '↑ Angkat → Drafting'}
                      </button>
                    )}
                    {canAcc && (
                      <button className="btn ghost req-reject" disabled={reqBusy === rq.id}
                        onClick={(e) => { e.stopPropagation(); rejectRequest(rq); }}>
                        Tolak
                      </button>
                    )}
                    <div className="card-foot">
                      <span className="flag-dot" style={{ background: 'var(--req)' }} />
                      {rq.requested_date
                        ? 'Butuh ' + new Date(rq.requested_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                        : 'Tanpa target tanggal'}
                      <span className="pic-avatar" title={rq.requester_name || 'PM'}>{initials(rq.requester_name)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {columns.map((s) => (
            <div className="column" key={s.key}>
              <div className="column-head">
                <span className="st-square" style={{ background: s.color }} />
                <h3 style={{ color: s.color }}>{s.label}</h3>
                <span className="count">{byStatus[s.key].length}</span>
                {division === 'semua' && <span className="owner-chip">{s.ownerTeam}</span>}
              </div>
              <div className="col-body">
                {byStatus[s.key].map((row) => {
                  const editable = canEditRow(profile, row.status);
                  const pic = picForCard(row);
                  const hasAsset = !!row.asset_url;
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className={`card ${editable ? '' : 'locked'}`}
                      style={{ ['--card-accent' as never]: statusDef(row.status).color }}
                      onClick={() => openEdit(row)}
                      onKeyDown={(e) => e.key === 'Enter' && openEdit(row)}
                      title={editable ? 'Klik untuk edit' : 'Lihat detail (tahap ini dikelola tim lain)'}
                    >
                      <div className="card-title" dangerouslySetInnerHTML={{ __html: mdToHtml(row.title) }} />
                      <div className="card-acc">
                        <span className="sq" />
                        {accName(row.account_id)}
                      </div>
                      {row.status === 'review' && canAcc && (
                        <button
                          className="acc-btn"
                          disabled={accBusy === row.id}
                          onClick={(e) => { e.stopPropagation(); accRow(row); }}
                        >
                          {accBusy === row.id ? 'Memproses…' : '✓ ACC → Siap Upload'}
                        </button>
                      )}
                      {row.status === 'review' && !canAcc && (
                        <div className="acc-wait">Menunggu ACC lead</div>
                      )}
                      <div className="card-foot">
                        <span className="flag-dot" style={{ background: hasAsset ? 'var(--green)' : 'var(--amber)' }} />
                        {hasAsset ? 'Aset siap' : 'Perlu link drive'}
                        {row.potensi_fyp && <span style={{ color: 'var(--st-review)' }}>· FYP</span>}
                        <span className="pic-avatar" title={pic || 'PIC belum di-assign'}>{initials(pic)}</span>
                      </div>
                    </div>
                  );
                })}
                {byStatus[s.key].length === 0 && <div className="col-empty">Tak ada konten pada rentang ini</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {reqModalOpen && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--req)' }} />
                  Request konten · PM
                </div>
                <div className="modal-title">Request Konten Baru</div>
                <div className="modal-sub">Masuk antrian Request di board — Creative yang mengangkatnya jadi Drafting.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setReqModalOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Judul / brief singkat</label>
                <textarea
                  ref={growRef}
                  value={reqForm.title}
                  onInput={autoGrow}
                  onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })}
                  placeholder="mis. Konten testimoni mitra untuk campaign Agustus"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Akun</label>
                  <select value={reqForm.account_id} onChange={(e) => setReqForm({ ...reqForm, account_id: e.target.value })}>
                    <option value="">— pilih —</option>
                    {accountsOfProject(projectFilter !== 'all' ? projectFilter : '').map((a) => (
                      <option key={a.id} value={a.id}>{a.handle}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Tanggal dibutuhkan</label>
                  <input type="date" value={reqForm.requested_date}
                    onChange={(e) => setReqForm({ ...reqForm, requested_date: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Catatan (opsional)</label>
                <textarea
                  ref={growRef}
                  value={reqForm.note}
                  onInput={autoGrow}
                  onChange={(e) => setReqForm({ ...reqForm, note: e.target.value })}
                  placeholder="Konteks, referensi, atau keperluan campaign"
                />
              </div>
              {reqError && <p className="error-msg">{reqError}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setReqModalOpen(false)} disabled={reqBusy === 'submit'}>Batal</button>
                <button className="btn primary" onClick={submitRequest} disabled={reqBusy === 'submit' || !reqForm.title.trim()}>
                  {reqBusy === 'submit' ? 'Mengirim…' : 'Kirim Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="overlay">
          <div className="modal-wrap">
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: editingDef.color }} />
                  {editing ? `${editingDef.label} · Tim ${editingDef.ownerTeam}` : 'Konten baru · Creative'}
                </div>
                <div className="modal-title">{editing ? 'Detail Konten' : 'Buat brief konten baru'}</div>
                <div className="modal-sub">
                  {readOnly
                    ? 'Mode lihat — tahap ini dikelola tim lain.'
                    : 'Creative mengisi brief & aset. Caption, jadwal, dan ads menyusul di Distribution & Ads.'}
                </div>
                {editing && (
                  <button
                    className={`umum-note ${fieldNotes('umum').length ? 'has' : ''} ${openNoteField === 'umum' ? 'open' : ''}`}
                    onClick={() => { setOpenNoteField(openNoteField === 'umum' ? null : 'umum'); setNewNote(''); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    Catatan umum
                    {fieldNotes('umum').length > 0 && <span className="umum-count">{fieldNotes('umum').length}</span>}
                  </button>
                )}
              </div>
              <button className="btn ghost modal-close" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div>
                <div className="modal-col-label">Brief utama</div>
                <div className="field">
                  <label>Hook / Brief{noteBtn('title')}</label>
                  <div
                    className={`rich-input ${readOnly ? 'ro' : ''}`}
                    contentEditable={!readOnly}
                    suppressContentEditableWarning
                    data-placeholder="Tulis hook & brief konten… mis. 5 film Indonesia hidden gem bulan ini"
                    ref={(el) => {
                      const key = editing ? editing.id : 'new';
                      if (el && el.dataset.init !== key) {
                        el.innerHTML = mdToHtml(form.title);
                        el.dataset.init = key;
                      }
                    }}
                    onInput={(e) => {
                      const md = htmlToMd(e.currentTarget).replace(/^\n+/, '');
                      setForm((f) => ({ ...f, title: md }));
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                        e.preventDefault();
                        document.execCommand('bold');
                        const md = htmlToMd(e.currentTarget).replace(/^\n+/, '');
                        setForm((f) => ({ ...f, title: md }));
                      }
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const text = e.clipboardData.getData('text/plain');
                      document.execCommand('insertText', false, text);
                    }}
                  />
                  <div className="hint">Blok teks lalu tekan Ctrl+B untuk bold.</div>
                </div>
                <div className="field">
                  <label>
                    Visual Hook (referensi){noteBtn('visual_hook')}
                    {isUrl(form.visual_hook) && (
                      <a className="open-link" href={form.visual_hook.trim()} target="_blank" rel="noopener noreferrer">Buka ↗</a>
                    )}
                  </label>
                  <input
                    value={form.visual_hook}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, visual_hook: e.target.value })}
                    placeholder="Link / nama file referensi"
                  />
                </div>
                <div className="field">
                  <label>Catatan produksi{noteBtn('production_note')}</label>
                  <textarea
                    ref={growRef}
                    value={form.production_note}
                    disabled={readOnly}
                    onInput={autoGrow}
                    onChange={(e) => setForm({ ...form, production_note: e.target.value })}
                    placeholder="mis. Ambil 3 detik pertama · gaya cepat"
                  />
                </div>
                <div className="field">
                  <label>Caption (diisi Distribution){noteBtn('caption')}</label>
                  <textarea
                    ref={growRef}
                    value={form.caption}
                    disabled={readOnly}
                    onInput={autoGrow}
                    onChange={(e) => setForm({ ...form, caption: e.target.value })}
                    placeholder="Caption final untuk upload"
                  />
                </div>
              </div>
              <div>
                <div className="modal-col-label">Detail &amp; aset</div>
                <div className="field">
                  <label>Project</label>
                  <select
                    value={form.project_id}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, project_id: e.target.value, account_id: '' })}
                  >
                    <option value="">— pilih —</option>
                    {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Akun{noteBtn('account')}</label>
                    <select value={form.account_id} disabled={readOnly} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                      <option value="">— pilih —</option>
                      {accountsOfProject(form.project_id).map((a) => <option key={a.id} value={a.id}>{a.handle}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Category Content{noteBtn('pillar')}</label>
                    <select value={form.pillar} disabled={readOnly} onChange={(e) => setForm({ ...form, pillar: e.target.value as Pillar })}>
                      {(Object.keys(PILLAR_LABEL) as Pillar[]).map((p) => <option key={p} value={p}>{PILLAR_LABEL[p]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>Status{noteBtn('status')}</label>
                  <div className="status-chip" style={{ ['--sc' as never]: editingDef.color }}>
                    <span className="sq" style={{ background: editingDef.color }} />
                    {editingDef.label} · {editingDef.ownerTeam}
                  </div>
                  {editing && nextStep && nextStep.allowed && (
                    <button className="btn primary flow-btn" disabled={flowBusy || saving} onClick={() => moveTo(nextStep.target)}>
                      {flowBusy ? 'Memproses…' : nextStep.label}
                    </button>
                  )}
                  {editing && nextStep && !nextStep.allowed && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      Perpindahan tahap ini menunggu {editing.status === 'review' ? 'ACC lead' : 'tim ' + statusDef(nextStep.target).ownerTeam}.
                    </div>
                  )}
                  {editing && canDelete && prevStep && (
                    <button className="btn ghost flow-back" disabled={flowBusy} onClick={() => moveTo(prevStep)}>
                      ↩ Kembalikan ke {statusDef(prevStep).label}
                    </button>
                  )}
                  {!editing && <div className="hint">Konten baru otomatis masuk Drafting — perpindahan tahap lewat tombol, diatur sistem.</div>}
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>Deadline{noteBtn('deadline')}</label>
                    <input type="date" value={form.deadline} disabled={readOnly} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Tanggal tayang{noteBtn('publish_date')}</label>
                    <input type="date" value={form.publish_date} disabled={readOnly} onChange={(e) => setForm({ ...form, publish_date: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>PIC Creative{noteBtn('pic')}</label>
                  <select value={form.pic_creative} disabled={readOnly} onChange={(e) => setForm({ ...form, pic_creative: e.target.value })}>
                    <option value="">—</option>
                    {membersOf('creative').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>PIC Distribution</label>
                    <select value={form.pic_distribution} disabled={readOnly} onChange={(e) => setForm({ ...form, pic_distribution: e.target.value })}>
                      <option value="">—</option>
                      {membersOf('distribution').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>PIC Ads</label>
                    <select value={form.pic_ads} disabled={readOnly} onChange={(e) => setForm({ ...form, pic_ads: e.target.value })}>
                      <option value="">—</option>
                      {membersOf('ads').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>
                    Link Drive (aset jadi){noteBtn('asset_url')}
                    {isUrl(form.asset_url) && (
                      <a className="open-link" href={form.asset_url.trim()} target="_blank" rel="noopener noreferrer">Buka ↗</a>
                    )}
                  </label>
                  <input
                    value={form.asset_url}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, asset_url: e.target.value })}
                    placeholder="mis. [05] FILM_2607.mov / link Drive"
                  />
                  <div className="hint">Tempel link/nama file final dari Drive. Distribution memakainya untuk upload.</div>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={form.potensi_fyp} disabled={readOnly} onChange={(e) => setForm({ ...form, potensi_fyp: e.target.checked })} />
                  Potensi FYP — sinyal ke tim Ads
                </label>
              </div>
            </div>
            <div className="modal-foot">
              <span className="foot-note">
                {error ? <span className="error-msg" style={{ margin: 0 }}>{error}</span> :
                  editing ? 'Perubahan tersimpan setelah klik Simpan.' : <>Konten akan masuk kolom <b>{editingDef.label}</b>.</>}
              </span>
              <div className="right">
                {editing && canDelete && <button className="btn danger" onClick={remove} disabled={saving}>Hapus</button>}
                <button className="btn" onClick={() => setModalOpen(false)} disabled={saving}>{readOnly ? 'Tutup' : 'Batal'}</button>
                {!readOnly && (
                  <button className="btn primary" onClick={save} disabled={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan'}
                  </button>
                )}
              </div>
            </div>
          </div>
          {noteSidePanel()}
          </div>
        </div>
      )}
    </>
  );
}
