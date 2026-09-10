'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { boleh, initials, KOLOM_URL_AKUN, PLATFORMS, ROLES, tagColor, TUGAS, TEAM_GROUPS, TEAM_LABEL, teamsForVertical, VERTICALS, type Account, type ContentCategory, type IzinBaris, type IzinTim, type Profile, type Project, type Role, type Team, type TeamMember, type TugasDef } from '@/lib/types';

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
  /** Dipakai untuk menentukan tab mana yang boleh dibuka. */
  profile: Profile | null;
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

export default function AccessView({ profile, selfId, onAccountsChanged, activeProjectId = 'all', activeProjectName = null }: Props) {
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

  type TabKey = 'user' | 'bagan' | 'project' | 'akun' | 'kategori' | 'tim' | 'izin';

  /**
   * Tab mana yang boleh dibuka orang ini.
   *
   * `user` dan `izin` DIKUNCI DI KODE untuk superadmin — sengaja tidak jadi
   * baris matriks. Kalau 'izin' bisa dibuka lewat centang, orang yang diberi
   * satu tab bisa mencentang dirinya sendiri jadi bisa segalanya. Sama seperti
   * SIGMA yang menulis "Kelola User permanen khusus Superadmin".
   *
   * `project` juga superadmin: ubah/hapus project memakai aturan unit bisnis
   * (can_see_all), bukan peran — lihat baris terkunci di matriks.
   */
  const isSuperadmin = profile?.role === 'superadmin';
  const izinTab: Record<TabKey, boolean> = {
    user:     !!isSuperadmin,
    // Bagan menentukan siapa menyetujui cuti siapa — itu keputusan struktur,
    // bukan tugas harian. Dikunci di kode untuk superadmin seperti User Login.
    bagan:    !!isSuperadmin,
    izin:     !!isSuperadmin,
    project:  !!isSuperadmin,
    akun:     boleh(profile, TUGAS.akunMediaKelola),
    kategori: boleh(profile, TUGAS.kategoriKelola),
    tim:      boleh(profile, TUGAS.anggotaPicKelola),
  };
  const TAB_LABEL: Record<TabKey, string> = {
    user: 'User Login', bagan: 'Bagan Tim', project: 'Project & Vertical', akun: 'Akun Media',
    kategori: 'Kategori Konten', tim: 'Anggota Tim', izin: 'Izin Peran',
  };
  const URUTAN_TAB: TabKey[] = ['user', 'bagan', 'project', 'akun', 'kategori', 'tim', 'izin'];
  const tabBoleh = URUTAN_TAB.filter((k) => izinTab[k]);

  // Tab awal = tab pertama yang boleh dibuka, bukan selalu 'user'.
  const [tab, setTab] = useState<TabKey>(tabBoleh[0] || 'user');

  // Kalau izinnya berubah (matriks dimuat belakangan, atau centangnya dicabut
  // orang lain), pindahkan ke tab yang masih boleh — jangan biarkan menatap
  // layar kosong.
  useEffect(() => {
    if (!izinTab[tab] && tabBoleh.length > 0) setTab(tabBoleh[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, izinTab.user, izinTab.bagan, izinTab.izin, izinTab.project, izinTab.akun, izinTab.kategori, izinTab.tim]);

  /* ================= IZIN PERAN =================
     Cerminan tabel role_permissions & role_permission_teams. Yang tampil di
     sini persis yang dibaca RLS lewat fungsi boleh() — jadi mencentang di
     layar ini benar-benar mengubah wewenang, bukan cuma tampilan. */
  const [tugasDefs, setTugasDefs] = useState<TugasDef[]>([]);
  const [izinBaris, setIzinBaris] = useState<IzinBaris[]>([]);
  const [izinTim, setIzinTim] = useState<IzinTim[]>([]);
  const [izinBusy, setIzinBusy] = useState('');
  const [bukaTim, setBukaTim] = useState<string | null>(null);
  /** Tugas yang barisnya sedang dibuka untuk diatur. Hanya satu pada satu waktu. */
  const [bukaIzin, setBukaIzin] = useState<string | null>(null);

  /**
   * SIAPA yang benar-benar bisa melakukan sebuah tugas.
   *
   * Tabel ini dulu memperlihatkan mekanismenya — centang peran di satu kolom,
   * chip tim di kolom lain — lalu pembacanya harus mengalikan sendiri di
   * kepala untuk tahu hasilnya. Padahal yang ditanyakan orang selalu "siapa
   * yang bisa", bukan "peran mana yang dicentang".
   *
   * Aturannya disalin dari fungsi boleh() di database: peran memberi izin,
   * pembatas tim mempersempit. Superadmin selalu bisa.
   */
  const orangYangBisa = (tugas: string): Profile[] =>
    users.filter((u) => {
      if (!u.is_active) return false;
      if (u.role === 'superadmin') return true;
      if (u.role !== 'manager' && u.role !== 'tim') return false;
      if (!dicentang(tugas, u.role)) return false;
      const pembatas = timUntuk(tugas, u.role);
      if (pembatas.length === 0) return true;
      return !!u.team && pembatas.includes(u.team);
    });

  /** Ringkasan satu peran: "semua tim" atau daftar timnya. */
  const ringkasPeran = (tugas: string, r: Role): string | null => {
    if (!dicentang(tugas, r)) return null;
    const pembatas = timUntuk(tugas, r);
    const nama = r === 'manager' ? 'Manager' : 'Tim';
    if (pembatas.length === 0) return `${nama} · semua tim`;
    return `${nama} · ${pembatas.map((tm) => TEAM_LABEL[tm]).join(', ')}`;
  };

  const loadIzin = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('permission_tasks').select('*').order('urutan'),
      supabase.from('role_permissions').select('tugas, role, boleh'),
      supabase.from('role_permission_teams').select('tugas, role, team'),
    ]);
    setTugasDefs((a.data as TugasDef[]) || []);
    setIzinBaris((b.data as IzinBaris[]) || []);
    setIzinTim((c.data as IzinTim[]) || []);
  }, []);

  useEffect(() => { if (tab === 'izin') loadIzin(); }, [tab, loadIzin]);

  const dicentang = (tugas: string, role: Role) =>
    izinBaris.some((x) => x.tugas === tugas && x.role === role && x.boleh);

  const timUntuk = (tugas: string, role: Role) =>
    izinTim.filter((x) => x.tugas === tugas && x.role === role).map((x) => x.team);

  /** Ubah satu centang. .select() wajib — UPDATE yang ditolak RLS mengenai
   *  0 baris TANPA error, jadi tanpa ini gagal terlihat seperti berhasil. */
  const ubahCentang = async (tugas: string, role: Role, nilai: boolean) => {
    const kunci = tugas + '|' + role;
    setIzinBusy(kunci);
    const { data, error } = await supabase
      .from('role_permissions')
      .update({ boleh: nilai, updated_at: new Date().toISOString(), updated_by: selfId })
      .eq('tugas', tugas).eq('role', role).select('tugas');
    setIzinBusy('');
    if (error || !data || data.length === 0) {
      setMsg('Gagal menyimpan — hanya superadmin yang boleh mengubah izin.');
      return;
    }
    setIzinBaris((lama) => lama.map((x) =>
      x.tugas === tugas && x.role === role ? { ...x, boleh: nilai } : x));
    setMsg('Tersimpan. Yang sedang login perlu memuat ulang halaman.');
  };

  /** Pasang/lepas satu tim sebagai pembatas. */
  const ubahPembatas = async (tugas: string, role: Role, team: Team, pasang: boolean) => {
    const kunci = tugas + '|' + role + '|' + team;
    setIzinBusy(kunci);
    let gagal = false;
    if (pasang) {
      const { error } = await supabase.from('role_permission_teams').insert({ tugas, role, team });
      gagal = !!error;
      if (!gagal) setIzinTim((lama) => lama.concat([{ tugas, role, team }]));
    } else {
      const { data, error } = await supabase.from('role_permission_teams')
        .delete().eq('tugas', tugas).eq('role', role).eq('team', team).select('tugas');
      gagal = !!error || !data || data.length === 0;
      if (!gagal) setIzinTim((lama) => lama.filter((x) =>
        !(x.tugas === tugas && x.role === role && x.team === team)));
    }
    setIzinBusy('');
    if (gagal) { setMsg('Gagal menyimpan pembatas tim.'); return; }
    setMsg('Tersimpan. Yang sedang login perlu memuat ulang halaman.');
  };

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

  /**
   * Ganti email login tanpa membuat akun baru.
   *
   * Sebelumnya satu-satunya jalan adalah Tambah User dengan alamat baru —
   * hasilnya dua akun untuk satu orang, dan yang lama tetap bisa dipakai login.
   */
  const doUbahEmail = async () => {
    if (!emailUser) return;
    const email = emailValue.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { flash('Format email belum benar.'); return; }
    if (email === (emailUser.email || '').toLowerCase()) { flash('Alamatnya sama dengan yang sekarang.'); return; }
    setEmailBusy(true);
    const d = await callUserApi({ action: 'update_email', user_id: emailUser.id, email });
    setEmailBusy(false);
    if (!d) return;
    setEmailUser(null);
    setEmailValue('');
    flash('Email login diganti. Mulai sekarang orangnya masuk pakai alamat yang baru.');
    load();
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
  // Ganti email login. Sengaja dipisah dari Reset PW karena akibatnya beda
  // jenis: reset password mengganti kuncinya, ganti email mengganti nama
  // pintunya — alamat lama langsung tidak bisa dipakai masuk lagi.
  const [emailUser, setEmailUser] = useState<Profile | null>(null);
  const [emailValue, setEmailValue] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
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

  /**
   * Apakah yang diketik sama dengan nama project.
   *
   * Perbandingannya SENGAJA tidak peka huruf besar-kecil. Label di modal itu
   * memakai `.field label` yang ber-`text-transform: uppercase`, jadi nama
   * "Rumah Singgah" tampil sebagai "RUMAH SINGGAH". Orang mengetik persis apa
   * yang dia lihat — lalu ditolak karena dibandingkan huruf per huruf dengan
   * nama aslinya. Spasi berlebih juga dirapikan: menyalin nama dari tempat lain
   * sering ikut membawa spasi ganda atau spasi di ujung.
   */
  const cocokNamaProject = (ketikan: string, nama: string): boolean => {
    const rapi = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    return rapi(ketikan) === rapi(nama) && rapi(nama) !== '';
  };

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
    // kalau ada isi, wajib ketik namanya
    if (hasData && !cocokNamaProject(delConfirmText, pr.name)) {
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

    // .select('id') wajib: DELETE yang ditolak RLS mengenai 0 baris TANPA
    // error, jadi tanpa ini penghapusan yang gagal tetap memunculkan pesan
    // "Project & seluruh isinya dihapus" padahal projectnya masih ada.
    const { data: terhapus, error } = await supabase
      .from('projects').delete().eq('id', pr.id).select('id');
    setDelBusy(false);
    if (error) { flash('Gagal menghapus project: ' + error.message); return; }
    if (!terhapus || terhapus.length === 0) {
      flash('Project tidak terhapus — wewenang akunmu tidak mencukupi.');
      load();
      return;
    }
    flash(hasData ? 'Project & seluruh isinya dihapus.' : 'Project dihapus.');
    setDelProj(null);
    load(); onAccountsChanged?.();
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
   * Kelola Akses ikut realtime.
   *
   * Sekarang layar ini dibuka lebih dari satu orang — PM & AM untuk Akun Media
   * dan Anggota PIC, manager untuk Kategori. Tanpa ini, dua orang bisa menambah
   * akun yang sama karena masing-masing melihat daftar yang sudah basi.
   *
   * Butuh Replication tabel-tabel di bawah dinyalakan di Supabase. Kalau belum,
   * kodenya tetap aman — hanya tidak terjadi apa-apa.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      // Ditunda: satu perubahan sering memicu beberapa kejadian beruntun.
      if (timer) clearTimeout(timer);
      // Matriks hanya ditarik ulang oleh yang memang melihat tabnya.
      timer = setTimeout(() => { load(); if (isSuperadmin) loadIzin(); }, 400);
    };

    const ch = supabase
      .channel('akses-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, segarkan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, segarkan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_categories' }, segarkan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, segarkan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' }, segarkan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permission_teams' }, segarkan)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [load, loadIzin, isSuperadmin]);

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

  /** Kotak cari & urutan daftar anggota. Daftarnya sudah 22 baris dan akan
   *  terus tumbuh — menggulir sambil mencari satu nama itu melelahkan. */
  const [cariAnggota, setCariAnggota] = useState('');
  const [urutAnggota, setUrutAnggota] = useState<'tim' | 'az' | 'za'>('tim');

  /**
   * Daftar anggota setelah dicari dan diurutkan.
   *
   * Pencariannya ikut menyertakan nama tim: mengetik "distribution" menampilkan
   * seluruh anggota tim itu — itu yang paling sering dicari orang, bukan cuma
   * nama orangnya.
   *
   * Urutan bawaan tetap per tim (seperti sebelumnya) supaya yang sudah hafal
   * letaknya tidak kehilangan arah; A-Z dan Z-A tinggal satu klik.
   */
  const anggotaTampil = useMemo(() => {
    const q = cariAnggota.trim().toLowerCase();
    const cocok = q
      ? members.filter((m) =>
        m.name.toLowerCase().indexOf(q) !== -1
        || (TEAM_LABEL[m.team] || m.team).toLowerCase().indexOf(q) !== -1)
      : members;
    if (urutAnggota === 'tim') return cocok;
    // localeCompare 'id' dengan sensitivity 'base' — HURUF BESAR tidak jadi
    // kelompok sendiri di atas huruf kecil, dan angka dibaca sebagai angka.
    const urut = cocok.slice().sort((a, b) =>
      a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }));
    return urutAnggota === 'az' ? urut : urut.reverse();
  }, [members, cariAnggota, urutAnggota]);

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

  /* ================= BAGAN TIM =================
     Menentukan siapa atasan langsung siapa. Yang ditunjuk di sini MENANG atas
     tangga otomatis di database (manager tim yang sama → HO → Pimpinan).

     Perlu ada karena tangga otomatis tidak bisa memilih waktu satu tim punya
     lebih dari satu manager: Distribution punya Aditya DAN Fiko, Creative
     punya Bagus DAN Merilla. Tanpa penunjukan, keduanya sama-sama kebagian
     antrean persetujuan dan notifikasi anak buah yang sama.
     ============================================ */

  /**
   * Daftar orang untuk tab Bagan. Sengaja TIDAK memakai usersTersaring:
   * penyaring pencarian & unit itu milik tab User Login, kotaknya tidak ada di
   * layar ini. Kalau dipakai bersama, seseorang yang tadi mencari satu nama di
   * tab sebelah akan melihat bagan yang isinya cuma satu baris tanpa tahu
   * sebabnya.
   */
  const orangBagan = useMemo(
    () => users
      .filter((u) => u.is_active)
      .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, 'id')),
    [users],
  );

  /** Siapa saja yang masuk akal jadi atasan: manager & superadmin yang aktif. */
  const calonAtasan = useMemo(
    () => users
      .filter((u) => u.is_active && (u.role === 'manager' || u.role === 'superadmin'))
      .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, 'id')),
    [users],
  );

  const namaOrang = (id: string | null | undefined) => {
    if (!id) return '';
    const u = users.find((x) => x.id === id);
    return u ? (u.full_name || u.email) : '(akun terhapus)';
  };

  /**
   * Atasan menurut tangga otomatis — dipakai HANYA untuk memberi tahu, supaya
   * superadmin tahu siapa yang akan kebagian kalau baganya dibiarkan kosong.
   * Aturannya disalin dari fungsi siapa_lead() di database.
   */
  const atasanOtomatis = (u: Profile): Profile[] => {
    if (u.team === 'pimpinan') return [];
    return users.filter((a) => {
      if (!a.is_active || a.role !== 'manager' || a.id === u.id) return false;
      if (a.vertical !== 'ALL' && a.vertical !== u.vertical) return false;
      if (u.team === 'ho') return a.team === 'pimpinan';
      if (u.role === 'manager') return a.team === 'ho';
      return a.team === u.team;
    });
  };

  /**
   * Menyimpan penunjukan atasan.
   *
   * Sengaja TIDAK memakai updateUser(): pesan error dari database perlu
   * ditampilkan apa adanya di sini. Kalau bagannya berputar, penjaga di
   * database menolak dengan alasan yang jelas — kalau pesannya diganti jadi
   * "Gagal menyimpan", orangnya tidak akan tahu apa yang salah.
   */
  const [baganBusy, setBaganBusy] = useState<string | null>(null);
  const simpanAtasan = async (orangId: string, atasanId: string) => {
    setBaganBusy(orangId);
    const { data, error } = await supabase
      .from('profiles')
      .update({ lead_id: atasanId || null })
      .eq('id', orangId)
      .select('id');
    setBaganBusy(null);
    if (error) { flash(error.message); return; }
    if (!data || data.length === 0) { flash('Tidak tersimpan — kamu tidak punya izin mengubah ini.'); return; }
    flash(atasanId ? `Atasan diubah jadi ${namaOrang(atasanId)}.` : 'Penunjukan dilepas — kembali ikut aturan otomatis.');
    load();
  };

  /** Menyalakan/mematikan penanda "cukup disetujui lead, tanpa HRD". */
  const simpanLewatiHrd = async (orangId: string, nilai: boolean) => {
    setBaganBusy(orangId);
    const { data, error } = await supabase
      .from('profiles').update({ cuti_lewati_hrd: nilai }).eq('id', orangId).select('id');
    setBaganBusy(null);
    if (error) { flash(error.message); return; }
    if (!data || data.length === 0) { flash('Tidak tersimpan — tidak punya izin.'); return; }
    flash(nilai ? 'Cutinya sekarang cukup disetujui lead.' : 'Cutinya kembali melewati HRD.');
    load();
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
    /**
     * Ditautkan ke akun login yang namanya cocok, DI SINI, saat ditambahkan.
     *
     * `team_members.profile_id` itu yang dipakai trigger `notif_content` untuk
     * mengirim "Kamu jadi PIC konten". Sebelumnya kolom ini tidak pernah diisi
     * lewat layar — 22 baris yang ada tertaut karena dicocokkan sekali lewat
     * migrasi, dan setiap anggota yang ditambahkan sesudah itu akan jadi PIC
     * yang tidak pernah menerima notifikasi, tanpa pesan kesalahan apa pun.
     *
     * Ini terutama menggigit orang yang punya DUA baris peran (mis. Creative
     * sekaligus Distribution): baris keduanya diam-diam tidak tertaut.
     */
    const cocok = users.find(
      (u) => u.is_active && (u.full_name || '').trim().toLowerCase() === name.toLowerCase());
    const { error } = await supabase.from('team_members')
      .insert({ name, team: newMemberTeam, profile_id: cocok ? cocok.id : null });
    if (error) { flash('Gagal menambah anggota.'); return; }
    setNewMemberName('');
    flash(cocok
      ? `${name} ditambahkan & ditautkan ke akun ${cocok.email} — notifikasi PIC akan sampai.`
      : `${name} ditambahkan. Belum ada akun login dengan nama persis itu, jadi notifikasi PIC tidak akan sampai ke orangnya.`);
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
              {tabBoleh.map((k) => (
                <button key={k} className={`atab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                  {k === 'project' ? <>Project &amp; Vertical</> : TAB_LABEL[k]}
                </button>
              ))}
            </div>

            {tab === 'user' && izinTab.user && (<>
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
                          <button className="btn act" onClick={() => { setEmailUser(u); setEmailValue(u.email || ''); }}>Ubah Email</button>
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

            {tab === 'bagan' && izinTab.bagan && (<>
              <div className="section-title">
                Bagan Tim
                <span className="sub" style={{ marginLeft: 8, fontWeight: 400, fontSize: 11.5 }}>
                  siapa menyetujui cuti &amp; menerima notifikasi siapa
                </span>
              </div>
              <p className="section-hint">
                Kosongkan kalau strukturnya sudah jelas dari timnya — yang kosong ikut aturan otomatis
                (manager di tim yang sama &rarr; Head of Operational &rarr; Pimpinan). Penunjukan di sini
                diperlukan ketika satu tim punya <b>lebih dari satu manager</b>, karena aturan otomatis
                tidak bisa memilih dan akhirnya keduanya sama-sama kebagian.
              </p>

              {/* Ringkasan bagan dulu, baru pengaturannya. Melihat bentuk
                  strukturnya lebih dulu bikin salah pasang jadi kelihatan. */}
              <div className="table-wrap" style={{ marginBottom: 18 }}>
                <table>
                  <thead><tr><th>Atasan</th><th>Anak buah yang ditunjuk</th></tr></thead>
                  <tbody>
                    {calonAtasan
                      .map((a) => ({ a, anak: users.filter((u) => u.lead_id === a.id && u.is_active) }))
                      .filter((x) => x.anak.length > 0)
                      .map(({ a, anak }) => (
                        <tr key={a.id}>
                          <td>
                            <span className="row-avatar">{initials(a.full_name || a.email)}</span>
                            <b>{a.full_name || a.email}</b>
                            <div className="sub" style={{ marginLeft: 40 }}>
                              {a.team ? TEAM_LABEL[a.team] : '—'}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {anak.map((k) => (
                                <span key={k.id} className="chip-btn" style={{ cursor: 'default' }}>
                                  {k.full_name || k.email}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    {users.filter((u) => u.lead_id && u.is_active).length === 0 && (
                      <tr><td colSpan={2} className="empty">
                        Belum ada yang ditunjuk — semuanya masih ikut aturan otomatis.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="section-title">Atur atasan per orang</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nama</th><th>Tim</th><th style={{ width: 220 }}>Atasan langsung</th>
                      <th style={{ width: 150 }}>Cuti tanpa HRD</th>
                      <th>Berlaku sekarang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orangBagan.map((u) => {
                      const otomatis = atasanOtomatis(u);
                      return (
                        <tr key={u.id}>
                          <td>
                            <span className="row-avatar">{initials(u.full_name || u.email)}</span>
                            <b>{u.full_name || '(tanpa nama)'}</b>
                            <div className="sub" style={{ marginLeft: 40 }}>{u.role}</div>
                          </td>
                          <td>{u.team ? TEAM_LABEL[u.team] : '—'}</td>
                          <td>
                            <select
                              value={u.lead_id || ''}
                              disabled={baganBusy === u.id}
                              onChange={(e) => simpanAtasan(u.id, e.target.value)}
                              style={u.lead_id ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
                            >
                              <option value="">— ikut aturan otomatis —</option>
                              {calonAtasan
                                .filter((a) => a.id !== u.id)
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {(a.full_name || a.email) + (a.team ? ` · ${TEAM_LABEL[a.team]}` : '')}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            {/* Penanda ini memendekkan alur persetujuan, jadi
                                ditaruh sebaris dengan atasannya — dua hal itu
                                sama-sama menentukan siapa yang mengetuk. */}
                            <label style={{
                              display: 'flex', alignItems: 'center', gap: 7,
                              fontSize: 11.5, cursor: 'pointer',
                              color: u.cuti_lewati_hrd ? 'var(--accent)' : 'var(--text-3)',
                            }}>
                              <input
                                type="checkbox"
                                checked={!!u.cuti_lewati_hrd}
                                disabled={baganBusy === u.id}
                                onChange={(e) => simpanLewatiHrd(u.id, e.target.checked)}
                              />
                              {u.cuti_lewati_hrd ? 'Cukup lead' : 'Lewat HRD'}
                            </label>
                          </td>
                          <td>
                            {u.lead_id ? (
                              <span style={{ color: 'var(--accent)' }}>{namaOrang(u.lead_id)}</span>
                            ) : otomatis.length === 0 ? (
                              <span style={{ color: 'var(--text-3)' }}>tidak ada — lewat superadmin</span>
                            ) : otomatis.length === 1 ? (
                              <span style={{ color: 'var(--text-2)' }}>{otomatis[0].full_name || otomatis[0].email}</span>
                            ) : (
                              // Inilah kasus yang bikin fitur ini perlu ada.
                              <span style={{ color: 'var(--amber)' }} title="Semuanya kebagian antrean orang ini">
                                {otomatis.map((a) => a.full_name || a.email).join(' & ')} &mdash; sebaiknya ditunjuk
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="cal-legend">
                Perubahan langsung berlaku untuk pengajuan <b>Cuti &amp; WFH</b> berikutnya. Pengajuan yang
                sudah berjalan tetap memakai jalur yang berlaku saat diajukan.
              </p>
            </>)}

            {tab === 'project' && izinTab.project && (<>
            {/* ================= PROJECT ================= */}
            <div className="section-head-row">
              <div className="section-title" style={{ margin: 0 }}>Project &amp; Vertical</div>
            </div>
            <p className="section-hint">
              Vertical menentukan siapa yang boleh melihat: orang <b>KC</b> tidak melihat project <b>GME</b>, dan sebaliknya.
              Pilih <b>KIG</b> untuk project lintas grup. Project baru dikirim <i>dari</i> SIGMA lewat tombol
              &ldquo;Kirim ke Alpha&rdquo; di sana, supaya tautan antar-sistemnya ikut tercatat.
            </p>
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

            {tab === 'akun' && izinTab.akun && (<>
            {/* ================= AKUN MEDIA ================= */}
            <div className="section-title">Akun Media</div>
            <p className="section-hint">
              {activeProjectName
                ? <>Menampilkan akun project <b>{activeProjectName}</b> — ganti lewat selector Project di sidebar. Akun yang belum punya project ikut ditampilkan di sini supaya bisa ditugaskan; selama project-nya kosong, akun itu tidak bisa dipilih di Board. Akun yang dipakai konten tidak bisa dihapus, nonaktifkan saja.</>
                : <>Semua akun media. Pilih project di sidebar untuk menyaring. Akun yang dipakai konten tidak bisa dihapus — nonaktifkan saja.</>}
              {' '}Kolom <b>Link</b> menyimpan alamat profil per platform — satu akun bisa dipakai di beberapa
              platform dengan username berbeda, jadi alamatnya diisi sendiri-sendiri. Yang belum diisi
              tidak akan ditautkan di Board.
              {' '}Centang <b>Akun umum</b> untuk akun yang mengangkat banyak judul — akun itu ikut muncul di
              dropdown Akun pada <b>semua project satu unit</b>, tapi tetap diurus dari project asalnya di
              kolom Project. KC tidak pernah bocor ke KIG.
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
                  <tr><th>Akun</th><th>Project</th><th style={{ width: 74 }}>Akun umum</th><th>Label</th><th>Link</th><th>Status</th><th style={{ width: 90 }}></th></tr>
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
                        {/* Akun umum = mengangkat banyak judul, mis. @sudutsinema_.
                            Ikut muncul di dropdown semua project SE-UNIT, tapi
                            project di sebelah kiri tetap jadi tempat mengurusnya. */}
                        <label
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                          title="Ikut muncul di dropdown semua project satu unit"
                        >
                          <input
                            type="checkbox"
                            checked={!!a.universal}
                            onChange={(e) => {
                              const nilai = e.target.checked;
                              supabase.from('accounts').update({ universal: nilai }).eq('id', a.id).select('id')
                                .then(({ data, error }) => {
                                  if (error || !data || data.length === 0) {
                                    flash('Gagal mengubah — butuh izin Kelola akun media.');
                                    return;
                                  }
                                  flash(nilai
                                    ? `${a.handle} sekarang muncul di semua project satu unit.`
                                    : `${a.handle} kembali khusus project asalnya.`);
                                  load(); onAccountsChanged?.();
                                });
                            }}
                          />
                          {a.universal && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>umum</span>
                          )}
                        </label>
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

            {tab === 'kategori' && izinTab.kategori && (<>
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

            {tab === 'tim' && izinTab.tim && (<>
            {/* ================= ANGGOTA TIM (PIC) ================= */}
            <div className="section-title">Anggota Tim (opsi PIC)</div>
            <p className="section-hint">
              Opsi dropdown PIC di form konten — tidak wajib punya akun login. Daftar ini <b>terpisah dari tab Akun</b>:
              mengubah tim seseorang di sana tidak mengubah timnya di sini, jadi kalau ada yang pindah tim, ubah di dua-duanya.
              Anggota yang masih jadi PIC konten tidak bisa dihapus — nonaktifkan saja.
              Satu orang boleh punya <b>lebih dari satu baris</b> kalau memang mengerjakan dua peran —
              mis. Creative sekaligus Distribution; tambahkan saja namanya lagi dengan tim yang berbeda.
            </p>
            <div className="add-row">
              <input placeholder="Nama anggota" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMember()} />
              <select value={newMemberTeam} onChange={(e) => setNewMemberTeam(e.target.value as Team)}>
                {MEMBER_TEAMS.map((t) => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
              </select>
              <button className="btn primary" onClick={addMember} disabled={!newMemberName.trim()}>+ Tambah</button>
            </div>

            {/* Cari & urutkan. Satu kotak cari + SATU tombol urut tiga keadaan —
                bukan dua tombol terpisah; barisnya sudah berisi form tambah. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' }}>
              <input
                value={cariAnggota}
                onChange={(e) => setCariAnggota(e.target.value)}
                placeholder="Cari nama atau tim…"
                style={{ flex: '1 1 220px', minWidth: 0, maxWidth: 320 }}
              />
              <button
                className="btn"
                onClick={() => setUrutAnggota((v) => (v === 'tim' ? 'az' : v === 'az' ? 'za' : 'tim'))}
                title={urutAnggota === 'tim'
                  ? 'Sedang urut per tim. Klik untuk urut nama A→Z.'
                  : urutAnggota === 'az'
                    ? 'Sedang urut nama A→Z. Klik untuk membalik.'
                    : 'Sedang urut nama Z→A. Klik untuk kembali per tim.'}
                style={{
                  whiteSpace: 'nowrap',
                  borderColor: urutAnggota !== 'tim' ? 'var(--accent)' : undefined,
                  color: urutAnggota !== 'tim' ? 'var(--accent)' : undefined,
                  background: urutAnggota !== 'tim' ? 'var(--accent-soft)' : undefined,
                  fontWeight: urutAnggota !== 'tim' ? 600 : undefined,
                }}
              >
                {urutAnggota === 'tim' ? '⇅ Per tim' : urutAnggota === 'az' ? '↑ Nama A→Z' : '↓ Nama Z→A'}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {cariAnggota.trim()
                  ? `${anggotaTampil.length} dari ${members.length} anggota`
                  : `${members.length} anggota`}
              </span>
              {cariAnggota.trim() !== '' && (
                <button className="btn ghost" onClick={() => setCariAnggota('')}>Hapus pencarian</button>
              )}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nama</th><th>Tim</th><th>Status</th><th style={{ width: 150 }}></th></tr>
                </thead>
                <tbody>
                  {anggotaTampil.map((m) => (
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
                  {anggotaTampil.length === 0 && (
                    <tr><td colSpan={4} className="empty">
                      {members.length === 0
                        ? 'Belum ada anggota.'
                        : `Tidak ada anggota yang cocok dengan "${cariAnggota.trim()}".`}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </>)}
            {tab === 'izin' && izinTab.izin && (<>
            {/* ================= IZIN PERAN =================
                Disusun ulang 9 Sep 2026. Versi sebelumnya menampilkan 23 baris
                datar dengan dua kolom centang dan dinding chip tim — bentuknya
                memperlihatkan MEKANISME, sementara yang dicari orang selalu
                HASIL: siapa yang bisa. Sekarang tiap baris menjawab itu lebih
                dulu, dan pengaturannya baru dibuka kalau memang mau diubah.
                ============================================== */}
            <div className="section-title">Izin Peran</div>
            <p className="section-hint">
              Siapa boleh melakukan apa. Perubahan <b>langsung berlaku</b>, dan tercatat di Log Aktivitas.
              Superadmin selalu punya semua izin.
            </p>

            {tugasDefs.length === 0 ? (
              <p className="empty">Memuat…</p>
            ) : (
              // Dikelompokkan memakai kolom `kelompok` yang selama ini sudah ada
              // di database tapi tidak pernah dipakai di layar. 23 baris datar
              // jadi 5 blok yang bisa dicerna.
              Array.from(new Set(tugasDefs.map((t) => t.kelompok))).map((kel) => (
                <div key={kel} style={{ marginBottom: 22 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
                    color: 'var(--text-3)', textTransform: 'uppercase',
                    padding: '0 2px 6px',
                  }}>
                    {kel}
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {tugasDefs.filter((t) => t.kelompok === kel).map((t, i) => {
                      const bisa = orangYangBisa(t.tugas);
                      const buka = bukaIzin === t.tugas;
                      const ringkas = (['manager', 'tim'] as Role[])
                        .map((r) => ringkasPeran(t.tugas, r))
                        .filter(Boolean) as string[];

                      return (
                        <div key={t.tugas} style={{ borderTop: i === 0 ? 0 : '1px solid var(--border)' }}>
                          <button
                            onClick={() => setBukaIzin(buka ? null : t.tugas)}
                            disabled={t.terkunci}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                              padding: '11px 14px', border: 0, background: buka ? 'var(--raised)' : 'transparent',
                              font: 'inherit', color: 'inherit', textAlign: 'left',
                              cursor: t.terkunci ? 'default' : 'pointer',
                              opacity: t.terkunci ? 0.55 : 1,
                            }}
                          >
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                                {t.label}
                                {t.terkunci && (
                                  <span className="hint" style={{ marginLeft: 6 }}>· dikunci</span>
                                )}
                              </span>
                              {/* Ringkasan aturannya, bukan chip yang bisa diklik —
                                  supaya barisnya bisa dibaca sekilas tanpa jadi
                                  dinding tombol. */}
                              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
                                {ringkas.length ? ringkas.join('  ·  ') : 'Belum diberikan ke siapa pun'}
                              </span>
                            </span>

                            {/* Inilah jawaban yang dicari: berapa orang, siapa saja. */}
                            <span style={{ flexShrink: 0, textAlign: 'right' }}>
                              <span style={{
                                display: 'block', fontSize: 13, fontWeight: 700,
                                color: bisa.length ? 'var(--accent)' : 'var(--text-3)',
                              }}>
                                {bisa.length} orang
                              </span>
                              <span style={{
                                display: 'block', fontSize: 10.5, color: 'var(--text-3)',
                                maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {bisa.slice(0, 4).map((u) => u.full_name || u.email).join(', ')}
                                {bisa.length > 4 ? ` +${bisa.length - 4}` : ''}
                              </span>
                            </span>

                            {!t.terkunci && (
                              <span style={{
                                flexShrink: 0, color: 'var(--text-3)', fontSize: 11,
                                transform: buka ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
                              }}>▸</span>
                            )}
                          </button>

                          {buka && !t.terkunci && (
                            <div style={{ padding: '4px 14px 14px', background: 'var(--raised)' }}>
                              {t.keterangan && (
                                <p className="hint" style={{ marginTop: 0 }}>{t.keterangan}</p>
                              )}

                              {(['manager', 'tim'] as Role[]).map((r) => {
                                const aktif = dicentang(t.tugas, r);
                                const dipakai = timUntuk(t.tugas, r);
                                const kunci = t.tugas + '|' + r;
                                return (
                                  <div key={r} style={{ marginTop: 10 }}>
                                    <label style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                                    }}>
                                      <input
                                        type="checkbox"
                                        checked={aktif}
                                        disabled={izinBusy === kunci}
                                        onChange={(e) => ubahCentang(t.tugas, r, e.target.checked)}
                                      />
                                      {r === 'manager' ? 'Manager' : 'Tim'}
                                    </label>

                                    {aktif && (
                                      <div style={{ margin: '6px 0 0 24px' }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                                          {dipakai.length === 0 && (
                                            <span className="hint" style={{ marginRight: 4 }}>
                                              berlaku untuk semua tim
                                            </span>
                                          )}
                                          {dipakai.map((tm) => (
                                            <button
                                              key={tm}
                                              className="btn act"
                                              style={{ padding: '0 7px' }}
                                              title={'Lepas pembatas ' + TEAM_LABEL[tm]}
                                              onClick={() => ubahPembatas(t.tugas, r, tm, false)}
                                            >
                                              {TEAM_LABEL[tm]} ✕
                                            </button>
                                          ))}
                                          {bukaTim === kunci ? (
                                            <select
                                              autoFocus
                                              defaultValue=""
                                              onBlur={() => setBukaTim(null)}
                                              onChange={(e) => {
                                                const tm = e.target.value as Team;
                                                setBukaTim(null);
                                                if (tm) ubahPembatas(t.tugas, r, tm, true);
                                              }}
                                            >
                                              <option value="">— pilih tim —</option>
                                              {TEAM_GROUPS.map((g) => (
                                                <optgroup key={g.label} label={g.label}>
                                                  {g.teams.filter((tm) => !dipakai.includes(tm)).map((tm) => (
                                                    <option key={tm} value={tm}>{TEAM_LABEL[tm]}</option>
                                                  ))}
                                                </optgroup>
                                              ))}
                                            </select>
                                          ) : (
                                            <button className="btn act" style={{ padding: '0 7px' }}
                                              onClick={() => setBukaTim(kunci)}>+ batasi tim</button>
                                          )}
                                        </div>

                                        {/* Peringatan ditaruh DI SINI, bukan di
                                            kepala halaman — di sinilah orangnya
                                            sedang akan melakukannya. */}
                                        {dipakai.length === 0 && (
                                          <div className="hint" style={{ color: 'var(--amber)', marginTop: 4 }}>
                                            Begitu satu tim ditambahkan, izinnya menyempit jadi tim itu saja —
                                            daftarkan sekalian semua tim yang harus tetap boleh.
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {/* Hasil akhirnya dieja lengkap, supaya tidak ada
                                  yang perlu ditebak sebelum menutup barisnya. */}
                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                                <div className="budget-detail-label">Berlaku untuk {bisa.length} orang</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                  {bisa.length === 0
                                    ? <span className="hint">Tidak ada seorang pun selain superadmin.</span>
                                    : bisa.map((u) => (
                                        <span key={u.id} className="chip-btn" style={{ cursor: 'default' }}>
                                          {u.full_name || u.email}
                                          {u.team ? ` · ${TEAM_LABEL[u.team]}` : ''}
                                        </span>
                                      ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            <p className="section-hint">
              Tiga hal <b>tidak</b> diatur di sini karena bukan soal peran: tahap kerja tiap tim di Board,
              dinding unit bisnis KC/GME/KIG, dan aturan &ldquo;milik sendiri&rdquo;. Orang yang sedang login perlu
              <b> memuat ulang halaman</b> untuk melihat efeknya di tombol; pembatasan di database berlaku seketika.
            </p>
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
        const canDelete = !hasData || cocokNamaProject(delConfirmText, delProj.pr.name);
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
                    {/* textTransform: 'none' WAJIB di sini. `.field label` memaksa
                        HURUF BESAR, jadi tanpa ini nama "Rumah Singgah" tampil
                        sebagai "RUMAH SINGGAH" — orang mengetik apa yang dia
                        lihat, lalu bingung kenapa tombolnya tetap mati. */}
                    <label>
                      Ketik{' '}
                      <b style={{ color: 'var(--red)', textTransform: 'none', letterSpacing: 0 }}>
                        {delProj.pr.name}
                      </b>{' '}
                      untuk konfirmasi
                    </label>
                    <input value={delConfirmText} onChange={(e) => setDelConfirmText(e.target.value)}
                      placeholder={delProj.pr.name} autoFocus />
                    <div className="hint">
                      {delConfirmText.trim() === ''
                        ? 'Huruf besar-kecil tidak masalah.'
                        : (canDelete
                          ? '✓ Cocok — tombol Hapus total sudah aktif.'
                          : 'Belum cocok dengan nama project.')}
                    </div>
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

      {emailUser && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !emailBusy && setEmailUser(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  Ubah email login
                </div>
                <div className="modal-title">{emailUser.full_name || emailUser.email}</div>
                <div className="modal-sub">sekarang: {emailUser.email}</div>
              </div>
              <button className="btn ghost modal-close" disabled={emailBusy} onClick={() => setEmailUser(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Email baru</label>
                <input
                  type="email"
                  value={emailValue}
                  disabled={emailBusy}
                  autoComplete="off"
                  placeholder="nama@kahficorp.co.id"
                  onChange={(e) => setEmailValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !emailBusy && doUbahEmail()}
                />
                <div className="hint">
                  Password, peran, tim, dan seluruh riwayatnya tidak berubah — yang pindah cuma alamat loginnya.
                </div>
              </div>

              <div
                style={{
                  background: 'color-mix(in srgb, var(--amber) 10%, transparent)',
                  borderLeft: '2px solid var(--amber)',
                  borderRadius: '0 6px 6px 0',
                  padding: '9px 12px',
                  fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-2)',
                }}
              >
                <b style={{ color: 'var(--text)' }}>Alamat lama langsung tidak bisa dipakai login.</b> Kabari orangnya
                dulu sebelum disimpan{emailUser.id === selfId ? ' — dan ini akun Anda sendiri, jadi login berikutnya pakai alamat yang baru' : ''}.
              </div>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={emailBusy} onClick={() => setEmailUser(null)}>Batal</button>
                <button
                  className="btn primary"
                  disabled={emailBusy || !emailValue.trim() || emailValue.trim().toLowerCase() === (emailUser.email || '').toLowerCase()}
                  onClick={doUbahEmail}
                >
                  {emailBusy ? 'Menyimpan…' : 'Simpan email'}
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
