'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, TEAM_LABEL, type Profile, type Project, type Team } from '@/lib/types';

interface Props {
  profile: Profile | null;
  projects: Project[];
  projectFilter: string;
}

/* ---------- tipe lokal (tidak menyentuh lib/types.ts) ---------- */
type Group = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_archived: boolean;
};

type Member = {
  id: string;
  group_id: string;
  user_id: string;
  is_admin: boolean;
  added_at: string;
  removed_at: string | null;
};

type Msg = {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

type Person = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  team: string | null;
  vertical: string | null;
};

/* ---------- warna per user (deterministik dari id) ---------- */
const HUES = [262, 340, 25, 45, 88, 152, 178, 205, 300, 12, 120, 232];

const hueOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
};

const userTint = (id: string) => {
  const h = hueOf(id);
  return {
    text: `hsl(${h} 70% 62%)`,
    bg: `hsl(${h} 55% 50% / 0.13)`,
    line: `hsl(${h} 60% 55% / 0.55)`,
    avBg: `hsl(${h} 55% 50% / 0.22)`,
  };
};

/* ---------- util ---------- */
const nameOf = (p: Person | undefined) => p?.full_name || p?.email || 'Pengguna';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date();
  yst.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hari ini';
  if (same(d, yst)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

const fmtRelative = (iso: string | undefined) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}h`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};

export default function ChatView({ profile, projects, projectFilter }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [activity, setActivity] = useState<Record<string, string>>({});
  const [reads, setReads] = useState<Record<string, string>>({});

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [kickM, setKickM] = useState<Member | null>(null);
  const [kickBusy, setKickBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [form, setForm] = useState({ project_id: '', name: '', description: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  /** Pencarian pada panel "Tambah anggota" grup aktif. Sengaja terpisah dari
   *  `search` milik modal Buat grup baru — dua-duanya bisa terbuka bergantian
   *  dan saling menghapus isian kalau dipakai bersama. */
  const [cariAnggota, setCariAnggota] = useState('');
  const [timAnggota, setTimAnggota] = useState('');

  const endRef = useRef<HTMLDivElement>(null);

  const peopleMap = useMemo(() => {
    const m = new Map<string, Person>();
    people.forEach((p) => m.set(p.id, p));
    return m;
  }, [people]);

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach((p) => m.set(p.id, p));
    return m;
  }, [projects]);

  const canCreate = profile?.role === 'superadmin' || profile?.role === 'manager';

  /* ---------- loaders ---------- */
  const loadPeople = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id,full_name,email,role,team,vertical')
      .eq('is_active', true)
      .order('full_name');
    setPeople((data as Person[]) || []);
  }, []);

  const loadGroups = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_groups')
      .select('*')
      .eq('is_archived', false)
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    setGroups((data as Group[]) || []);
  }, []);

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('project_group_members').select('*');
    setMembers((data as Member[]) || []);
  }, []);

  const loadActivity = useCallback(async () => {
    const { data } = await supabase
      .from('project_group_messages')
      .select('group_id,created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    const map: Record<string, string> = {};
    ((data as { group_id: string; created_at: string }[]) || []).forEach((r) => {
      if (!map[r.group_id]) map[r.group_id] = r.created_at;
    });
    setActivity(map);
  }, []);

  const loadReads = useCallback(async () => {
    const { data } = await supabase.from('project_group_reads').select('group_id,last_read_at');
    const map: Record<string, string> = {};
    ((data as { group_id: string; last_read_at: string }[]) || []).forEach((r) => {
      map[r.group_id] = r.last_read_at;
    });
    setReads(map);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadPeople(), loadGroups(), loadMembers(), loadActivity(), loadReads()]);
      setLoading(false);
    })();
  }, [loadPeople, loadGroups, loadMembers, loadActivity, loadReads]);

  /* ---------- realtime: pesan masuk (semua grup) ---------- */
  useEffect(() => {
    const ch = supabase
      .channel('cv-msg-all')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_group_messages' },
        (payload) => {
          const nm = payload.new as Msg;
          setActivity((prev) => ({ ...prev, [nm.group_id]: nm.created_at }));
          if (nm.group_id !== activeId) return;
          setMessages((prev) => (prev.some((x) => x.id === nm.id) ? prev : [...prev, nm]));
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  /* ---------- realtime: perubahan keanggotaan ---------- */
  useEffect(() => {
    const ch = supabase
      .channel('cv-members')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_group_members' },
        () => {
          loadMembers();
          loadGroups();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadMembers, loadGroups]);

  /* ---------- derived ---------- */
  const visibleGroups = useMemo(() => {
    const list =
      projectFilter === 'all' ? groups : groups.filter((g) => g.project_id === projectFilter);
    return [...list].sort((a, b) => {
      const ta = activity[a.id] || a.created_at;
      const tb = activity[b.id] || b.created_at;
      return tb.localeCompare(ta);
    });
  }, [groups, projectFilter, activity]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeId) || null,
    [groups, activeId]
  );

  const activeMembers = useMemo(
    () => members.filter((m) => m.group_id === activeId && !m.removed_at),
    [members, activeId]
  );

  const pastMembers = useMemo(
    () => members.filter((m) => m.group_id === activeId && m.removed_at),
    [members, activeId]
  );

  const iAmAdmin = useMemo(() => {
    if (profile?.role === 'superadmin') return true;
    return activeMembers.some((m) => m.user_id === profile?.id && m.is_admin);
  }, [activeMembers, profile]);

  const iAmMember = useMemo(
    () => activeMembers.some((m) => m.user_id === profile?.id),
    [activeMembers, profile]
  );

  const memberCount = useCallback(
    (gid: string) => members.filter((m) => m.group_id === gid && !m.removed_at).length,
    [members]
  );

  const hasUnread = useCallback(
    (gid: string) => {
      const last = activity[gid];
      if (!last) return false;
      const read = reads[gid];
      if (!read) return true;
      return last > read;
    },
    [activity, reads]
  );

  /* kandidat anggota: se-vertical dengan project, atau KIG/ALL/superadmin */
  const candidates = useMemo(() => {
    const proj = projectMap.get(form.project_id);
    const v = proj?.vertical;
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => {
        if (p.id === profile?.id) return false;
        if (!v) return true;
        if (p.role === 'superadmin') return true;
        if (p.vertical === 'KIG' || p.vertical === 'ALL') return true;
        return p.vertical === v;
      })
      .filter((p) => {
        if (!q) return true;
        return (
          (p.full_name || '').toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.team || '').toLowerCase().includes(q)
        );
      });
  }, [people, form.project_id, projectMap, search, profile]);

  /* kandidat tambah anggota ke grup aktif */
  const addCandidates = useMemo(() => {
    if (!activeGroup) return [];
    const proj = projectMap.get(activeGroup.project_id);
    const v = proj?.vertical;
    const already = new Set(activeMembers.map((m) => m.user_id));
    return people
      .filter((p) => {
        if (already.has(p.id)) return false;
        if (!v) return true;
        if (p.role === 'superadmin') return true;
        if (p.vertical === 'KIG' || p.vertical === 'ALL') return true;
        return p.vertical === v;
      })
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'id'));
  }, [people, activeGroup, projectMap, activeMembers]);

  /** Tim yang benar-benar ada di antara kandidat — bukan seluruh 21 jabatan,
   *  supaya penyaringnya tidak penuh pilihan yang hasilnya nol. */
  const timKandidat = useMemo(() => {
    const set = new Set<string>();
    for (const p of addCandidates) if (p.team) set.add(p.team);
    return [...set].sort((a, b) =>
      (TEAM_LABEL[a as Team] || a).localeCompare(TEAM_LABEL[b as Team] || b, 'id'));
  }, [addCandidates]);

  /** Hasil setelah disaring nama/email dan tim. */
  const addTersaring = useMemo(() => {
    const q = cariAnggota.trim().toLowerCase();
    return addCandidates.filter((p) => {
      if (timAnggota && p.team !== timAnggota) return false;
      if (!q) return true;
      return (
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.team || '').toLowerCase().includes(q) ||
        (TEAM_LABEL[p.team as Team] || '').toLowerCase().includes(q)
      );
    });
  }, [addCandidates, cariAnggota, timAnggota]);

  /* ---------- actions ---------- */
  const openGroup = async (g: Group) => {
    setActiveId(g.id);
    setShowMembers(false);
    setErr(null);
    const { data, error } = await supabase
      .from('project_group_messages')
      .select('*')
      .eq('group_id', g.id)
      .is('deleted_at', null)
      .order('created_at')
      .limit(300);
    if (error) setErr(error.message);
    setMessages((data as Msg[]) || []);
    setTimeout(() => endRef.current?.scrollIntoView(), 60);

    if (profile) {
      const now = new Date().toISOString();
      await supabase
        .from('project_group_reads')
        .upsert({ group_id: g.id, user_id: profile.id, last_read_at: now });
      setReads((prev) => ({ ...prev, [g.id]: now }));
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeGroup || !profile) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('project_group_messages')
      .insert({ group_id: activeGroup.id, sender_id: profile.id, body })
      .select()
      .single();
    setBusy(false);
    if (error) {
      setErr('Gagal mengirim — pastikan kamu masih anggota grup ini.');
      return;
    }
    setDraft('');
    const nm = data as Msg;
    setMessages((prev) => (prev.some((x) => x.id === nm.id) ? prev : [...prev, nm]));
    setActivity((prev) => ({ ...prev, [nm.group_id]: nm.created_at }));
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
  };

  const createGroup = async () => {
    if (!form.project_id || !form.name.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from('project_groups')
      .insert({
        project_id: form.project_id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        created_by: profile.id,
      })
      .select()
      .single();

    if (error || !data) {
      setBusy(false);
      setErr('Gagal membuat grup — hanya lead/superadmin yang bisa, dan project harus dalam unitmu.');
      return;
    }

    const g = data as Group;
    const rows = [
      { group_id: g.id, user_id: profile.id, is_admin: true, added_by: profile.id },
      ...picked.map((uid) => ({
        group_id: g.id,
        user_id: uid,
        is_admin: false,
        added_by: profile.id,
      })),
    ];
    const { error: mErr } = await supabase.from('project_group_members').insert(rows);
    setBusy(false);
    if (mErr) setErr('Grup dibuat, tapi sebagian anggota gagal ditambahkan: ' + mErr.message);

    setShowNew(false);
    setForm({ project_id: '', name: '', description: '' });
    setPicked([]);
    setSearch('');
    await Promise.all([loadGroups(), loadMembers()]);
    openGroup(g);
  };

  /**
   * Keluarkan anggota dari grup. Konfirmasinya dulu memakai window.confirm —
   * diblokir di lingkungan ini, jadi tombolnya diklik tanpa reaksi apa pun.
   */
  const kick = async () => {
    const m = kickM;
    if (!m) return;
    setKickBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from('project_group_members')
      .update({ removed_at: new Date().toISOString(), removed_by: profile?.id })
      .eq('id', m.id)
      .select('id');
    setKickBusy(false);
    if (error) {
      setErr('Gagal mengeluarkan anggota — hanya admin grup yang bisa.');
      setKickM(null);
      return;
    }
    // UPDATE yang ditolak RLS mengubah 0 baris tanpa error.
    if (!data || data.length === 0) {
      setErr('Tidak ada yang berubah — wewenang akunmu tidak mencukupi.');
      setKickM(null);
      return;
    }
    setKickM(null);
    loadMembers();
  };

  const addMember = async (uid: string) => {
    if (!activeGroup || !profile) return;
    setErr(null);
    const existing = members.find((m) => m.group_id === activeGroup.id && m.user_id === uid);
    if (existing) {
      // Orangnya pernah ada di grup ini lalu dikeluarkan — barisnya dihidupkan
      // lagi, bukan dibuat baru, supaya tidak ada baris kembar.
      const { data, error } = await supabase
        .from('project_group_members')
        .update({ removed_at: null, removed_by: null, added_by: profile.id })
        .eq('id', existing.id)
        .select('id');
      if (error) { setErr('Gagal menambah anggota.'); return; }
      // UPDATE yang ditolak RLS mengubah 0 baris tanpa error.
      if (!data || data.length === 0) {
        setErr('Tidak ada yang berubah — hanya admin grup yang bisa menambah anggota.');
        return;
      }
    } else {
      const { error } = await supabase.from('project_group_members').insert({
        group_id: activeGroup.id,
        user_id: uid,
        is_admin: false,
        added_by: profile.id,
      });
      if (error) { setErr('Gagal menambah anggota — hanya admin grup yang bisa.'); return; }
    }
    loadMembers();
  };

  const toggleAdmin = async (m: Member) => {
    const { error } = await supabase
      .from('project_group_members')
      .update({ is_admin: !m.is_admin })
      .eq('id', m.id);
    if (error) setErr('Gagal mengubah status admin.');
    loadMembers();
  };

  if (!profile) return null;

  /* ---------- render ---------- */
  return (
    <div className="content-area">
      <style>{CSS}</style>

      <div className="cv-wrap">
        {/* ================= SIDEBAR GRUP ================= */}
        <div className="cv-list">
          <div className="cv-list-head">
            <div>
              <div className="cv-list-title">Chat Project</div>
              <div className="cv-list-sub">
                {visibleGroups.length} grup
                {projectFilter !== 'all' ? ' · terfilter' : ''}
              </div>
            </div>
            {canCreate && (
              <button className="cv-plus" title="Buat grup baru" onClick={() => setShowNew(true)}>
                +
              </button>
            )}
          </div>

          <div className="cv-list-body">
            {loading ? (
              <div className="cv-empty">Memuat…</div>
            ) : visibleGroups.length === 0 ? (
              <div className="cv-empty">
                Belum ada grup.
                {canCreate ? ' Klik + untuk membuat grup pertama.' : ' Kamu belum dimasukkan ke grup mana pun.'}
              </div>
            ) : (
              visibleGroups.map((g) => {
                const proj = projectMap.get(g.project_id);
                const unread = hasUnread(g.id) && g.id !== activeId;
                return (
                  <button
                    key={g.id}
                    className={`cv-item ${activeId === g.id ? 'active' : ''}`}
                    onClick={() => openGroup(g)}
                  >
                    <div className="cv-item-av">{initials(g.name)}</div>
                    <div className="cv-item-body">
                      <div className="cv-item-top">
                        <span className="cv-item-name">{g.name}</span>
                        <span className="cv-item-time">{fmtRelative(activity[g.id])}</span>
                      </div>
                      <div className="cv-item-meta">
                        {proj?.name || 'Project'} · {memberCount(g.id)} anggota
                      </div>
                    </div>
                    {unread && <span className="cv-dot" />}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ================= PANEL PESAN ================= */}
        <div className="cv-thread">
          {!activeGroup ? (
            <div className="cv-blank">
              <div className="cv-blank-ic">💬</div>
              <div className="cv-blank-t">Pilih grup untuk mulai mengobrol</div>
              <div className="cv-blank-s">
                Setiap grup terikat pada satu project. Hanya anggota yang bisa membaca isinya.
              </div>
            </div>
          ) : (
            <>
              <div className="cv-head">
                <div>
                  <div className="cv-head-name">{activeGroup.name}</div>
                  <div className="cv-head-sub">
                    {projectMap.get(activeGroup.project_id)?.name || 'Project'} ·{' '}
                    {activeMembers.length} anggota
                    {activeGroup.description ? ' · ' + activeGroup.description : ''}
                  </div>
                </div>
                <button className="cv-mbtn" onClick={() => setShowMembers(!showMembers)}>
                  {showMembers ? 'Tutup' : 'Anggota'}
                </button>
              </div>

              {err && (
                <div className="cv-err">
                  {err} <button onClick={() => setErr(null)}>✕</button>
                </div>
              )}

              <div className="cv-main">
                <div className="cv-msgs">
                  {messages.length === 0 ? (
                    <div className="cv-empty">Belum ada pesan. Mulai percakapan.</div>
                  ) : (
                    messages.map((m, i) => {
                      const mine = m.sender_id === profile.id;
                      const prev = messages[i - 1];
                      const newDay =
                        !prev ||
                        new Date(prev.created_at).toDateString() !==
                          new Date(m.created_at).toDateString();
                      const sameSender = prev && prev.sender_id === m.sender_id && !newDay;
                      const person = peopleMap.get(m.sender_id);
                      const tint = userTint(m.sender_id);
                      return (
                        <div key={m.id}>
                          {newDay && (
                            <div className="cv-daysep">
                              <span>{fmtDay(m.created_at)}</span>
                            </div>
                          )}
                          <div className={`cv-row ${mine ? 'me' : ''}`}>
                            {!mine && (
                              <div
                                className={`cv-av ${sameSender ? 'ghost' : ''}`}
                                style={
                                  sameSender
                                    ? undefined
                                    : { background: tint.avBg, color: tint.text }
                                }
                              >
                                {sameSender ? '' : initials(nameOf(person))}
                              </div>
                            )}
                            <div
                              className={`cv-bub ${mine ? 'me' : 'them'}`}
                              style={
                                mine
                                  ? undefined
                                  : { background: tint.bg, borderLeft: `2px solid ${tint.line}` }
                              }
                            >
                              {!mine && !sameSender && (
                                <div className="cv-sender" style={{ color: tint.text }}>
                                  {nameOf(person)}
                                  {person?.team ? <span> · {person.team}</span> : null}
                                </div>
                              )}
                              <div className="cv-text">{m.body}</div>
                              <div className="cv-time">{fmtTime(m.created_at)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={endRef} />
                </div>

                {/* ---------- panel anggota ---------- */}
                {showMembers && (
                  <div className="cv-side">
                    <div className="cv-side-t">Anggota aktif ({activeMembers.length})</div>
                    {activeMembers.map((m) => {
                      const p = peopleMap.get(m.user_id);
                      const t = userTint(m.user_id);
                      return (
                        <div key={m.id} className="cv-mrow">
                          <div className="cv-mav" style={{ background: t.avBg, color: t.text }}>
                            {initials(nameOf(p))}
                          </div>
                          <div className="cv-mbody">
                            <div className="cv-mname">
                              {nameOf(p)}
                              {m.user_id === profile.id ? ' (kamu)' : ''}
                            </div>
                            <div className="cv-mmeta">
                              {p?.team || '—'}
                              {m.is_admin ? ' · admin' : ''}
                            </div>
                          </div>
                          {iAmAdmin && m.user_id !== profile.id && (
                            <div className="cv-macts">
                              <button title="Jadikan/lepas admin" onClick={() => toggleAdmin(m)}>
                                ★
                              </button>
                              <button title="Keluarkan dari grup" onClick={() => setKickM(m)}>
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {pastMembers.length > 0 && (
                      <>
                        <div className="cv-side-t muted">Sudah keluar ({pastMembers.length})</div>
                        {pastMembers.map((m) => (
                          <div key={m.id} className="cv-mrow dim">
                            <div className="cv-mav">{initials(nameOf(peopleMap.get(m.user_id)))}</div>
                            <div className="cv-mbody">
                              <div className="cv-mname">{nameOf(peopleMap.get(m.user_id))}</div>
                              <div className="cv-mmeta">
                                keluar {new Date(m.removed_at as string).toLocaleDateString('id-ID')}
                              </div>
                            </div>
                            {iAmAdmin && (
                              <div className="cv-macts">
                                <button title="Masukkan kembali" onClick={() => addMember(m.user_id)}>
                                  ↩
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}

                    {iAmAdmin && addCandidates.length > 0 && (
                      <>
                        <div className="cv-side-t muted">
                          Tambah anggota
                          <span style={{ opacity: 0.7, textTransform: 'none', letterSpacing: 0 }}>
                            {' '}· {addTersaring.length} dari {addCandidates.length}
                          </span>
                        </div>

                        {/* Dulu ini satu <select> panjang berisi semua orang. Dengan
                            35+ akun, mencari satu nama di situ menyiksa. Sekarang
                            ada pencarian nama/email/tim dan penyaring tim. */}
                        <input
                          className="cv-search"
                          value={cariAnggota}
                          onChange={(e) => setCariAnggota(e.target.value)}
                          placeholder="Cari nama, email, atau tim…"
                        />

                        {timKandidat.length > 1 && (
                          <select
                            className="cv-add"
                            style={{ marginTop: 0, marginBottom: 8 }}
                            value={timAnggota}
                            onChange={(e) => setTimAnggota(e.target.value)}
                          >
                            <option value="">Semua tim</option>
                            {timKandidat.map((t) => (
                              <option key={t} value={t}>{TEAM_LABEL[t as Team] || t}</option>
                            ))}
                          </select>
                        )}

                        <div className="cv-picker">
                          {addTersaring.length === 0 ? (
                            <div className="cv-note" style={{ padding: '8px 8px' }}>
                              Tidak ada yang cocok.
                              {(cariAnggota || timAnggota) && (
                                <>
                                  {' '}
                                  <button
                                    type="button"
                                    onClick={() => { setCariAnggota(''); setTimAnggota(''); }}
                                    style={{
                                      background: 'transparent', border: 0, padding: 0,
                                      font: 'inherit', color: 'var(--accent)', cursor: 'pointer',
                                      textDecoration: 'underline', textUnderlineOffset: 3,
                                    }}
                                  >
                                    Kosongkan penyaring
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            addTersaring.map((p) => (
                              <div
                                key={p.id}
                                className="cv-pick"
                                role="button"
                                tabIndex={0}
                                title={p.email}
                                onClick={() => addMember(p.id)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') addMember(p.id); }}
                              >
                                <div className="cv-mav sm">{initials(nameOf(p))}</div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="cv-mname">{nameOf(p)}</div>
                                  <div
                                    style={{
                                      fontSize: 11, color: 'var(--muted, #8b8d92)',
                                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {p.team ? (TEAM_LABEL[p.team as Team] || p.team) : 'Tanpa tim'}
                                  </div>
                                </div>
                                <span style={{ color: 'var(--accent)', fontSize: 15, lineHeight: 1 }}>+</span>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {iAmMember ? (
                <div className="cv-compose">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder={`Tulis pesan ke ${activeGroup.name}…`}
                  />
                  <button onClick={send} disabled={busy || !draft.trim()}>
                    ➤
                  </button>
                </div>
              ) : (
                <div className="cv-readonly">
                  Kamu bukan anggota grup ini — hanya bisa membaca.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ================= MODAL BUAT GRUP ================= */}
      {kickM && (
        <div className="cv-ovl" onClick={() => !kickBusy && setKickM(null)}>
          <div className="cv-modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-h">
              <div>
                <div className="cv-modal-t">
                  Keluarkan {nameOf(peopleMap.get(kickM.user_id))}?
                </div>
                <div className="cv-modal-s">
                  Dia tidak lagi bisa membuka grup ini dan tidak menerima pesan barunya.
                </div>
              </div>
              <button className="cv-x" disabled={kickBusy} onClick={() => setKickM(null)}>&#10005;</button>
            </div>

            <div className="cv-modal-b">
              <div
                style={{
                  background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
                  borderLeft: '2px solid var(--amber)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                Pesan yang sudah dia kirim <b style={{ color: 'var(--text)' }}>tetap ada</b> di grup.
                Kalau nanti perlu, dia bisa dimasukkan lagi.
              </div>
            </div>

            <div className="cv-modal-f">
              <button className="btn" disabled={kickBusy} onClick={() => setKickM(null)}>Batal</button>
              <button className="btn primary" disabled={kickBusy} onClick={kick}>
                {kickBusy ? 'Mengeluarkan\u2026' : 'Keluarkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="cv-ovl" onClick={() => setShowNew(false)}>
          <div className="cv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-h">
              <div>
                <div className="cv-modal-t">Buat grup baru</div>
                <div className="cv-modal-s">
                  Anggota dipilih sekarang dan tetap sampai dikeluarkan.
                </div>
              </div>
              <button className="cv-x" onClick={() => setShowNew(false)}>
                ✕
              </button>
            </div>

            <div className="cv-modal-b">
              <div className="field">
                <label>Project</label>
                <select
                  value={form.project_id}
                  onChange={(e) => {
                    setForm({ ...form, project_id: e.target.value });
                    setPicked([]);
                  }}
                >
                  <option value="">Pilih project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.vertical ? ` · ${p.vertical}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Nama grup</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="mis. Tim Harian Sekretariat Jatim"
                />
              </div>

              <div className="field">
                <label>Deskripsi (opsional)</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="mis. koordinasi konten & jadwal tayang"
                />
              </div>

              <div className="field">
                <label>
                  Anggota{' '}
                  <span className="cv-count">
                    {picked.length + 1} terpilih (kamu otomatis jadi admin)
                  </span>
                </label>
                {!form.project_id ? (
                  <div className="cv-note">Pilih project dulu untuk melihat daftar orang.</div>
                ) : (
                  <>
                    <input
                      className="cv-search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nama, email, atau tim…"
                    />
                    <div className="cv-picker">
                      {candidates.length === 0 ? (
                        <div className="cv-note">Tidak ada orang yang cocok.</div>
                      ) : (
                        candidates.map((p) => (
                          <label key={p.id} className="cv-pick">
                            <input
                              type="checkbox"
                              checked={picked.includes(p.id)}
                              onChange={(e) =>
                                setPicked(
                                  e.target.checked
                                    ? [...picked, p.id]
                                    : picked.filter((x) => x !== p.id)
                                )
                              }
                            />
                            <div className="cv-mav sm">{initials(nameOf(p))}</div>
                            <div className="cv-mbody">
                              <div className="cv-mname">{nameOf(p)}</div>
                              <div className="cv-mmeta">
                                {p.team || '—'} · {p.role} · {p.vertical || '—'}
                              </div>
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {err && <div className="cv-err inline">{err}</div>}
            </div>

            <div className="cv-modal-f">
              <button className="btn" onClick={() => setShowNew(false)}>
                Batal
              </button>
              <button
                className="btn primary"
                onClick={createGroup}
                disabled={busy || !form.project_id || !form.name.trim()}
              >
                {busy ? 'Membuat…' : 'Buat grup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= STYLE (scoped, prefix cv-) ================= */
const CSS = `
.cv-wrap{display:flex;gap:14px;height:calc(100vh - 90px);min-height:520px}
.cv-list{width:288px;flex:0 0 288px;display:flex;flex-direction:column;
  background:var(--panel,#111214);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:14px;overflow:hidden}
.cv-list-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;
  border-bottom:1px solid var(--border,rgba(255,255,255,.07))}
.cv-list-title{font-size:15px;font-weight:650;color:var(--text,#e8e9ea)}
.cv-list-sub{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#8b8d92);margin-top:3px}
.cv-plus{width:28px;height:28px;border-radius:8px;border:1px solid var(--border,rgba(255,255,255,.1));
  background:var(--raised,#191A1D);color:var(--text,#e8e9ea);font-size:16px;line-height:1;cursor:pointer}
.cv-plus:hover{background:var(--accent,#2f7cf6);border-color:transparent;color:#fff}
.cv-list-body{flex:1;overflow-y:auto;padding:8px}
.cv-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border-radius:10px;
  background:transparent;border:1px solid transparent;cursor:pointer;text-align:left;margin-bottom:2px}
.cv-item:hover{background:var(--raised,#191A1D)}
.cv-item.active{background:var(--raised,#191A1D);border-color:var(--border,rgba(255,255,255,.09))}
.cv-item-av{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:var(--accent,#2f7cf6);color:#fff;font-size:12px;font-weight:600}
.cv-item-body{flex:1;min-width:0}
.cv-item-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.cv-item-name{font-size:13.5px;font-weight:550;color:var(--text,#e8e9ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-item-time{font-size:10.5px;color:var(--muted,#8b8d92);flex:0 0 auto}
.cv-item-meta{font-size:11.5px;color:var(--muted,#8b8d92);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-dot{width:7px;height:7px;border-radius:50%;background:var(--accent,#2f7cf6);flex:0 0 7px}

.cv-thread{flex:1;min-width:0;display:flex;flex-direction:column;
  background:var(--panel,#111214);border:1px solid var(--border,rgba(255,255,255,.07));border-radius:14px;overflow:hidden}
.cv-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;
  border-bottom:1px solid var(--border,rgba(255,255,255,.07))}
.cv-head-name{font-size:15px;font-weight:650;color:var(--text,#e8e9ea)}
.cv-head-sub{font-size:11.5px;color:var(--muted,#8b8d92);margin-top:3px}
.cv-mbtn{padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;
  background:var(--raised,#191A1D);border:1px solid var(--border,rgba(255,255,255,.09));color:var(--text,#e8e9ea)}
.cv-mbtn:hover{border-color:var(--accent,#2f7cf6)}
.cv-main{flex:1;display:flex;min-height:0}
.cv-msgs{flex:1;overflow-y:auto;padding:18px}
.cv-daysep{display:flex;align-items:center;justify-content:center;margin:14px 0 10px}
.cv-daysep span{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#8b8d92);
  background:var(--raised,#191A1D);padding:4px 12px;border-radius:20px}
.cv-row{display:flex;gap:9px;margin-bottom:3px;align-items:flex-end}
.cv-row.me{justify-content:flex-end}
.cv-av{width:28px;height:28px;flex:0 0 28px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  background:var(--raised,#191A1D);color:var(--muted,#8b8d92);font-size:10.5px;font-weight:600}
.cv-av.ghost{background:transparent}
.cv-bub{max-width:min(560px,72%);padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;
  word-break:break-word;white-space:pre-wrap}
.cv-bub.them{background:var(--raised,#191A1D);color:var(--text,#e8e9ea);border-bottom-left-radius:5px}
.cv-bub.them .cv-text{color:var(--text,#e8e9ea)}
.cv-bub.me{background:var(--accent,#2f7cf6);color:#fff;border-bottom-right-radius:5px}
.cv-sender{font-size:11.5px;font-weight:600;margin-bottom:3px;color:var(--accent,#2f7cf6)}
.cv-sender span{font-weight:400;opacity:.6;color:var(--muted,#8b8d92)}
.cv-time{font-size:10px;opacity:.55;margin-top:4px;text-align:right}
.cv-side{width:250px;flex:0 0 250px;border-left:1px solid var(--border,rgba(255,255,255,.07));
  overflow-y:auto;padding:14px}
.cv-side-t{font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#8b8d92);margin:4px 0 10px}
.cv-side-t.muted{margin-top:18px;opacity:.75}
.cv-mrow{display:flex;align-items:center;gap:9px;padding:6px 0}
.cv-mrow.dim{opacity:.45}
.cv-mav{width:28px;height:28px;flex:0 0 28px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  background:var(--raised,#191A1D);color:var(--text,#e8e9ea);font-size:10.5px;font-weight:600}
.cv-mav.sm{width:26px;height:26px;flex:0 0 26px}
.cv-mbody{flex:1;min-width:0}
.cv-mname{font-size:12.5px;color:var(--text,#e8e9ea);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cv-mmeta{font-size:10.5px;color:var(--muted,#8b8d92);margin-top:1px}
.cv-macts{display:flex;gap:4px}
.cv-macts button{width:22px;height:22px;border-radius:6px;font-size:11px;cursor:pointer;
  background:transparent;border:1px solid var(--border,rgba(255,255,255,.1));color:var(--muted,#8b8d92)}
.cv-macts button:hover{color:var(--text,#e8e9ea);border-color:var(--accent,#2f7cf6)}
.cv-add{width:100%;margin-top:6px}
.cv-compose{display:flex;gap:9px;padding:13px 16px;border-top:1px solid var(--border,rgba(255,255,255,.07))}
.cv-compose input{flex:1;padding:10px 14px;border-radius:10px;font-size:13.5px;
  background:var(--raised,#191A1D);border:1px solid var(--border,rgba(255,255,255,.08));color:var(--text,#e8e9ea);outline:none}
.cv-compose input:focus{border-color:var(--accent,#2f7cf6)}
.cv-compose button{width:40px;border-radius:10px;border:none;cursor:pointer;
  background:var(--accent,#2f7cf6);color:#fff;font-size:14px}
.cv-compose button:disabled{opacity:.4;cursor:not-allowed}
.cv-readonly{padding:14px 16px;font-size:12px;color:var(--muted,#8b8d92);text-align:center;
  border-top:1px solid var(--border,rgba(255,255,255,.07))}
.cv-blank{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:40px}
.cv-blank-ic{font-size:30px;opacity:.5}
.cv-blank-t{font-size:14px;color:var(--text,#e8e9ea)}
.cv-blank-s{font-size:12px;color:var(--muted,#8b8d92);text-align:center;max-width:340px;line-height:1.6}
.cv-empty{padding:26px 18px;font-size:12.5px;color:var(--muted,#8b8d92);text-align:center;line-height:1.6}
.cv-err{margin:10px 16px;padding:9px 12px;border-radius:9px;font-size:12px;
  background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#f87171;
  display:flex;justify-content:space-between;gap:10px}
.cv-err.inline{margin:0}
.cv-err button{background:none;border:none;color:inherit;cursor:pointer}

.cv-ovl{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;z-index:200;padding:20px}
.cv-modal{width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;
  background:var(--panel,#111214);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:16px;overflow:hidden}
.cv-modal-h{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 20px;
  border-bottom:1px solid var(--border,rgba(255,255,255,.07))}
.cv-modal-t{font-size:15px;font-weight:650;color:var(--text,#e8e9ea)}
.cv-modal-s{font-size:11.5px;color:var(--muted,#8b8d92);margin-top:3px}
.cv-x{background:none;border:none;color:var(--muted,#8b8d92);font-size:14px;cursor:pointer}
.cv-modal-b{padding:18px 20px;overflow-y:auto;flex:1}
.cv-modal-f{display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;
  border-top:1px solid var(--border,rgba(255,255,255,.07))}
.cv-count{font-weight:400;color:var(--muted,#8b8d92);font-size:11px}
.cv-note{font-size:12px;color:var(--muted,#8b8d92);padding:10px 0}
.cv-search{width:100%;margin-bottom:8px}
.cv-picker{max-height:210px;overflow-y:auto;border:1px solid var(--border,rgba(255,255,255,.08));
  border-radius:10px;padding:6px}
.cv-pick{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer}
.cv-pick:hover{background:var(--raised,#191A1D)}
.cv-pick input{width:15px;height:15px;flex:0 0 15px;cursor:pointer}

@media(max-width:900px){
  .cv-wrap{flex-direction:column;height:auto}
  .cv-list{width:100%;flex:none;max-height:260px}
  .cv-thread{min-height:460px}
  .cv-side{position:absolute;right:0;top:0;bottom:0;background:var(--panel,#111214);z-index:5}
}
`;
