'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  bebasPilihVertical, canAddProject as bolehTambahProject, initials, VERTICALS,
  type Account, type Profile, type Project, type Vertical,
} from '@/lib/types';
import Login from '@/components/Login';
import { AlphaBadge } from '@/components/Logo';
import Board from '@/components/Board';
import LogView from '@/components/LogView';
import AccessView from '@/components/AccessView';
import CalendarView from '@/components/CalendarView';
import ReportView from '@/components/ReportView';
import ExportView from '@/components/ExportView';
import RecapView from '@/components/RecapView';
import BudgetView from '@/components/BudgetView';
import OvertimeView from '@/components/OvertimeView';
import SebaranView from '@/components/SebaranView';
import ComplaintView from '@/components/ComplaintView';
import ComplaintWidget from '@/components/ComplaintWidget';
import ChatView from '@/components/ChatView';
import TrackerView from '@/components/TrackerView';

type View = 'board' | 'kalender' | 'tracker' | 'ads' | 'recap' | 'budget' | 'lembur' | 'sebaran' | 'chat' | 'laporan' | 'ekspor' | 'komplain' | 'log' | 'access';

const NAV: { key: View; label: string }[] = [
  { key: 'board', label: 'Board Pipeline' },
  { key: 'kalender', label: 'Kalender Tayang' },
  { key: 'tracker', label: 'Tracker' },
  { key: 'ads', label: 'Ads Tracker' },
  { key: 'recap', label: 'Recap Report' },
  { key: 'budget', label: 'Pengajuan Budget' },
  { key: 'lembur', label: 'Lembur' },
  { key: 'sebaran', label: 'Sebaran Harian' },
  { key: 'chat', label: 'Chat Project' },
  { key: 'laporan', label: 'Laporan Kerja' },
  { key: 'ekspor', label: 'Ekspor Data' },
  { key: 'komplain', label: 'Komplain' },
  { key: 'log', label: 'Log Aktivitas' },
  { key: 'access', label: 'Kelola Akses' },
];

const ICON_PATHS: Record<View, React.ReactNode> = {
  board: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </>
  ),
  kalender: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  tracker: (
    <>
      <line x1="9" y1="4" x2="7" y2="20" />
      <line x1="17" y1="4" x2="15" y2="20" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
    </>
  ),
  ads: (
    <>
      <path d="M3 11v3l14 4V7L3 11z" />
      <path d="M20 9.5a3 3 0 0 1 0 6" />
      <path d="M7 14.6V19a1 1 0 0 0 1 1h2" />
    </>
  ),
  recap: (
    <>
      <path d="M4 4a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <polyline points="13 2 13 7 18 7" />
      <polyline points="9 14 12 11 15 14" />
      <line x1="12" y1="11" x2="12" y2="18" />
    </>
  ),
  budget: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
      <circle cx="17" cy="14" r="1.5" />
    </>
  ),
  lembur: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  sebaran: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  chat: (
    <>
      <path d="M20.5 12.2a6.6 6.6 0 0 1-9.4 6L4.5 20l1.7-5.2a6.6 6.6 0 1 1 14.3-2.6z" />
      <circle cx="9" cy="12.4" r=".9" />
      <circle cx="12.5" cy="12.4" r=".9" />
      <circle cx="16" cy="12.4" r=".9" />
    </>
  ),
  laporan: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  komplain: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.3A8.4 8.4 0 1 1 21 11.5z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="15.5" x2="12" y2="15.6" />
    </>
  ),
  log: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="5" cy="6" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="5" cy="18" r="1" />
    </>
  ),
  ekspor: (
    <>
      <path d="M12 3v10" />
      <polyline points="8 9.5 12 13.5 16 9.5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  access: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M16.5 14.2c2.7.4 4.5 2.6 4.5 5.3" />
    </>
  ),
};

const NavIcon = ({ view }: { view: View }) => (
  <svg className="nav-svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON_PATHS[view]}
  </svg>
);

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" />
    <line x1="12" y1="2.5" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21.5" />
    <line x1="2.5" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21.5" y2="12" />
    <line x1="5.3" y1="5.3" x2="7" y2="7" /><line x1="17" y1="17" x2="18.7" y2="18.7" />
    <line x1="5.3" y1="18.7" x2="7" y2="17" /><line x1="17" y1="7" x2="18.7" y2="5.3" />
  </svg>
);

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
    {collapsed
      ? <polyline points="13 9 16 12 13 15" />
      : <polyline points="16 9 13 12 16 15" />}
  </svg>
);

