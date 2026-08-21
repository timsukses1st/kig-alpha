'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, KOLOM_URL_AKUN, PLATFORMS, tagColor, TEAM_GROUPS, TEAM_LABEL, teamsForVertical, VERTICALS, type Account, type ContentCategory, type Profile, type Project, type Role, type Team, type TeamMember } from '@/lib/types';
import { sigma, type SigmaProject } from '@/lib/sigma';

const ROLES: Role[] = ['superadmin', 'manager', 'tim'];
/**
 * Pilihan tim, dikelompokkan dan disaring menurut unit bisnisnya.
 *
 * `current` wajib diikutkan: kalau tim yang sedang dipakai seseorang tidak
 * lolos penyaring (misalnya orang KC bertim 'delta'), tanpa ini pilihannya
 * hilang dari daftar dan timnya bisa ikut terhapus begitu dropdown disentuh.
 */
function TeamOptions({ vertical, current }: { vertical?: string | null; current?: string | null }) {
  const boleh = new Set<string>(teamsForVertical(vertical));
  if (current) boleh.add(current);
  return (
    <>
      {TEAM_GROUPS.map((g) => {
        const isi = g.teams.filter((t) => boleh.has(t));
        if (!isi.length) return null;
        return (
          <optgroup key={g.label} label={g.label}>
            {isi.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}
/**
 * Pilihan vertical untuk AKUN PENGGUNA — sengaja berbeda dari VERTICALS yang
 * dipakai untuk project.
 *
 * Aturan sebenarnya ada di fungsi can_see_all() di database:
 *     my_role() = 'superadmin' or my_vertical() = 'KIG' or my_vertical() = 'ALL'
 *
 * Jadi 'ALL' itu penanda resmi lintas unit, dan 'KIG' ikut memberi akses penuh
 * karena KIG adalah holding-nya. Sementara nilai KOSONG (NULL) berarti
 * "tidak cocok dengan project mana pun" — di SQL, `vertical = NULL` selalu
 * menghasilkan NULL, bukan true.
 *
 * Label lama untuk nilai kosong tertulis "semua", padahal artinya justru
 * kebalikannya. Itu sempat membuat satu akun manager tidak melihat project
 * sama sekali dan sulit dilacak. Sekarang labelnya dibuat jujur.
 */
const USER_VERTICALS: { value: string; label: string }[] = [
  { value: '', label: '— belum diatur (tidak lihat apa pun) —' },
  { value: 'ALL', label: 'ALL — lintas unit' },
  { value: 'KIG', label: 'KIG — holding (lintas unit)' },
  { value: 'KC', label: 'KC — Kahfi Corp' },
  { value: 'GME', label: 'GME — Gala Mega Enigma' },
];

const MEMBER_TEAMS: Team[] = ['creative', 'distribution', 'ads', 'vmt', 'delta'];

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
  /** Penyaring unit di tab User Login. '' = tampilkan semua. */
  const [saringVertical, setSaringVertical] = useState('');
  /** Pencarian nama/email di tab User Login. */
  const [cariUser, setCariUser] = useState('');
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

  /**
   * Reset password, hapus user, dan hapus akun media dulu memakai
   * window.prompt / window.confirm — dua-duanya DIBLOKIR di lingkungan ini,
   * jadi tombolnya diklik tanpa reaksi apa pun. Sekarang semuanya lewat modal.
   */
  const doResetPw = async () => {
    if (!pwUser) return;
    const pw = pwValue.trim();
    if (pw.length < 6) { flash('Password minimal 6 karakter.'); return; }
    setPwBusy(true);
    const d = await callUserApi({ action: 'reset_password', user_id: pwUser.id, password: pw });
    setPwBusy(false);
    if (!d) return;
    setPwUser(null);
    setPwValue('');
    flash('Password direset. Sampaikan ke orangnya, minta segera diganti.');
  };

  const confirmDeleteUser = async () => {
    if (!delUser) return;
    setDelUserBusy(true);
    const d = await callUserApi({ action: 'delete', user_id: delUser.id });
    setDelUserBusy(false);
    if (!d) return;
    setDelUser(null);
    flash('User dihapus.');
    load();
  };
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [newHandle, setNewHandle] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberTeam, setNewMemberTeam] = useState<Team>('creative');

  // Ubah anggota PIC. Sengaja lewat modal, bukan dropdown langsung di tabel —
  // dropdown di baris tabel gampang tergeser tanpa sengaja waktu men-scroll,
  // dan salah pindah tim berarti orangnya hilang dari dropdown PIC-nya sendiri.
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberTeam, setEditMemberTeam] = useState<Team>('creative');
  const [editMemberBusy, setEditMemberBusy] = useState(false);

  // Hapus anggota PIC. Dulu memakai window.confirm — diblokir di lingkungan ini,
  // jadi tombolnya diam saja tanpa pesan apa pun. Sekarang pakai modal sendiri.
  const [delMember, setDelMember] = useState<TeamMember | null>(null);
  const [delMemberBusy, setDelMemberBusy] = useState(false);

  // Tiga tombol lain yang dulu bernasib sama.
  const [pwUser, setPwUser] = useState<Profile | null>(null);
  const [pwValue, setPwValue] = useState('');
  /** Sisa karakter yang masih kurang. 0 = sudah cukup. */
  const [pwLihat, setPwLihat] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const kurangPw = Math.max(0, 6 - pwValue.trim().length);
  const [delUser, setDelUser] = useState<Profile | null>(null);
  const [delUserBusy, setDelUserBusy] = useState(false);
  const [delAcc, setDelAcc] = useState<Account | null>(null);
  const [delAccBusy, setDelAccBusy] = useState(false);

  // Alamat profil per platform. Disimpan, bukan ditebak — lihat catatan di
  // accountUrl() pada lib/types.ts.
  const [linkAcc, setLinkAcc] = useState<Account | null>(null);
  const [linkVal, setLinkVal] = useState<Record<string, string>>({});
  const [linkBusy, setLinkBusy] = useState(false);

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

  /**
   * Akun yang ditampilkan: ikut project aktif di sidebar (kalau bukan 'all').
   *
   * Akun TANPA project selalu ikut ditampilkan. Kalau tidak, dia tidak muncul
   * di project mana pun dan jadi tidak bisa ditugaskan maupun dihapus — persis
   * yang terjadi pada @sakjsak. Kolom Project di barisnya sudah bisa dipakai
   * untuk langsung menugaskannya.
   */
  const shownAccounts = useMemo(
    () => (activeProjectId && activeProjectId !== 'all'
      ? accounts.filter((a) => a.project_id === activeProjectId || !a.project_id)
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

  const openLinkAcc = (a: Account) => {
    setLinkAcc(a);
    const awal: Record<string, string> = {};
    for (const pf of PLATFORMS) {
      const k = KOLOM_URL_AKUN[pf.key];
      awal[pf.key] = ((a[k] as string | null) ?? '');
    }
    setLinkVal(awal);
  };

  /** Alamat harus lengkap dengan http:// atau https://, kalau tidak ditolak. */
  const linkSalah = PLATFORMS.filter((pf) => {
    const v = (linkVal[pf.key] || '').trim();
    return v !== '' && !/^https?:\/\//i.test(v);
  });

  const saveLinkAcc = async () => {
    if (!linkAcc || linkSalah.length) return;
    setMsg('');
    setLinkBusy(true);
    const patch: Record<string, string | null> = {};
    for (const pf of PLATFORMS) {
      const v = (linkVal[pf.key] || '').trim();
      patch[KOLOM_URL_AKUN[pf.key] as string] = v || null;
    }
    const { data, error } = await supabase
      .from('accounts').update(patch).eq('id', linkAcc.id).select('id');
    setLinkBusy(false);
    if (error) { flash('Gagal menyimpan alamat profil.'); return; }
    if (!data || data.length === 0) {
      flash('Tidak ada yang tersimpan — wewenang akunmu tidak mencukupi.');
      return;
    }
    setLinkAcc(null);
    flash('Alamat profil tersimpan.');
    load(); onAccountsChanged?.();
  };

  /**
   * Jumlah akun per unit. Dihitung dari data yang ada, bukan dari daftar tetap —
   * supaya tidak muncul chip yang isinya nol. Akun tanpa unit dikelompokkan
   * sendiri, karena mereka justru yang paling perlu diperhatikan.
   */
  const jumlahPerVertical = useMemo(() => {
    const m: Record<string, number> = {};
    for (const u of users) {
      const k = (u.vertical || '').trim() || 'KOSONG';
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [users]);

  const chipVertical = useMemo(() => {
    const urutan = ['KC', 'GME', 'KIG', 'ALL', 'KOSONG'];
    return urutan
      .filter((k) => (jumlahPerVertical[k] || 0) > 0)
      .map((k) => ({
        value: k,
        label: k === 'KOSONG' ? 'Belum diatur' : k,
        jumlah: jumlahPerVertical[k],
      }));
  }, [jumlahPerVertical]);

  const usersTersaring = useMemo(() => {
    const q = cariUser.trim().toLowerCase();
    return users.filter((u) => {
      if (saringVertical) {
        const k = (u.vertical || '').trim() || 'KOSONG';
        if (k !== saringVertical) return false;
      }
      if (!q) return true;
      return (
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.team || '').toLowerCase().includes(q) ||
        (TEAM_LABEL[u.team as Team] || '').toLowerCase().includes(q)
      );
    });
  }, [users, saringVertical, cariUser]);

  const confirmDeleteAccount = async () => {
    if (!delAcc) return;
    setMsg('');
    setDelAccBusy(true);
    const { data, error } = await supabase
      .from('accounts').delete().eq('id', delAcc.id).select('id');
    setDelAccBusy(false);
    if (error) { flash('Tidak bisa dihapus — akun sudah dipakai konten. Gunakan Nonaktif.'); return; }
    if (!data || data.length === 0) {
      flash('Tidak ada yang terhapus — wewenang akunmu tidak mencukupi.');
      return;
    }
    setDelAcc(null);
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

  /** Buka modal ubah. Nilai awal disalin ke state terpisah supaya batal = benar-benar batal. */
  const openEditMember = (m: TeamMember) => {
    setEditMember(m);
    setEditMemberName(m.name);
    setEditMemberTeam(m.team);
  };

  /**
   * Simpan perubahan nama/tim anggota PIC.
   *
   * Memakai UPDATE, bukan hapus-lalu-tambah — ini penting. `contents.pic_*`
   * menyimpan UUID baris ini. Kalau barisnya dibuat ulang, UUID-nya berubah dan
   * semua konten lama kehilangan nama PIC-nya. Dengan UPDATE, id-nya tetap dan
   * riwayat tetap utuh.
   */
  const saveMember = async () => {
    if (!editMember) return;
    const nama = editMemberName.trim();
    if (!nama) return;
    setMsg('');
    setEditMemberBusy(true);
    const { data, error } = await supabase
      .from('team_members')
      .update({ name: nama, team: editMemberTeam })
      .eq('id', editMember.id)
      .select('id');
    setEditMemberBusy(false);
    if (error) { flash('Gagal menyimpan perubahan anggota.'); return; }
    // RLS yang menolak UPDATE mengubah 0 baris tanpa memunculkan error sama
    // sekali. Tanpa pemeriksaan ini, layarnya bilang "tersimpan" padahal tidak.
    if (!data || data.length === 0) {
      flash('Tidak ada yang tersimpan — wewenang akunmu tidak mencukupi.');
      return;
    }
    setEditMember(null);
    flash('Anggota diperbarui.');
    load();
  };

  const confirmDeleteMember = async () => {
    if (!delMember) return;
    setMsg('');
    setDelMemberBusy(true);
    const { data, error } = await supabase
      .from('team_members').delete().eq('id', delMember.id).select('id');
    setDelMemberBusy(false);
    if (error) { flash('Tidak bisa dihapus — masih jadi PIC konten. Gunakan Nonaktif.'); return; }
    if (!data || data.length === 0) {
      flash('Tidak ada yang terhapus — wewenang akunmu tidak mencukupi.');
      return;
    }
    setDelMember(null);
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

            {/* Penyaring unit. Dengan 35+ akun, satu daftar panjang bikin susah
                menemukan orang — apalagi kalau nanti GME ikut masuk. */}
            <div className="add-row" style={{ alignItems: 'center' }}>
              <button
                className={`chip-btn ${saringVertical === '' ? 'active' : ''}`}
                onClick={() => setSaringVertical('')}
              >
                Semua <span style={{ opacity: 0.6 }}>{users.length}</span>
              </button>
              {chipVertical.map((c) => (
                <button
                  key={c.value}
                  className={`chip-btn ${saringVertical === c.value ? 'active' : ''}`}
                  onClick={() => setSaringVertical(saringVertical === c.value ? '' : c.value)}
                >
                  {c.label} <span style={{ opacity: 0.6 }}>{c.jumlah}</span>
                </button>
              ))}
              <input
                style={{ minWidth: 190 }}
                placeholder="Cari nama, email, atau tim…"
                value={cariUser}
                onChange={(e) => setCariUser(e.target.value)}
              />
              {(saringVertical || cariUser) && (
                <button
                  className="btn ghost"
                  onClick={() => { setSaringVertical(''); setCariUser(''); }}
                >
                  Kosongkan
                </button>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Role</th><th>Team</th><th>Vertical</th><th>Status</th><th style={{ width: 150 }}></th></tr>
                </thead>
                <tbody>
                  {usersTersaring.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        Tidak ada akun yang cocok dengan penyaring ini.
                      </td>
                    </tr>
                  )}
                  {usersTersaring.map((u) => (
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
                          <option value="">—</option>
                          <TeamOptions vertical={u.vertical} current={u.team} />
                        </select>
                      </td>
                      <td>
                        <select
                          value={u.vertical || ''}
                          disabled={u.id === selfId}
                          onChange={(e) => updateUser(u.id, { vertical: e.target.value || null })}
                        >
                          {USER_VERTICALS.map((v) => (
                            <option key={v.value} value={v.value}>{v.label}</option>
                          ))}
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
                          <button className="btn act" onClick={() => { setPwUser(u); setPwValue(''); setPwLihat(false); }}>Reset PW</button>
                          {u.id !== selfId && (
                            <button className="icon-del" title="Hapus user" onClick={() => setDelUser(u)}>
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
                ? <>Menampilkan akun project <b>{activeProjectName}</b> — ganti lewat selector Project di sidebar. Akun yang belum punya project ikut ditampilkan di sini supaya bisa ditugaskan; selama project-nya kosong, akun itu tidak bisa dipilih di Board. Akun yang dipakai konten tidak bisa dihapus, nonaktifkan saja.</>
                : <>Semua akun media. Pilih project di sidebar untuk menyaring. Akun yang dipakai konten tidak bisa dihapus — nonaktifkan saja.</>}
              {' '}Kolom <b>Link</b> menyimpan alamat profil per platform — satu akun bisa dipakai di beberapa
              platform dengan username berbeda, jadi alamatnya diisi sendiri-sendiri. Yang belum diisi
              tidak akan ditautkan di Board.
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
                  <tr><th>Akun</th><th>Project</th><th>Label</th><th>Link</th><th>Status</th><th style={{ width: 90 }}></th></tr>
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
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {(() => {
                          const isi = PLATFORMS.filter(
                            (pf) => ((a[KOLOM_URL_AKUN[pf.key]] as string | null) ?? '').trim() !== ''
                          );
                          return (
                            <button className="btn ghost" onClick={() => openLinkAcc(a)} title="Atur alamat profil per platform">
                              <span
                                className="status-dot"
                                style={{ background: isi.length ? 'var(--green)' : 'var(--text-3)' }}
                              />
                              {isi.length ? `${isi.length} platform` : 'Belum diisi'}
                            </button>
                          );
                        })()}
                      </td>
                      <td>
                        <button className="btn ghost" onClick={() => toggleAccount(a)}>
                          <span className="status-dot" style={{ background: a.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {a.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td><button className="btn ghost danger-text" onClick={() => setDelAcc(a)}>Hapus</button></td>
                    </tr>
                  ))}
                  {shownAccounts.length === 0 && <tr><td colSpan={6} className="empty">{activeProjectName ? `Belum ada akun di project ${activeProjectName}.` : 'Belum ada akun.'}</td></tr>}
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
              Opsi dropdown PIC di form konten — tidak wajib punya akun login. Daftar ini <b>terpisah dari tab Akun</b>:
              mengubah tim seseorang di sana tidak mengubah timnya di sini, jadi kalau ada yang pindah tim, ubah di dua-duanya.
              Anggota yang masih jadi PIC konten tidak bisa dihapus — nonaktifkan saja.
            </p>
            <div className="add-row">
              <input placeholder="Nama anggota" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMember()} />
              <select value={newMemberTeam} onChange={(e) => setNewMemberTeam(e.target.value as Team)}>
                {MEMBER_TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
              </select>
              <button className="btn primary" onClick={addMember} disabled={!newMemberName.trim()}>+ Tambah</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nama</th><th>Tim</th><th>Status</th><th style={{ width: 150 }}></th></tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td><span className="row-avatar">{initials(m.name)}</span><b>{m.name}</b></td>
                      <td>{TEAM_LABEL[m.team] || m.team}</td>
                      <td>
                        <button className="btn ghost" onClick={() => toggleMember(m)}>
                          <span className="status-dot" style={{ background: m.is_active ? 'var(--green)' : 'var(--text-3)' }} />
                          {m.is_active ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn ghost" onClick={() => openEditMember(m)}>✎ Ubah</button>
                        <button className="btn ghost danger-text" onClick={() => setDelMember(m)}>Hapus</button>
                      </td>
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

      {linkAcc && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !linkBusy && setLinkAcc(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  Alamat profil
                </div>
                <div className="modal-title">{linkAcc.handle}</div>
                <div className="modal-sub">
                  Tempel alamat profilnya untuk tiap platform yang dipakai. Yang tidak dipakai biarkan kosong.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={linkBusy} onClick={() => setLinkAcc(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '18px 24px 6px', maxHeight: '52vh', overflowY: 'auto' }}>
              {PLATFORMS.map((pf) => {
                const v = linkVal[pf.key] || '';
                const salah = v.trim() !== '' && !/^https?:\/\//i.test(v.trim());
                return (
                  <div className="field" key={pf.key}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: pf.color, flexShrink: 0 }} />
                      {pf.label}
                    </label>
                    <input
                      value={v}
                      disabled={linkBusy}
                      placeholder="https://…"
                      spellCheck={false}
                      onChange={(e) => setLinkVal({ ...linkVal, [pf.key]: e.target.value })}
                      style={salah ? { borderColor: 'var(--red)' } : undefined}
                    />
                    {salah && (
                      <div className="hint" style={{ color: 'var(--red)' }}>
                        Harus diawali http:// atau https://
                      </div>
                    )}
                  </div>
                );
              })}
              <div
                style={{
                  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  borderLeft: '2px solid var(--accent)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px', marginTop: 4,
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                Buka profilnya di browser, <b style={{ color: 'var(--text)' }}>salin alamat dari bilah alamat</b>,
                lalu tempel di sini. Jangan diketik ulang dari ingatan — beda satu huruf, tautannya menuju akun
                orang lain.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={linkBusy} onClick={() => setLinkAcc(null)}>Batal</button>
                <button
                  className="btn primary"
                  disabled={linkBusy || linkSalah.length > 0}
                  onClick={saveLinkAcc}
                >
                  {linkBusy ? 'Menyimpan\u2026' : 'Simpan alamat'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pwUser && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !pwBusy && setPwUser(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--amber, #d9a441)' }} />
                  Reset password
                </div>
                <div className="modal-title">{pwUser.full_name || pwUser.email}</div>
                <div className="modal-sub">{pwUser.email}</div>
              </div>
              <button className="btn ghost modal-close" disabled={pwBusy} onClick={() => setPwUser(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Password baru</label>
                <input
                  type={pwLihat ? 'text' : 'password'}
                  value={pwValue}
                  disabled={pwBusy}
                  autoComplete="new-password"
                  placeholder="minimal 6 karakter"
                  onChange={(e) => setPwValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && pwValue.trim().length >= 6 && doResetPw()}
                />
                <div className="hint" style={{ color: kurangPw > 0 ? 'var(--amber)' : 'var(--green)' }}>
                  {pwValue.length === 0
                    ? 'Belum diisi.'
                    : kurangPw > 0
                      ? `Kurang ${kurangPw} karakter lagi.`
                      : 'Panjangnya sudah cukup.'}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPwLihat(!pwLihat)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  background: 'transparent', border: 0, padding: '2px 0 14px',
                  font: 'inherit', fontSize: 12.5, color: 'var(--text-2)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid ' + (pwLihat ? 'var(--accent)' : 'var(--border)'),
                    background: pwLihat ? 'var(--accent)' : 'transparent',
                    color: '#fff', fontSize: 10, lineHeight: 1, fontWeight: 700,
                  }}
                >
                  {pwLihat ? '\u2713' : ''}
                </span>
                Tampilkan password
              </button>

              <div
                style={{
                  background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
                  borderLeft: '2px solid var(--amber)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                <b style={{ color: 'var(--text)' }}>Catat dulu sebelum menyimpan.</b> Setelah jendela ini ditutup,
                passwordnya tidak bisa dilihat lagi. Sampaikan ke orangnya dan minta segera diganti sendiri.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={pwBusy} onClick={() => setPwUser(null)}>Batal</button>
                <button
                  className="btn primary"
                  disabled={pwBusy || pwValue.trim().length < 6}
                  onClick={doResetPw}
                >
                  {pwBusy ? 'Menyimpan\u2026' : 'Simpan password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delUser && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !delUserBusy && setDelUser(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus user
                </div>
                <div className="modal-title">Hapus &ldquo;{delUser.full_name || delUser.email}&rdquo;?</div>
                <div className="modal-sub">{delUser.email}</div>
              </div>
              <button className="btn ghost modal-close" disabled={delUserBusy} onClick={() => setDelUser(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '18px 24px 4px' }}>
              <div
                style={{
                  background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                  borderLeft: '2px solid var(--red)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                <b style={{ color: 'var(--text)' }}>Permanen dan tidak bisa dibatalkan.</b> Akunnya hilang dari
                sistem login, tapi jejak pekerjaannya di konten, pengajuan, dan lembur{' '}
                <b style={{ color: 'var(--text)' }}>tetap tercatat</b>. Kalau orangnya cuma keluar atau pindah,
                lebih baik <b style={{ color: 'var(--text)' }}>nonaktifkan</b> saja.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={delUserBusy} onClick={() => setDelUser(null)}>Batal</button>
                <button
                  className="btn danger"
                  disabled={delUserBusy}
                  onClick={confirmDeleteUser}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                >
                  {delUserBusy ? 'Menghapus\u2026' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delAcc && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !delAccBusy && setDelAcc(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus akun media
                </div>
                <div className="modal-title">Hapus &ldquo;{delAcc.handle}&rdquo;?</div>
                <div className="modal-sub">{delAcc.label || 'Tanpa label'}</div>
              </div>
              <button className="btn ghost modal-close" disabled={delAccBusy} onClick={() => setDelAcc(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '18px 24px 4px' }}>
              <div
                style={{
                  background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                  borderLeft: '2px solid var(--red)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                Kalau akun ini sudah pernah dipakai konten, penghapusan akan ditolak database.
                Untuk akun yang sudah tidak dipakai lagi, pakai <b style={{ color: 'var(--text)' }}>Nonaktif</b> —
                konten lama tetap menampilkan akunnya dengan benar.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={delAccBusy} onClick={() => setDelAcc(null)}>Batal</button>
                <button
                  className="btn danger"
                  disabled={delAccBusy}
                  onClick={confirmDeleteAccount}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                >
                  {delAccBusy ? 'Menghapus\u2026' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editMember && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !editMemberBusy && setEditMember(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--blue, #2f6fd0)' }} />
                  Ubah anggota
                </div>
                <div className="modal-title">{editMember.name}</div>
                <div className="modal-sub">
                  Nama dan tim diubah di tempat, jadi konten lama yang PIC-nya orang ini <b>tetap utuh</b>.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={editMemberBusy} onClick={() => setEditMember(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Nama</label>
                <input
                  value={editMemberName}
                  disabled={editMemberBusy}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && editMemberName.trim() && saveMember()}
                />
              </div>
              <div className="field" style={{ marginBottom: editMemberTeam !== editMember.team ? 12 : 0 }}>
                <label>Tim</label>
                <select
                  value={editMemberTeam}
                  disabled={editMemberBusy}
                  onChange={(e) => setEditMemberTeam(e.target.value as Team)}
                >
                  {MEMBER_TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
                  {/* Tim di luar daftar PIC tetap ditampilkan kalau kebetulan
                      terpasang, supaya tidak diam-diam tertimpa saat menyimpan. */}
                  {!MEMBER_TEAMS.includes(editMemberTeam) && (
                    <option value={editMemberTeam}>{TEAM_LABEL[editMemberTeam] || editMemberTeam}</option>
                  )}
                </select>
              </div>
              {editMemberTeam !== editMember.team && (
                <div
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    borderLeft: '2px solid var(--accent)',
                    borderRadius: '0 6px 6px 0',
                    padding: '9px 12px',
                    fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                  }}
                >
                  Pindah dari <b style={{ color: 'var(--text)' }}>{TEAM_LABEL[editMember.team] || editMember.team}</b> ke{' '}
                  <b style={{ color: 'var(--text)' }}>{TEAM_LABEL[editMemberTeam] || editMemberTeam}</b>.
                  Namanya hilang dari dropdown PIC tim lama dan muncul di tim baru.
                  Hak aksesnya <b style={{ color: 'var(--text)' }}>tidak</b> ikut berubah — itu diatur di tab <b style={{ color: 'var(--text)' }}>Akun</b>.
                </div>
              )}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={editMemberBusy} onClick={() => setEditMember(null)}>Batal</button>
                <button
                  className="btn primary"
                  disabled={editMemberBusy || !editMemberName.trim()}
                  onClick={saveMember}
                >
                  {editMemberBusy ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {delMember && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !delMemberBusy && setDelMember(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus anggota PIC
                </div>
                <div className="modal-title">Hapus &ldquo;{delMember.name}&rdquo;?</div>
                <div className="modal-sub">
                  Kalau orangnya masih tercatat sebagai PIC di konten mana pun, penghapusan akan ditolak database.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={delMemberBusy} onClick={() => setDelMember(null)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px 4px' }}>
              <div
                style={{
                  background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                  borderLeft: '2px solid var(--red)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                Untuk orang yang keluar atau pindah divisi, pakai <b style={{ color: 'var(--text)' }}>Nonaktif</b> —
                namanya hilang dari dropdown tapi riwayat konten lama tetap menampilkan siapa yang dulu mengerjakan.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={delMemberBusy} onClick={() => setDelMember(null)}>Batal</button>
                <button
                  className="btn danger"
                  disabled={delMemberBusy}
                  onClick={confirmDeleteMember}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                >
                  {delMemberBusy ? 'Menghapus…' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                    <TeamOptions vertical={nu.vertical} />
                  </select>
                </div>
                <div className="field">
                  <label>Vertical</label>
                  <select value={nu.vertical} onChange={(e) => setNu({ ...nu, vertical: e.target.value })}>
                    {USER_VERTICALS.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
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
