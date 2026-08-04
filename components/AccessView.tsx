'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, tagColor, VERTICALS, type Account, type ContentCategory, type Profile, type Project, type Role, type Team, type TeamMember } from '@/lib/types';
import { sigma, type SigmaProject } from '@/lib/sigma';

const ROLES: Role[] = ['superadmin', 'manager', 'tim'];
const TEAMS: (Team | '')[] = ['', 'delta', 'creative', 'distribution', 'ads', 'pm', 'finance'];
const MEMBER_TEAMS: Team[] = ['creative', 'distribution', 'ads', 'delta'];

interface Props {
  selfId: string;
  onAccountsChanged?: () => void;
  activeProjectId?: string;
  activeProjectName?: string | null;
}

/* ============================================================
   Combobox Label — tampil sebagai teks bersih di tabel, berubah
   jadi input + panel pilihan saat diklik. Panel pakai position
   fixed supaya tidak terpotong oleh scroll tabel.
   ============================================================ */

/* Warna diambil dari tagColor() di lib/types.ts — dipakai bersama dengan
   Board, supaya warna kategori di sini dan warna kartu di papan selalu sama. */
function LabelChip({ text }: { text: string }) {
  const c = tagColor(text);
  return (
    <span
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        background: c + '1f',
        color: c,
        border: '1px solid ' + c + '3d',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.5,
        verticalAlign: 'middle',
      }}
    >
      {text}
    </span>
  );
}

