'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, VERTICALS, type Account, type Profile, type Project, type Role, type Team, type TeamMember } from '@/lib/types';
import { sigma, type SigmaProject } from '@/lib/sigma';

const ROLES: Role[] = ['superadmin', 'manager', 'tim'];
const TEAMS: (Team | '')[] = ['', 'delta', 'creative', 'distribution', 'ads', 'pm'];
const MEMBER_TEAMS: Team[] = ['creative', 'distribution', 'ads', 'delta'];

interface Props {
  selfId: string;
  onAccountsChanged?: () => void;
  activeProjectId?: string;
  activeProjectName?: string | null;
}

export default function AccessView({ selfId, onAccountsChanged, activeProjectId = 'all', activeProjectName = null }: Props) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newAccProject, setNewAccProject] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const [tab, setTab] = useState<'user' | 'project' | 'akun' | 'tim'>('user');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [newHandle, setNewHandle] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberTeam, setNewMemberTeam] = useState<Team>('creative');

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
    const [u, a, m, pr] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('accounts').select('*').order('handle'),
      supabase.from('team_members').select('*').order('team').order('name'),
      supabase.from('projects').select('*').order('name'),
    ]);
    setUsers((u.data as Profile[]) || []);
    setAccounts((a.data as Account[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setProjects((pr.data as Project[]) || []);
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

  const flash = (m: string) => setMsg(m);

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
              <button className={`atab ${tab === 'tim' ? 'active' : ''}`} onClick={() => setTab('tim')}>Anggota Tim</button>
            </div>

            {tab === 'user' && (<>
            {/* ================= USER LOGIN ================= */}
            <div className="section-title">User Login</div>
            <p className="section-hint">
              Tambah user baru: Supabase Dashboard → Authentication → Add user — otomatis muncul di sini.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Role</th><th>Team</th><th>Vertical</th><th>Status</th></tr>
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
                  <tr><th>Project</th><th>Vertical</th><th>Label</th><th>Status</th></tr>
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
                    </tr>
                  ))}
                  {projects.length === 0 && <tr><td colSpan={4} className="empty">Belum ada project.</td></tr>}
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
            <div className="add-row">
              <input placeholder="@handle akun" value={newHandle} onChange={(e) => setNewHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
              <input placeholder="Label (opsional) — mis. Media film" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
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
                      <td>{a.label || '—'}</td>
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
        {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-2)' }}>{msg}</p>}
      </div>
    </>
  );
}