/** Dipakai menggantikan CollapseIcon di layar HP — drawer ditutup, bukan diciutkan. */
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="content-area">
      <div className="placeholder-page">
        <div className="ph-badge">Fase berikutnya</div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>('all');
  const [accMenuOpen, setAccMenuOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjLabel, setNewProjLabel] = useState('');
  const [newProjVertical, setNewProjVertical] = useState<Vertical>('KC');
  const [addingProj, setAddingProj] = useState(false);
  /** Pesan gagal tambah project. Dulu window.alert — diblokir, jadi gagalnya diam. */
  const [projErr, setProjErr] = useState('');
  const [view, setView] = useState<View>('board');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const savedTheme = window.localStorage?.getItem('alpha-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
    if (window.localStorage?.getItem('alpha-sidebar') === 'collapsed') setCollapsed(true);
  }, []);

  /**
   * Di layar HP sidebar tampil sebagai drawer penuh — mode "collapsed" (ikon saja)
   * tidak berlaku, kalau dipaksa label menu hilang semua. Breakpoint ini WAJIB
   * sama dengan @media (max-width: 820px) di globals.css.
   */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /** Sidebar ramping (ikon saja) hanya boleh terjadi di desktop. */
  const slim = collapsed && !isMobile;

  /** Tutup drawer otomatis kalau layar melebar (mis. HP diputar ke landscape). */
  useEffect(() => {
    if (!isMobile && mobileNav) setMobileNav(false);
  }, [isMobile, mobileNav]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage?.setItem('alpha-theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    try { window.localStorage?.setItem('alpha-sidebar', collapsed ? 'collapsed' : 'open'); } catch {}
  }, [collapsed]);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile((data as Profile) || null);
  }, []);

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase.from('accounts').select('*').eq('is_active', true).order('handle');
    setAccounts((data as Account[]) || []);
  }, []);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase.from('projects').select('*').eq('is_active', true).order('name');
    setProjects((data as Project[]) || []);
  }, []);

  /** Vertical yang benar-benar dipakai saat menyimpan. Yang tidak bebas
   *  memilih dikunci ke vertical akunnya sendiri — dijaga juga di database,
   *  jadi mengakali tampilan tidak menolong. */
  const verticalDipakai = (): Vertical => {
    if (bebasPilihVertical(profile)) return newProjVertical;
    const milikku = profile?.vertical;
    const cocok = VERTICALS.find((v) => v.key === milikku);
    return cocok ? cocok.key : newProjVertical;
  };

  const addProject = async () => {
    if (!newProjName.trim()) return;
    setAddingProj(true);
    setProjErr('');
    // .select('id') supaya penolakan RLS — yang mengenai 0 baris TANPA error —
    // tidak terlihat seperti berhasil.
    const { data, error } = await supabase.from('projects').insert({
      name: newProjName.trim(),
      label: newProjLabel.trim() || null,
      vertical: verticalDipakai(),
    }).select('id');
    setAddingProj(false);
    if (error || !data || data.length === 0) {
      setProjErr('Gagal menambah project — hanya PM dan superadmin yang bisa.');
      return;
    }
    setNewProjName(''); setNewProjLabel('');
    loadProjects();
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfile(data.session.user.id);
        loadAccounts();
        loadProjects();
      }
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) {
        loadProfile(s.user.id);
        loadAccounts();
        loadProjects();
      } else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile, loadAccounts, loadProjects]);

  if (booting) return null;
  if (!session) return <Login />;

  const isSuper = profile?.role === 'superadmin';
  const canSeeLog = profile?.role === 'superadmin' || profile?.role === 'manager';
  const navItems = NAV.filter((n) => {
    if (n.key === 'access') return isSuper;
    if (n.key === 'log') return canSeeLog;
    return true;
  });

  const activeProj = projects.find((p) => p.id === activeProject) || null;
  // Dulu: superadmin ATAU manager mana pun — 19 orang melihat tombolnya,
  // padahal database hanya menerima 3 (superadmin atau vertical 'ALL'), dan PM
  // yang justru berkepentingan malah ditolak. Sekarang keduanya disamakan.
  const canAddProject = bolehTambahProject(profile);
  const bebasVertical = bebasPilihVertical(profile);
  const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'User';
  const logout = () => supabase.auth.signOut();

  return (
    <div className="app-shell">
      {/* Hanya tampil di layar kecil — lihat globals.css */}
      <button
        className="mobile-nav-btn"
        aria-label="Buka menu"
        onClick={() => setMobileNav(true)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      {mobileNav && <div className="nav-backdrop" onClick={() => setMobileNav(false)} />}
      {/* Menu project melayang menutup saat diklik di luar. Pakai lapisan
          backdrop, BUKAN listener mousedown di document — listener itu menutup
          menu sebelum event click sempat terpicu, jadi pilihannya tidak jalan. */}
      {accMenuOpen && !isMobile && (
        <div className="acc-backdrop" onClick={() => setAccMenuOpen(false)} />
      )}

      <aside className={`sidebar ${slim ? 'collapsed' : ''} ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand">
          <AlphaBadge size={30} />
          {!slim && (
            <div>
              <h1>Alpha</h1>
              <div className="brand-sub">CONTENT LAUNCH</div>
            </div>
          )}
          <button
            className="icon-btn collapse-btn"
            title={isMobile ? 'Tutup menu' : slim ? 'Buka sidebar' : 'Tutup sidebar'}
            onClick={() => {
              setAccMenuOpen(false);
              // Di HP tombol ini menutup drawer, bukan menciutkan sidebar.
              if (isMobile) setMobileNav(false);
              else setCollapsed(!collapsed);
            }}
          >
            {isMobile ? <CloseIcon /> : <CollapseIcon collapsed={slim} />}
          </button>
        </div>

        {!slim && (
          <>
            <div className="section-label">Project</div>
            {/* Pembungkus ini yang jadi jangkar posisi menu project.
                Tanpa dia, menunya tidak punya patokan dan harus dipaksa pakai
                offset angka mati yang gampang meleset kalau sidebar berubah. */}
            <div className="acc-wrap">
            <button className="account-picker" onClick={() => setAccMenuOpen(!accMenuOpen)}>
              <div className="acc-avatar">{activeProj ? initials(activeProj.name) : '∗'}</div>
              <div>
                <div className="acc-name">{activeProj ? activeProj.name : 'Semua project'}</div>
                <div className="acc-sub">
                  {activeProj
                    ? `${activeProj.vertical || '—'} · ${activeProj.label || accounts.filter((a) => a.project_id === activeProj.id).length + ' akun'}`
                    : `${projects.length} project aktif`}
                </div>
              </div>
              <span className="acc-caret">{accMenuOpen ? '▴' : '▾'}</span>
            </button>
            {accMenuOpen && (
              <div className="account-menu">
                <button className="account-option" onClick={() => { setActiveProject('all'); setAccMenuOpen(false); setMobileNav(false); }}>
                  <div className="acc-avatar" style={{ background: 'var(--raised)', color: 'var(--text)' }}>∗</div>
                  <div className="acc-name">Semua project</div>
                  {activeProject === 'all' && <span className="check">✓</span>}
                </button>
                {projects.map((pr) => (
                  <button key={pr.id} className="account-option" onClick={() => { setActiveProject(pr.id); setAccMenuOpen(false); setMobileNav(false); }}>
                    <div className="acc-avatar">{initials(pr.name)}</div>
                    <div>
                      <div className="acc-name">{pr.name}</div>
                      <div className="acc-sub">
                        {pr.vertical ? pr.vertical + ' · ' : ''}
                        {pr.label || `${accounts.filter((a) => a.project_id === pr.id).length} akun`}
                      </div>
                    </div>
                    {activeProject === pr.id && <span className="check">✓</span>}
                  </button>
                ))}
                {canAddProject && (
                  <div className="proj-add">
                    <input
                      placeholder="Nama project baru"
                      value={newProjName}
                      onChange={(e) => { setNewProjName(e.target.value); if (projErr) setProjErr(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && addProject()}
                    />
                    <input
                      placeholder="Label (opsional)"
                      value={newProjLabel}
                      onChange={(e) => setNewProjLabel(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addProject()}
                    />
                    {bebasVertical ? (
                      <select value={newProjVertical} onChange={(e) => setNewProjVertical(e.target.value as Vertical)}>
                        {VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.key}</option>)}
                      </select>
                    ) : (
                      <select value={verticalDipakai()} disabled title="Project baru mengikuti unit bisnismu">
                        <option value={verticalDipakai()}>{verticalDipakai()}</option>
                      </select>
                    )}
                    <button className="btn primary" onClick={addProject} disabled={addingProj || !newProjName.trim()}>
                      {addingProj ? 'Menyimpan…' : '+ Project baru'}
                    </button>
                    {projErr && (
                      <div
                        style={{
                          background: 'color-mix(in srgb, var(--red) 12%, transparent)',
                          borderLeft: '2px solid var(--red)',
                          borderRadius: '0 6px 6px 0',
                          padding: '7px 10px', marginTop: 2,
                          fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-2)',
                        }}
                      >
                        {projErr}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
            <div className="section-label">Menu</div>
          </>
        )}

        {navItems.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${view === n.key ? 'active' : ''}`}
            title={slim ? n.label : undefined}
            onClick={() => { setView(n.key); setMobileNav(false); }}
          >
            <NavIcon view={n.key} />
            {!slim && n.label}
          </button>
        ))}

        <div className="sidebar-footer">
          <button
            className={slim ? 'icon-btn footer-icon' : 'btn ghost theme-btn'}
            title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            {!slim && <span style={{ marginLeft: 8 }}>{theme === 'dark' ? 'Mode terang' : 'Mode gelap'}</span>}
          </button>
          {slim ? (
            <>
              <div className="user-avatar" title={`${displayName} · ${profile?.role || ''}`}>{initials(displayName)}</div>
              <button className="icon-btn footer-icon" title="Keluar" onClick={logout}><LogoutIcon /></button>
            </>
          ) : (
            <div className="user-chip">
              <div className="user-avatar">{initials(displayName)}</div>
              <div>
                <div className="u-name">{displayName}</div>
                <div className="u-role">{profile ? `${profile.role}${profile.team ? ' · ' + profile.team : ''}` : '…'}</div>
              </div>
              <button className="icon-btn" title="Keluar" onClick={logout}><LogoutIcon /></button>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {view === 'board' && (
          <Board profile={profile} accounts={accounts} projects={projects} projectFilter={activeProject} />
        )}
        {view === 'kalender' && <CalendarView accounts={accounts} projectFilter={activeProject} />}
        {view === 'tracker' && <TrackerView activeProjectName={activeProj ? activeProj.name : null} profile={profile} />}
        {view === 'ads' && (
          <Placeholder
            title="Ads Tracker"
            desc="Rekap budget, status kampanye, kode ads, dan hasil reach per konten yang diiklankan. Menyusul di fase berikutnya."
          />
        )}
        {view === 'recap' && (
          <RecapView profile={profile} projects={projects} projectFilter={activeProject} />
        )}
        {view === 'budget' && <BudgetView profile={profile} projects={projects} projectFilter={activeProject} />}
        {view === 'lembur' && <OvertimeView profile={profile} projects={projects} projectFilter={activeProject} />}
        {view === 'sebaran' && <SebaranView profile={profile} projects={projects} projectFilter={activeProject} />}
        {view === 'chat' && <ChatView profile={profile} projects={projects} projectFilter={activeProject} />}
        {view === 'laporan' && <ReportView projects={projects} projectFilter={activeProject} />}
        {view === 'ekspor' && (
          <ExportView profile={profile} projects={projects} accounts={accounts} projectFilter={activeProject} />
        )}
        {view === 'komplain' && <ComplaintView profile={profile} />}
        {view === 'log' && canSeeLog && <LogView />}
        {view === 'access' && isSuper && <AccessView selfId={session.user.id} onAccountsChanged={loadAccounts} activeProjectId={activeProject} activeProjectName={activeProj ? activeProj.name : null} />}
      </main>
      <ComplaintWidget profile={profile} />
    </div>
  );
}