function PopItem({ label, onPick, active, accent, muted, chip }: {
  label: string;
  onPick: () => void;
  active?: boolean;
  accent?: boolean;
  muted?: boolean;
  chip?: boolean;
}) {
  const [hv, setHv] = useState(false);
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      onMouseEnter={() => setHv(true)}
      onMouseLeave={() => setHv(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        background: hv ? 'rgba(255,255,255,.06)' : 'transparent',
        border: 'none',
        borderRadius: 7,
        padding: '7px 10px',
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        color: accent ? 'var(--accent)' : muted ? 'var(--text-3)' : 'var(--text)',
        transition: 'background .12s',
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {chip ? <LabelChip text={label} /> : label}
      </span>
      {active && <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓</span>}
    </button>
  );
}

function LabelCell({ value, options, onSave }: {
  value: string;
  options: string[];
  onSave: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const close = useCallback(() => { setOpen(false); setDraft(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current && boxRef.current.contains(t)) return;
      const panel = document.getElementById('label-pop');
      if (panel && panel.contains(t)) return;
      close();
    };
    const bail = () => close();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', bail, true);
    window.addEventListener('resize', bail);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', bail, true);
      window.removeEventListener('resize', bail);
    };
  }, [open, close]);

  const openPanel = () => {
    const r = boxRef.current ? boxRef.current.getBoundingClientRect() : null;
    if (r) setPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 210) });
    setDraft(value);
    setOpen(true);
    window.setTimeout(() => { if (inputRef.current) inputRef.current.select(); }, 0);
  };

  const commit = (v: string) => {
    const clean = v.trim();
    setOpen(false);
    setDraft(clean);
    if (clean !== value.trim()) onSave(clean);
  };

  const q = draft.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const canCreate = !!draft.trim() && !options.some((o) => o.toLowerCase() === q);

  return (
    <div ref={boxRef} style={{ width: 190, maxWidth: '100%' }}>
      {open ? (
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          placeholder="Ketik label baru…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
          style={{
            width: '100%',
            background: 'var(--raised)',
            border: '1px solid var(--accent)',
            borderRadius: 8,
            padding: '6px 10px',
            font: 'inherit',
            fontSize: 13,
            color: 'var(--text)',
            outline: 'none',
          }}
        />
      ) : (
        <button
          type="button"
          onClick={openPanel}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          title={value ? 'Ubah label' : 'Beri label'}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: hover ? 'var(--raised)' : 'transparent',
            border: '1px solid',
            borderColor: hover ? 'var(--border)' : 'transparent',
            borderRadius: 8,
            padding: '6px 10px',
            font: 'inherit',
            fontSize: 13,
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--text-3)',
            transition: 'background .15s, border-color .15s',
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value ? <LabelChip text={value} /> : '—'}
          </span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ opacity: hover ? 0.75 : 0.3, flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {open && pos && (
        <div
          id="label-pop"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: 244,
            overflowY: 'auto',
            zIndex: 60,
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 5,
            boxShadow: '0 14px 36px rgba(0,0,0,.55)',
          }}
        >
          {filtered.map((o) => (
            <PopItem key={o} label={o} chip active={o === value} onPick={() => commit(o)} />
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(draft); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                textAlign: 'left', background: 'transparent', border: 'none',
                borderRadius: 7, padding: '7px 10px', font: 'inherit', fontSize: 13,
                cursor: 'pointer', color: 'var(--text-3)',
              }}
            >
              <span style={{ flexShrink: 0 }}>+ Buat</span>
              <LabelChip text={draft.trim()} />
            </button>
          )}
          {!!value && <PopItem label="Kosongkan label" muted onPick={() => commit('')} />}
          {filtered.length === 0 && !canCreate && (
            <div style={{ padding: '8px 10px', color: 'var(--text-3)', fontSize: 13 }}>
              Ketik untuk membuat label baru.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AccessView({ selfId, onAccountsChanged, activeProjectId = 'all', activeProjectName = null }: Props) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newAccProject, setNewAccProject] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [tab, setTab] = useState<'user' | 'project' | 'akun' | 'kategori' | 'tim'>('user');
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [delCat, setDelCat] = useState<{ cat: ContentCategory; nUsed: number } | null>(null);
  const [delCatBusy, setDelCatBusy] = useState(false);
  const [nu, setNu] = useState({ email: '', full_name: '', password: '', role: 'tim', team: '', vertical: '' });
  const [uBusy, setUBusy] = useState(false);
  const [userModal, setUserModal] = useState(false);
  const [delProj, setDelProj] = useState<{ pr: Project; nContent: number; nAcc: number; nBudget: number } | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delConfirmText, setDelConfirmText] = useState('');

  const callUserApi = async (payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { flash('Sesi tidak ditemukan, login ulang.'); return null; }
    const r = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { flash(d.error || 'Gagal.'); return null; }
    return d;
  };

  const createUser = async () => {
    if (!nu.email.trim() || nu.password.length < 6) { flash('Email wajib & password min. 6 karakter.'); return; }
    setUBusy(true);
    const d = await callUserApi({
      action: 'create',
      email: nu.email.trim(),
      password: nu.password,
      full_name: nu.full_name.trim(),
      role: nu.role,
      team: nu.team || null,
      vertical: nu.vertical || null,
    });
    setUBusy(false);
    if (d) {
      flash('User dibuat. Minta orangnya login lalu ganti password.');
      setNu({ email: '', full_name: '', password: '', role: 'tim', team: '', vertical: '' });
      setUserModal(false);
      load();
    }
  };

  const resetPw = async (u: Profile) => {
    const pw = window.prompt(`Password baru untuk ${u.email} (min. 6 karakter):`);
    if (!pw) return;
    if (pw.length < 6) { flash('Password minimal 6 karakter.'); return; }
    const d = await callUserApi({ action: 'reset_password', user_id: u.id, password: pw });
    if (d) flash('Password direset.');
  };

  const deleteUser = async (u: Profile) => {
    if (!window.confirm(`Hapus user ${u.email}? Tindakan ini permanen.`)) return;
    const d = await callUserApi({ action: 'delete', user_id: u.id });
    if (d) { flash('User dihapus.'); load(); }
  };
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [newHandle, setNewHandle] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberTeam, setNewMemberTeam] = useState<Team>('creative');

  const askDeleteProject = async (pr: Project) => {
    const countIn = async (table: string): Promise<number> => {
      try {
        const { count, error } = await supabase
          .from(table).select('id', { count: 'exact', head: true }).eq('project_id', pr.id);
        if (error) return 0;
        return count || 0;
      } catch { return 0; }
    };
    const nContent = await countIn('contents');
    const nAcc = await countIn('accounts');
    const nBudget = await countIn('budget_requests');
    setDelConfirmText('');
    setDelProj({ pr, nContent, nAcc, nBudget });
  };

  const confirmDeleteProject = async () => {
    if (!delProj) return;
    const { pr, nContent, nAcc, nBudget } = delProj;
    const hasData = nContent + nAcc + nBudget > 0;
    // kalau ada isi, wajib ketik nama persis
    if (hasData && delConfirmText.trim() !== pr.name) {
      flash('Ketik nama project dengan benar untuk menghapus total.');
      return;
    }
    setDelBusy(true);

    // Hapus isi dulu (cascade manual) bila ada
    if (hasData) {
      // hapus file recap milik project (kalau ada) — abaikan error storage
      try {
        const { data: recaps } = await supabase.from('recap_reports').select('file_path').eq('project_id', pr.id);
        const paths = (recaps || []).map((r: { file_path: string | null }) => r.file_path).filter(Boolean) as string[];
        if (paths.length) await supabase.storage.from('reports').remove(paths);
      } catch { /* skip */ }
      await supabase.from('recap_reports').delete().eq('project_id', pr.id);
      await supabase.from('budget_requests').delete().eq('project_id', pr.id);
      await supabase.from('content_requests').delete().eq('project_id', pr.id);
      await supabase.from('contents').delete().eq('project_id', pr.id);
      await supabase.from('accounts').delete().eq('project_id', pr.id);
    }

    const { error } = await supabase.from('projects').delete().eq('id', pr.id);
    setDelBusy(false);
    if (error) { flash('Gagal menghapus project: ' + error.message); return; }
    flash(hasData ? 'Project & seluruh isinya dihapus.' : 'Project dihapus.');
    setDelProj(null);
    load(); onAccountsChanged?.();
  };

  const syncFromSigma = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data, error } = await sigma.from('alpha_project_feed').select('*');
      if (error || !data) { setSyncMsg('Gagal membaca project dari SIGMA.'); setSyncing(false); return; }
      const sigmaProjects = data as SigmaProject[];

      // project Alpha yang sudah ada (by nama, case-insensitive)
      const existing = new Set(projects.map((p) => p.name.trim().toLowerCase()));
      const toCreate = sigmaProjects.filter(
        (sp) => sp.name && !existing.has(sp.name.trim().toLowerCase())
      );

      let created = 0;
      for (const sp of toCreate) {
        const vertical = ['KC', 'GME', 'KIG'].includes(sp.unit || '') ? sp.unit : null;
        const { error: insErr } = await supabase.from('projects').insert({
          name: sp.name.trim(),
          label: null,
          vertical,
        });
        if (!insErr) created++;
      }

      // ---- refresh daftar project Alpha (termasuk yang baru dibuat) ----
      const { data: freshProjects } = await supabase.from('projects').select('*');
      const projByName = new Map<string, string>();
      (freshProjects || []).forEach((p: { id: string; name: string }) =>
        projByName.set(p.name.trim().toLowerCase(), p.id)
      );

      // ---- sync AKUN dari SIGMA (kombinasi unik account + project) ----
      let accCreated = 0;
      try {
        const { data: feed } = await sigma
          .from('alpha_tracker_feed')
          .select('account, project_name, project_unit');
        if (feed) {
          // kumpulkan akun unik + project SIGMA-nya (skip unit null/non KC-GME-KIG)
          const seen = new Map<string, string>(); // account -> project_name
          for (const row of feed as { account: string | null; project_name: string | null; project_unit: string | null }[]) {
            if (!row.account) continue;
            if (!row.project_unit || !['KC', 'GME', 'KIG'].includes(row.project_unit)) continue;
            const handle = row.account.trim().toLowerCase();
            if (!seen.has(handle) && row.project_name) seen.set(handle, row.project_name);
          }

          // akun Alpha yang sudah ada
          const { data: existAcc } = await supabase.from('accounts').select('handle');
          const existHandles = new Set(
            (existAcc || []).map((a: { handle: string }) => a.handle.replace(/^@/, '').trim().toLowerCase())
          );

          for (const [handle, projName] of Array.from(seen.entries())) {
            if (existHandles.has(handle)) continue;
            const projectId = projByName.get(projName.trim().toLowerCase()) || null;
            const { error: accErr } = await supabase.from('accounts').insert({
              handle: '@' + handle,
              label: null,
              project_id: projectId,
              is_active: true,
            });
            if (!accErr) accCreated++;
          }
        }
      } catch { /* sync akun gagal -> project tetap sukses */ }

      const parts = [];
      parts.push(created > 0 ? `${created} project baru` : `project sudah lengkap`);
      parts.push(accCreated > 0 ? `${accCreated} akun baru` : `akun sudah lengkap`);
      setSyncMsg(`Sync selesai — ${parts.join(' · ')}.`);
      load();
      onAccountsChanged?.();
    } catch {
      setSyncMsg('Gagal terhubung ke SIGMA.');
    }
    setSyncing(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [u, a, m, pr, cc] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('accounts').select('*').order('handle'),
      supabase.from('team_members').select('*').order('team').order('name'),
      supabase.from('projects').select('*').order('name'),
      supabase.from('content_categories').select('*').order('name'),
    ]);
    setUsers((u.data as Profile[]) || []);
    setAccounts((a.data as Account[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setProjects((pr.data as Project[]) || []);
    setCategories((cc.data as ContentCategory[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Akun yang ditampilkan: ikut project aktif di sidebar (kalau bukan 'all')
  const shownAccounts = useMemo(
    () => (activeProjectId && activeProjectId !== 'all'
      ? accounts.filter((a) => a.project_id === activeProjectId)
      : accounts),
    [accounts, activeProjectId]
  );

  // Daftar label yang PERNAH dipakai — jadi isi dropdown Label.
  // Tumbuh sendiri: begitu ada label baru diketik & tersimpan, dia ikut muncul
  // di daftar untuk akun berikutnya. Tidak perlu tabel/kolom baru.
  const labelOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      const l = (a.label || '').trim();
      if (l) set.add(l);
    }
    return Array.from(set).sort((x: string, y: string) => x.localeCompare(y, 'id'));
  }, [accounts]);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMsg(''), 4000);
  };

  const updateUser = async (id: string, patch: Partial<Profile>) => {
    setMsg('');
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    flash(error ? 'Gagal menyimpan perubahan akses.' : 'Perubahan tersimpan.');
    load();
  };

  // ---------- Akun ----------
  const addAccount = async () => {
    const handle = newHandle.trim();
    if (!handle) return;
    setMsg('');
    const { error } = await supabase.from('accounts').insert({
      handle: handle.startsWith('@') ? handle : '@' + handle,
      label: newLabel.trim() || null,
      project_id: newAccProject || null,
    });
    if (error) { flash('Gagal menambah akun (handle mungkin sudah ada).'); return; }
    setNewHandle(''); setNewLabel('');
    flash('Akun ditambahkan.');
    load(); onAccountsChanged?.();
  };

  const updateAccountLabel = async (a: Account, label: string) => {
    const clean = label.trim();
    if (clean === (a.label || '').trim()) return; // tidak ada perubahan
    setMsg('');
    const { error } = await supabase.from('accounts').update({ label: clean || null }).eq('id', a.id);
    flash(error ? 'Gagal menyimpan label.' : 'Label tersimpan.');
    load(); onAccountsChanged?.();
  };

  const toggleAccount = async (a: Account) => {
    setMsg('');
    const { error } = await supabase.from('accounts').update({ is_active: !a.is_active }).eq('id', a.id);
    flash(error ? 'Gagal mengubah status akun.' : 'Status akun diubah.');
    load(); onAccountsChanged?.();
  };

  const deleteAccount = async (a: Account) => {
    if (!window.confirm(`Hapus akun ${a.handle}?`)) return;
    setMsg('');
    const { error } = await supabase.from('accounts').delete().eq('id', a.id);
    if (error) { flash('Tidak bisa dihapus — akun sudah dipakai konten. Gunakan Nonaktif.'); return; }
    flash('Akun dihapus.');
    load(); onAccountsChanged?.();
  };

  // ---------- Kategori konten (per project) ----------
  const projectPicked = !!activeProjectId && activeProjectId !== 'all';

  const shownCategories = useMemo(
    () => (projectPicked ? categories.filter((c) => c.project_id === activeProjectId) : []),
    [categories, activeProjectId, projectPicked]
  );

  const addCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    if (!projectPicked) { flash('Pilih project di sidebar dulu — kategori selalu milik satu project.'); return; }
    setCatBusy(true);
    setMsg('');
    const { error } = await supabase.from('content_categories').insert({
      project_id: activeProjectId,
      name,
    });
    setCatBusy(false);
    if (error) {
      // 23505 = unique violation (indeks unik project_id + lower(trim(name)))
      flash(error.code === '23505'
        ? 'Kategori dengan nama itu sudah ada di project ini.'
        : 'Gagal menambah kategori — hanya superadmin/manager yang bisa.');
      return;
    }
    setNewCatName('');
    flash('Kategori ditambahkan.');
    load();
  };

  const toggleCategory = async (c: ContentCategory) => {
    setMsg('');
    const { error } = await supabase
      .from('content_categories').update({ is_active: !c.is_active }).eq('id', c.id);
    flash(error ? 'Gagal mengubah status kategori.' : 'Status kategori diubah.');
    load();
  };

  // Hitung dulu berapa konten yang memakainya, baru tanya konfirmasi.
  const askDeleteCategory = async (c: ContentCategory) => {
    let nUsed = 0;
    try {
      const { count } = await supabase
        .from('contents').select('id', { count: 'exact', head: true }).eq('category_id', c.id);
      nUsed = count || 0;
    } catch { nUsed = 0; }
    setDelCat({ cat: c, nUsed });
  };

  const confirmDeleteCategory = async () => {
    if (!delCat) return;
    setDelCatBusy(true);
    const { error } = await supabase.from('content_categories').delete().eq('id', delCat.cat.id);
    setDelCatBusy(false);
    if (error) { flash('Gagal menghapus kategori.'); return; }
    setDelCat(null);
    flash('Kategori dihapus.');
    load();
  };

  // ---------- Anggota tim (PIC) ----------
  const addMember = async () => {
    const name = newMemberName.trim();
    if (!name) return;
    setMsg('');
    const { error } = await supabase.from('team_members').insert({ name, team: newMemberTeam });
    if (error) { flash('Gagal menambah anggota.'); return; }
    setNewMemberName('');
    flash('Anggota ditambahkan.');
    load();
  };

  const toggleMember = async (m: TeamMember) => {
    setMsg('');
    const { error } = await supabase.from('team_members').update({ is_active: !m.is_active }).eq('id', m.id);
    flash(error ? 'Gagal mengubah status anggota.' : 'Status anggota diubah.');
    load();
  };

  const deleteMember = async (m: TeamMember) => {
    if (!window.confirm(`Hapus ${m.name} dari daftar PIC?`)) return;
    setMsg('');
    const { error } = await supabase.from('team_members').delete().eq('id', m.id);
    if (error) { flash('Tidak bisa dihapus — masih jadi PIC konten. Gunakan Nonaktif.'); return; }
    flash('Anggota dihapus.');
    load();
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Kelola Akses</h2>
          <span className="top-note">khusus superadmin</span>
        </div>
      </div>
      <div className="content-area">
        {loading ? (
          <p className="empty">Memuat…</p>
        ) : (
          <>
            <div className="access-tabs">
              <button className={`atab ${tab === 'user' ? 'active' : ''}`} onClick={() => setTab('user')}>User Login</button>
              <button className={`atab ${tab === 'project' ? 'active' : ''}`} onClick={() => setTab('project')}>Project &amp; Vertical</button>
              <button className={`atab ${tab === 'akun' ? 'active' : ''}`} onClick={() => setTab('akun')}>Akun Media</button>
              <button className={`atab ${tab === 'kategori' ? 'active' : ''}`} onClick={() => setTab('kategori')}>Kategori Konten</button>
              <button className={`atab ${tab === 'tim' ? 'active' : ''}`} onClick={() => setTab('tim')}>Anggota Tim</button>
            </div>

            {tab === 'user' && (<>
            {/* ================= USER LOGIN ================= */}
            <div className="section-head-row">
              <div className="section-title" style={{ margin: 0 }}>User Login</div>
              <button className="btn primary" onClick={() => { setUserModal(true); setNu({ email: '', full_name: '', password: '', role: 'tim', team: '', vertical: '' }); }}>
                + Tambah user
              </button>
            </div>
            <p className="section-hint">
              Akun dibuat dengan password sementara — minta orangnya login lalu ganti lewat <b>Reset PW</b>.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Role</th><th>Team</th><th>Vertical</th><th>Status</th><th style={{ width: 150 }}></th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span className="row-avatar">{initials(u.full_name || u.email)}</span>
                        <b>{u.full_name || '(tanpa nama)'}</b>
                        <div className="sub" style={{ marginLeft: 40 }}>{u.email}</div>
                      </td>
                      <td>
                        <select
                          value={u.role}
                          disabled={u.id === selfId}
                          style={u.role === 'superadmin' ? { color: 'var(--st-review)', borderColor: 'var(--st-review)' } :
                            u.role === 'manager' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                          onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={u.team || ''} onChange={(e) => updateUser(u.id, { team: (e.target.value || null) as Team | null })}>
                          {TEAMS.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
                        </select>
                      </td>
                      <td>
                        <select
                          value={u.vertical || ''}
                          disabled={u.id === selfId}
                          onChange={(e) => updateUser(u.id, { vertical: e.target.value || null })}
                        >
                          <option value="">semua</option>
                          {VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.key}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn ghost" disabled={u.id === selfId} onClick={() => updateUser(u.id, { is_active: !u.is_active })}>
                          <span className="status-dot" style={{ background: u.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {u.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td>
                        <div className="recap-actions">
                          <button className="btn act" onClick={() => resetPw(u)}>Reset PW</button>
                          {u.id !== selfId && (
                            <button className="icon-del" title="Hapus user" onClick={() => deleteUser(u)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            </>)}

            {tab === 'project' && (<>
            {/* ================= PROJECT ================= */}
            <div className="section-head-row">
              <div className="section-title" style={{ margin: 0 }}>Project &amp; Vertical</div>
              <button className="btn" onClick={syncFromSigma} disabled={syncing}>
                {syncing ? 'Menyinkronkan…' : '⟳ Sync dari SIGMA'}
              </button>
            </div>
            <p className="section-hint">
              Vertical menentukan siapa yang boleh melihat: orang <b>KC</b> tidak melihat project <b>GME</b>, dan sebaliknya.
              Pilih <b>KIG</b> untuk project lintas grup. <b>Sync dari SIGMA</b> menyalin project <i>dan akun</i> KC/GME/KIG
              dari SIGMA (lengkap dengan unit &amp; tautan project-nya) — SIGMA tetap bersih, Alpha jadi ruang kerja.
            </p>
            {syncMsg && <p className="sync-msg">{syncMsg}</p>}
            <div className="table-wrap" style={{ marginBottom: 8 }}>
              <table>
                <thead>
                  <tr><th>Project</th><th>Vertical</th><th>Label</th><th>Status</th><th style={{ width: 60 }}></th></tr>
                </thead>
                <tbody>
                  {projects.map((pr) => (
                    <tr key={pr.id}>
                      <td><b>{pr.name}</b></td>
                      <td>
                        <select
                          value={pr.vertical || ''}
                          onChange={(e) => supabase.from('projects').update({ vertical: e.target.value || null }).eq('id', pr.id).then(() => { load(); onAccountsChanged?.(); })}
                        >
                          <option value="">—</option>
                          {VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.key}</option>)}
                        </select>
                      </td>
                      <td>{pr.label || '—'}</td>
                      <td>
                        <button
                          className="btn ghost"
                          onClick={() => supabase.from('projects').update({ is_active: !pr.is_active }).eq('id', pr.id).then(() => { load(); onAccountsChanged?.(); })}
                        >
                          <span className="status-dot" style={{ background: pr.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {pr.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td>
                        <button className="icon-del" title="Hapus project" onClick={() => askDeleteProject(pr)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {projects.length === 0 && <tr><td colSpan={5} className="empty">Belum ada project.</td></tr>}
                </tbody>
              </table>
            </div>

            </>)}

            {tab === 'akun' && (<>
            {/* ================= AKUN MEDIA ================= */}
            <div className="section-title">Akun Media</div>
            <p className="section-hint">
              {activeProjectName
                ? <>Menampilkan akun project <b>{activeProjectName}</b> — ganti lewat selector Project di sidebar. Akun yang dipakai konten tidak bisa dihapus, nonaktifkan saja.</>
                : <>Semua akun media. Pilih project di sidebar untuk menyaring. Akun yang dipakai konten tidak bisa dihapus — nonaktifkan saja.</>}
            </p>
            {/* Daftar pilihan Label — dipakai bersama oleh form tambah & kolom tabel */}
            <datalist id="acc-label-options">
              {labelOptions.map((l) => <option key={l} value={l} />)}
            </datalist>
            <div className="add-row">
              <input placeholder="@handle akun" value={newHandle} onChange={(e) => setNewHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
              <input list="acc-label-options" placeholder="Label — pilih atau ketik baru" value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
              <select value={newAccProject} onChange={(e) => setNewAccProject(e.target.value)}>
                <option value="">— project —</option>
                {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </select>
              <button className="btn primary" onClick={addAccount} disabled={!newHandle.trim()}>+ Tambah</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Akun</th><th>Project</th><th>Label</th><th>Status</th><th style={{ width: 90 }}></th></tr>
                </thead>
                <tbody>
                  {shownAccounts.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.handle}</b></td>
                      <td>
                        <select
                          value={a.project_id || ''}
                          onChange={(e) => supabase.from('accounts').update({ project_id: e.target.value || null }).eq('id', a.id).then(() => { load(); onAccountsChanged?.(); })}
                        >
                          <option value="">—</option>
                          {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <LabelCell
                          value={a.label || ''}
                          options={labelOptions}
                          onSave={(v) => updateAccountLabel(a, v)}
                        />
                      </td>
                      <td>
                        <button className="btn ghost" onClick={() => toggleAccount(a)}>
                          <span className="status-dot" style={{ background: a.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {a.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td><button className="btn ghost danger-text" onClick={() => deleteAccount(a)}>Hapus</button></td>
                    </tr>
                  ))}
                  {shownAccounts.length === 0 && <tr><td colSpan={5} className="empty">{activeProjectName ? `Belum ada akun di project ${activeProjectName}.` : 'Belum ada akun.'}</td></tr>}
                </tbody>
              </table>
            </div>

            </>)}

            {tab === 'kategori' && (<>
            {/* ================= KATEGORI KONTEN ================= */}
            <div className="section-title">Kategori Konten</div>
            <p className="section-hint">
              {projectPicked
                ? <>Kategori milik project <b>{activeProjectName}</b> — tiap project punya daftarnya sendiri, tidak saling terlihat. Yang dinonaktifkan tidak muncul lagi di form konten, tapi konten lama tetap memakainya.</>
                : <>Kategori selalu milik satu project. <b>Pilih project di sidebar</b> untuk mengelolanya.</>}
            </p>
            {projectPicked ? (
              <>
                <div className="add-row">
                  <input
                    placeholder="Nama kategori — mis. Review Film"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                  />
                  <button className="btn primary" onClick={addCategory} disabled={catBusy || !newCatName.trim()}>
                    {catBusy ? 'Menyimpan…' : '+ Tambah'}
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Kategori</th><th>Status</th><th style={{ width: 90 }}></th></tr>
                    </thead>
                    <tbody>
                      {shownCategories.map((c) => (
                        <tr key={c.id}>
                          <td><LabelChip text={c.name} /></td>
                          <td>
                            <button className="btn ghost" onClick={() => toggleCategory(c)}>
                              <span className="status-dot" style={{ background: c.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                              {c.is_active ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td>
                            <button className="btn ghost danger-text" onClick={() => askDeleteCategory(c)}>Hapus</button>
                          </td>
                        </tr>
                      ))}
                      {shownCategories.length === 0 && (
                        <tr><td colSpan={3} className="empty">Belum ada kategori di project ini — tambahkan lewat kotak di atas.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="table-wrap"><p className="empty">Pilih project di sidebar dulu.</p></div>
            )}

            </>)}

            {tab === 'tim' && (<>
            {/* ================= ANGGOTA TIM (PIC) ================= */}
            <div className="section-title">Anggota Tim (opsi PIC)</div>
            <p className="section-hint">
              Opsi dropdown PIC di form konten — tidak wajib punya akun login. Anggota yang masih jadi PIC konten tidak bisa dihapus — nonaktifkan saja.
            </p>
            <div className="add-row">
              <input placeholder="Nama anggota" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMember()} />
              <select value={newMemberTeam} onChange={(e) => setNewMemberTeam(e.target.value as Team)}>
                {MEMBER_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="btn primary" onClick={addMember} disabled={!newMemberName.trim()}>+ Tambah</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nama</th><th>Tim</th><th>Status</th><th style={{ width: 90 }}></th></tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td><span className="row-avatar">{initials(m.name)}</span><b>{m.name}</b></td>
                      <td>{m.team}</td>
                      <td>
                        <button className="btn ghost" onClick={() => toggleMember(m)}>
                          <span className="status-dot" style={{ background: m.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {m.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td><button className="btn ghost danger-text" onClick={() => deleteMember(m)}>Hapus</button></td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan={4} className="empty">Belum ada anggota.</td></tr>}
                </tbody>
              </table>
            </div>
            </>)}
          </>
        )}
        {msg && (
          <div className="toast" onClick={() => setMsg('')}>
            <span className="toast-dot" />
            {msg}
          </div>
        )}
      </div>

      {delProj && (() => {
        const hasData = delProj.nContent + delProj.nAcc + delProj.nBudget > 0;
        const canDelete = !hasData || delConfirmText.trim() === delProj.pr.name;
        return (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDelProj(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow"><span className="sq" style={{ background: 'var(--red)' }} />Hapus Project</div>
                <div className="modal-title">Hapus &ldquo;{delProj.pr.name}&rdquo;?</div>
                <div className="modal-sub">
                  {hasData
                    ? 'Project ini masih berisi data. Menghapus akan menghilangkan SEMUANYA secara permanen.'
                    : 'Project kosong. Tindakan ini permanen dan tidak bisa dibatalkan.'}
                </div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setDelProj(null)}>✕</button>
            </div>
            <div style={{ padding: '4px 24px 0' }}>
              {hasData && (
                <>
                  <div className="del-counts">
                    <span>{delProj.nContent} konten</span>
                    <span>{delProj.nAcc} akun</span>
                    <span>{delProj.nBudget} budget</span>
                    <span className="del-counts-note">+ recap & request terkait</span>
                  </div>
                  <div className="field" style={{ marginTop: 14 }}>
                    <label>Ketik <b style={{ color: 'var(--red)' }}>{delProj.pr.name}</b> untuk konfirmasi</label>
                    <input value={delConfirmText} onChange={(e) => setDelConfirmText(e.target.value)}
                      placeholder={delProj.pr.name} autoFocus />
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setDelProj(null)} disabled={delBusy}>Batal</button>
                <button className="btn"
                  style={{ background: canDelete ? 'var(--red)' : 'var(--raised)', color: canDelete ? '#fff' : 'var(--text-3)', borderColor: canDelete ? 'var(--red)' : 'var(--border)' }}
                  onClick={confirmDeleteProject} disabled={delBusy || !canDelete}>
                  {delBusy ? 'Menghapus…' : (hasData ? 'Hapus total' : 'Hapus permanen')}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {delCat && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !delCatBusy && setDelCat(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus kategori
                </div>
                <div className="modal-title">Hapus &ldquo;{delCat.cat.name}&rdquo;?</div>
                <div className="modal-sub">
                  {delCat.nUsed > 0
                    ? <>Kategori ini masih dipakai <b>{delCat.nUsed} konten</b>. Kontennya <b>tidak ikut terhapus</b> — kategorinya saja yang jadi kosong.</>
                    : 'Belum ada konten yang memakai kategori ini.'}
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={delCatBusy} onClick={() => setDelCat(null)}>✕</button>
            </div>
            {delCat.nUsed > 0 && (
              <div style={{ padding: '4px 24px 0' }}>
                <div className="hint">
                  Kalau cuma ingin menyembunyikannya dari form konten tanpa kehilangan penanda di konten lama,
                  pakai <b>Nonaktif</b> saja — bukan Hapus.
                </div>
              </div>
            )}
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={delCatBusy} onClick={() => setDelCat(null)}>Batal</button>
                <button
                  className="btn danger"
                  disabled={delCatBusy}
                  onClick={confirmDeleteCategory}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                >
                  {delCatBusy ? 'Menghapus…' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {userModal && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  User baru
                </div>
                <div className="modal-title">Tambah User</div>
                <div className="modal-sub">Akun dibuat dengan password sementara. Minta orangnya ganti lewat Reset PW.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setUserModal(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Email</label>
                <input placeholder="email@perusahaan.com" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Nama tampilan</label>
                <input placeholder="mis. Bagus" value={nu.full_name} onChange={(e) => setNu({ ...nu, full_name: e.target.value })} />
              </div>
              <div className="field">
                <label>Password sementara (min. 6)</label>
                <input type="text" placeholder="••••••" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Role</label>
                  <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Team</label>
                  <select value={nu.team} onChange={(e) => setNu({ ...nu, team: e.target.value })}>
                    <option value="">—</option>
                    {['delta', 'creative', 'distribution', 'ads', 'pm', 'finance'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Vertical</label>
                  <select value={nu.vertical} onChange={(e) => setNu({ ...nu, vertical: e.target.value })}>
                    <option value="">semua</option>
                    {VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.key}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setUserModal(false)} disabled={uBusy}>Batal</button>
                <button className="btn primary" onClick={createUser} disabled={uBusy || !nu.email.trim() || nu.password.length < 6}>
                  {uBusy ? 'Membuat…' : 'Tambah user'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
