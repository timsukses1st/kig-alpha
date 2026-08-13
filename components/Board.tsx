'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DIVISIONS, STATUSES,
  PLATFORMS, canEditRow, initials, platformDef, statusDef, tagColor, targetableStatuses,
  type Account, type ContentCategory, type ContentRow, type ContentStatus, type Division, type Profile, type TeamMember, type ContentNote, type ContentRequest, type Project,
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
  category_id: '',
  status: 'drafting' as ContentStatus,
  pic_copywriter: '',
  pic_creative: '',
  pic_distribution: '',
  pic_ads: '',
  deadline: '',
  publish_date: '',
  platform: '',
  caption: '',
  hashtags: '',
  asset_url: '',
  post_url: '',
  visual_hook: '',
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

type ColKey = 'akun' | 'platform' | 'kategori' | 'status' | 'caption' | 'drive' | 'post' | 'ads' | 'pic' | 'tayang';

const TITLE_COL_W = 300;
/** Di HP kolom Konten menempel (sticky) — kalau tetap 300px, layar 560px habis
 *  dipakai kolom itu saja dan kolom lain cuma kelihatan sepotong. */
const TITLE_COL_W_MOBILE = 150;
/** Lebar kolom checkbox. Dipakai juga sebagai offset sticky di globals.css. */
const CHECK_COL_W = 38;

const COLUMNS: { key: ColKey; label: string; width: number }[] = [
  { key: 'akun', label: 'Akun', width: 175 },
  { key: 'platform', label: 'Platform', width: 140 },
  { key: 'kategori', label: 'Kategori', width: 155 },
  { key: 'status', label: 'Status', width: 160 },
  { key: 'caption', label: 'Caption', width: 100 },
  { key: 'drive', label: 'Link Drive', width: 210 },
  { key: 'post', label: 'Link Post', width: 230 },
  { key: 'ads', label: 'Kode Ads', width: 170 },
  { key: 'pic', label: 'PIC', width: 130 },
  { key: 'tayang', label: 'Tayang', width: 105 },
];

/**
 * Empat peran PIC dalam satu tempat.
 *
 * Copywriter & Content sama-sama tim Creative — bedanya cuma tugas: copywriter
 * menyusun briefnya, content yang menggarap materinya. Karena satu divisi,
 * warnanya sama; yang membedakan bentuknya (garis vs terisi).
 */
const divColor = (k: Division) => DIVISIONS.find((d) => d.key === k)?.color || 'var(--text-3)';

const PIC_SLOTS: {
  field: 'pic_copywriter' | 'pic_creative' | 'pic_distribution' | 'pic_ads';
  label: string;
  team: 'creative' | 'distribution' | 'ads';
  desc: string;
  solid: boolean;
}[] = [
  { field: 'pic_copywriter', label: 'PIC Copywriter', team: 'creative', desc: 'menyusun brief', solid: false },
  { field: 'pic_creative', label: 'PIC Content', team: 'creative', desc: 'menggarap materinya', solid: true },
  { field: 'pic_distribution', label: 'PIC Distribution', team: 'distribution', desc: 'menayangkan', solid: true },
  { field: 'pic_ads', label: 'PIC Ads', team: 'ads', desc: 'mengiklankan', solid: true },
];

/** Sel teks: satu baris, dipotong dengan elipsis — jangan pernah pecah per huruf. */
const CLIP: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Judul disimpan dengan penanda **bold** — dibersihkan untuk tampilan tabel. */
const plainTitle = (s: string) => (s || '').replace(/\*\*/g, '').split('\n')[0].trim();

/**
 * Tanggal dalam zona waktu pengguna. Jangan pakai toISOString() untuk ini —
 * dia mengubah ke UTC, sehingga konten yang dibuat lewat tengah malam WIB
 * terbaca sebagai hari sebelumnya.
 */
const dayStr = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};

/**
 * Sel yang bisa diketik langsung. Uncontrolled + key mengikuti nilai server:
 * begitu data server berubah, sel di-remount dengan nilai terbaru — sekaligus
 * mengembalikan nilai lama otomatis kalau simpan gagal.
 */
function CellInput({
  value, disabled, placeholder, onSave, mono,
}: {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onSave: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <input
      key={value}
      defaultValue={value}
      disabled={disabled}
      placeholder={disabled ? '—' : placeholder}
      title={disabled ? 'Tahap ini dikelola tim lain' : undefined}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== value.trim()) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { e.currentTarget.value = value; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%',
        minWidth: 0,
        background: disabled ? 'transparent' : 'var(--raised)',
        border: '1px solid ' + (disabled ? 'transparent' : 'var(--border)'),
        borderRadius: 7,
        padding: '5px 8px',
        font: 'inherit',
        fontSize: 12.5,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
        color: 'var(--text)',
        outline: 'none',
      }}
    />
  );
}

function CtxItem({ label, icon, onPick, danger, disabled }: {
  label: string;
  icon: React.ReactNode;
  onPick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hv, setHv] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHv(true)}
      onMouseLeave={() => setHv(false)}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        textAlign: 'left', border: 'none', borderRadius: 7,
        padding: '8px 10px', font: 'inherit', fontSize: 13,
        background: hv && !disabled ? 'rgba(255,255,255,.06)' : 'transparent',
        color: disabled ? 'var(--text-3)' : danger ? 'var(--red)' : 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .12s',
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, opacity: 0.8 }}>{icon}</span>
      {label}
    </button>
  );
}

function SuggestChip({ label, color, onPick, active }: {
  label: string; color: string; onPick: () => void; active?: boolean;
}) {
  const [hv, setHv] = useState(false);
  const lit = active || hv;
  return (
    <button
      type="button"
      onMouseEnter={() => setHv(true)}
      onMouseLeave={() => setHv(false)}
      onClick={onPick}
      title={active ? 'Klik lagi untuk membatalkan' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: '1px solid ' + (lit ? color : 'var(--border)'),
        background: active ? color + '2e' : hv ? color + '1f' : 'transparent',
        color: lit ? color : 'var(--text)',
        font: 'inherit', fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s, color .12s',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 }} />
      {label}
      {active && <span style={{ fontSize: 11, opacity: 0.8 }}>✕</span>}
    </button>
  );
}

function PicCell({ row, members, disabled, onSave }: {
  row: ContentRow;
  members: TeamMember[];
  disabled: boolean;
  onSave: (field: string, val: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name || null;
  const optionsFor = (team: string) => members.filter((m) => m.team === team || m.team === 'delta');
  const filled = PIC_SLOTS.map((sl) => ({ sl, name: nameOf(row[sl.field]) })).filter((x) => x.name);

  const openPanel = () => {
    const r = boxRef.current ? boxRef.current.getBoundingClientRect() : null;
    if (r) {
      setPos({
        top: Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 250)),
        left: Math.min(r.left, Math.max(8, window.innerWidth - 268)),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef}>
      <button
        type="button"
        onClick={openPanel}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={filled.length
          ? filled.map((x) => `${x.sl.label} (${x.sl.desc}): ${x.name}`).join('\n')
          : 'Belum ada PIC — klik untuk menunjuk'}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 4,
          background: hover ? 'var(--raised)' : 'transparent',
          border: '1px solid ' + (hover ? 'var(--border)' : 'transparent'),
          borderRadius: 8, padding: '4px 8px',
          font: 'inherit', fontSize: 12.5, textAlign: 'left',
          color: 'var(--text-3)', cursor: 'pointer',
          transition: 'background .15s, border-color .15s',
        }}
      >
        {filled.length === 0 ? (
          <span style={{ flex: 1 }}>—</span>
        ) : (
          <span style={{ flex: 1, display: 'flex', gap: 3 }}>
            {filled.map((x) => {
              const col = divColor(x.sl.team as Division);
              return (
                <span
                  key={x.sl.field}
                  style={{
                    width: 21, height: 21, borderRadius: 999,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: x.sl.solid ? `color-mix(in srgb, ${col} 22%, transparent)` : 'transparent',
                    border: '1px solid ' + col,
                    color: col, fontSize: 10.5, fontWeight: 700,
                  }}
                >
                  {initials(x.name)}
                </span>
              );
            })}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ opacity: hover ? 0.7 : 0.3, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 64 }}
            onMouseDown={() => setOpen(false)}
            onTouchStart={() => setOpen(false)}
          />
          <div
            style={{
              position: 'fixed', top: pos.top, left: pos.left, width: 260, zIndex: 65,
              background: 'var(--raised)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 12px',
              boxShadow: '0 14px 36px rgba(0,0,0,.55)',
            }}
          >
            {PIC_SLOTS.map((sl, i) => {
              const col = divColor(sl.team as Division);
              const newGroup = i === 0 || PIC_SLOTS[i - 1].team !== sl.team;
              return (
                <div key={sl.field} style={{ marginBottom: 9, marginTop: newGroup && i > 0 ? 12 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: 999,
                      background: sl.solid ? col : 'transparent',
                      border: '1px solid ' + col,
                      flexShrink: 0,
                    }} />
                    <span className="modal-col-label" style={{ margin: 0 }}>{sl.label}</span>
                    <span className="sub" style={{ fontSize: 11 }}>· {sl.desc}</span>
                  </div>
                  <select
                    value={row[sl.field] || ''}
                    disabled={disabled}
                    onChange={(e) => onSave(sl.field, e.target.value || null)}
                    style={{ width: '100%' }}
                  >
                    <option value="">—</option>
                    {optionsFor(sl.team).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
            {disabled && (
              <div className="hint" style={{ margin: 0 }}>Tahap ini dikelola tim lain.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Board({ profile, accounts, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [division, setDivision] = useState<Division>('semua');
  const [range, setRange] = useState<Range>('all');
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [pickDate, setPickDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContentRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<ContentNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [openNoteField, setOpenNoteField] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // ---- tampilan tabel ----
  const [search, setSearch] = useState('');
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<ColKey[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [searchFocus, setSearchFocus] = useState(false);
  const [searchPos, setSearchPos] = useState<{ top: number; left: number } | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  /** Breakpoint ini WAJIB sama dengan @media (max-width: 820px) di globals.css. */
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const titleColW = isMobile ? TITLE_COL_W_MOBILE : TITLE_COL_W;
  // ---- duplikat ke platform lain ----
  const [selected, setSelected] = useState<string[]>([]);
  const [dupRows, setDupRows] = useState<ContentRow[] | null>(null);
  const [dupTargets, setDupTargets] = useState<string[]>([]);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupErr, setDupErr] = useState('');
  // ---- menu klik-kanan / tekan-tahan pada baris ----
  const [ctxMenu, setCtxMenu] = useState<{ row: ContentRow; x: number; y: number } | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  // Project konten yang sudah ada dikunci. Memindahkannya harus disengaja
  // (klik tombol dulu), supaya tidak bisa berpindah klien karena salah klik.
  const [movingProject, setMovingProject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, m, rq, cc] = await Promise.all([
      // Urut created_at, BUKAN updated_at: kalau pakai updated_at, baris yang
      // baru diketik langsung melompat ke atas dan bikin kacau saat input massal.
      supabase.from('contents').select('*').order('created_at', { ascending: false }),
      supabase.from('team_members').select('*').eq('is_active', true).order('name'),
      supabase.from('content_requests').select('*').eq('status', 'pending').order('requested_date', { ascending: true }),
      supabase.from('content_categories').select('*').order('name'),
    ]);
    setRows((c.data as ContentRow[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setRequests((rq.data as ContentRequest[]) || []);
    setCategories((cc.data as ContentCategory[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Kategori milik project lain tidak berlaku — reset filter tiap ganti project,
  // supaya papan tidak tampak kosong karena filter yang tertinggal.

  const inRange = useCallback((r: ContentRow) => {
    // Dasar penyaringan = TANGGAL TAYANG yang diisi manual (publish_date).
    // Nilainya sudah berupa 'YYYY-MM-DD', jadi cukup dibandingkan apa adanya —
    // tidak perlu konversi waktu yang rawan geser sehari.
    const d = r.publish_date;
    if (pickDate) return d === pickDate;
    if (range === 'all') return true;
    // Belum diisi tanggal tayangnya → tidak masuk rentang mana pun.
    if (!d) return false;
    const today = dayStr(new Date());
    if (range === 'today') return d === today;
    if (range === 'yesterday') {
      const y = new Date(); y.setDate(y.getDate() - 1);
      return d === dayStr(y);
    }
    // 7 Hari = seminggu terakhir sampai hari ini (belum termasuk jadwal ke depan).
    const s7 = new Date(); s7.setDate(s7.getDate() - 6);
    return d >= dayStr(s7) && d <= today;
  }, [range, pickDate]);

  const activeDiv = DIVISIONS.find((d) => d.key === division)!;

  const accHandle = useCallback(
    (id: string | null) => accounts.find((a) => a.id === id)?.handle || '',
    [accounts]
  );

  /**
   * Membaca isi kotak cari jadi beberapa kelompok.
   *
   * Aturannya mengikuti kebiasaan orang, bukan logika mentah:
   *   - dalam satu kelompok  = ATAU  → "instagram tiktok" = IG atau TikTok
   *   - antar kelompok       = DAN   → "tiktok berita"    = TikTok dan Berita
   *
   * Sisanya (bukan nama platform/status/kategori) dicari sebagai teks bebas
   * di judul, akun, dan kode ads.
   */
  const query = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) return null;
    let rest = ' ' + q + ' ';
    const pf: string[] = [];
    const st: string[] = [];
    const ct: string[] = [];

    const known = [
      ...PLATFORMS.map((p) => ({ label: p.label, bucket: pf, val: p.key })),
      ...STATUSES.map((x) => ({ label: x.label, bucket: st, val: x.key as string })),
      ...categories.map((c) => ({ label: c.name, bucket: ct, val: c.id })),
    ].sort((a, b) => b.label.length - a.label.length); // frasa terpanjang diambil dulu

    for (const item of known) {
      const needle = ' ' + item.label.toLowerCase() + ' ';
      while (rest.includes(needle)) {
        rest = rest.replace(needle, ' ');
        item.bucket.push(item.val);
      }
    }

    return { pf, st, ct, free: rest.trim().split(/\s+/).filter(Boolean) };
  }, [search, categories]);

  // Basis SEBELUM filter divisi — dipakai untuk menghitung angka di tiap tab.
  // Kalau dihitung dari hasil akhir, membuka tab Creative bikin semua tab lain
  // ikut menampilkan angka yang sama.
  const baseRows = useMemo(() => {
    return rows.filter((r) => {
      if (projectFilter !== 'all' && r.project_id !== projectFilter) return false;
      if (!inRange(r)) return false;
      // "Perlu ditindak" = aset belum ada, atau sudah tayang tapi link post kosong
      if (onlyTodo && !(!r.asset_url || ((r.status === 'published' || r.status === 'diiklankan') && !r.post_url))) {
        return false;
      }
      if (query) {
        if (query.pf.length && !query.pf.includes(r.platform || '')) return false;
        if (query.st.length && !query.st.includes(r.status)) return false;
        if (query.ct.length && !query.ct.includes(r.category_id || '')) return false;
        if (query.free.length) {
          const hay = [plainTitle(r.title), accHandle(r.account_id), r.ads_code || '']
            .join(' ').toLowerCase();
          if (!query.free.every((t) => hay.includes(t))) return false;
        }
      }
      return true;
    });
  }, [rows, projectFilter, inRange, onlyTodo, query, accHandle]);

  // Tab divisi dulu dikerjakan oleh kolom kanban — sekarang jadi filter baris.
  const filtered = useMemo(
    () => baseRows.filter((r) => activeDiv.statuses.includes(r.status)),
    [baseRows, activeDiv]
  );

  const visibleRequests = useMemo(
    () => requests.filter((rq) => projectFilter === 'all' || rq.project_id === projectFilter),
    [requests, projectFilter]
  );

  const divCounts = useMemo(() => {
    const m: Record<Division, number> = { semua: baseRows.length, creative: 0, distribution: 0, ads: 0 };
    for (const r of baseRows) {
      const t = statusDef(r.status).ownerTeam;
      if (t === 'creative') m.creative++;
      else if (t === 'distribution') m.distribution++;
      else if (t === 'ads') m.ads++;
    }
    return m;
  }, [baseRows]);

  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.handle || 'Akun belum ditentukan';
  const accountsOfProject = (projId: string) =>
    projId ? accounts.filter((a) => a.project_id === projId || !a.project_id) : accounts;
  const membersOf = (team: 'creative' | 'distribution' | 'ads') =>
    members.filter((m) => m.team === team || m.team === 'delta');
  const canCreate =
    !!profile &&
    (profile.role === 'superadmin' || profile.role === 'manager' ||
      profile.team === 'creative' || profile.team === 'delta');

  const openCreate = () => {
    setEditing(null);
    setNotes([]);
    setNewNote('');
    setOpenNoteField(null);
    setCopied(false);
    setMovingProject(false);
    // Ikut project yang aktif di sidebar. Kalau sidebar 'Semua project',
    // JANGAN diisi otomatis — dulu jatuh ke projects[0] (project pertama
    // menurut abjad), yang diam-diam bisa memasukkan konten ke klien salah.
    setForm({ ...EMPTY_FORM, project_id: projectFilter !== 'all' ? projectFilter : '' });
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
    setCopied(false);
    setMovingProject(false);
    loadNotes(row.id);
    setForm({
      title: row.title,
      project_id: row.project_id || '',
      account_id: row.account_id || '',
      category_id: row.category_id || '',
      status: row.status,
      pic_copywriter: row.pic_copywriter || '',
      pic_creative: row.pic_creative || '',
      pic_distribution: row.pic_distribution || '',
      pic_ads: row.pic_ads || '',
      deadline: row.deadline || '',
      publish_date: row.publish_date || '',
      caption: row.caption || '',
      platform: row.platform || '',
      hashtags: row.hashtags || '',
      asset_url: row.asset_url || '',
      post_url: row.post_url || '',
      visual_hook: row.visual_hook || '',
      potensi_fyp: row.potensi_fyp,
    });
    setError('');
    setModalOpen(true);
  };

  const readOnly = editing ? !canEditRow(profile, editing.status) : false;

  // ---- simpan satu sel di tabel ----
  const flashToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2600);
  };

  const patchRow = async (row: ContentRow, patch: Record<string, unknown>, label: string) => {
    const { error: err } = await supabase.from('contents').update(patch).eq('id', row.id);
    flashToast(err ? `Gagal menyimpan ${label} — cek wewenang tim kamu untuk tahap ini.` : `${label} tersimpan.`);
    load();
  };

  const moveStatusInline = async (row: ContentRow, target: ContentStatus) => {
    if (target === row.status) return;
    if (target === 'terjadwal' && !row.publish_date) {
      flashToast('Isi Tanggal tayang dulu sebelum menjadwalkan.');
      load();
      return;
    }
    await patchRow(row, { status: target }, 'Status');
  };

  const copyRowCaption = async (row: ContentRow) => {
    const text = [(row.caption || '').trim(), (row.hashtags || '').trim()].filter(Boolean).join('\n\n');
    if (!text) { flashToast('Caption & hashtag masih kosong.'); return; }
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopiedRow(row.id);
      window.setTimeout(() => setCopiedRow((c) => (c === row.id ? null : c)), 1600);
    } else {
      flashToast('Browser menolak akses clipboard — buka kartunya lalu salin manual.');
    }
  };

  // Menu konteks ditutup oleh klik di luar, scroll, resize, atau Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Penutupan lewat klik ditangani oleh lapisan backdrop, BUKAN listener
    // document: listener mousedown menutup menu sebelum event 'click' sempat
    // terpicu, sehingga tombolnya hilang dari DOM dan aksinya tidak pernah jalan.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const openCtx = (row: ContentRow, x: number, y: number) => {
    // Jaga supaya menu tidak terpotong tepi layar
    const w = 232;
    const h = 244;
    const left = Math.min(x, Math.max(8, window.innerWidth - w - 8));
    const top = Math.min(y, Math.max(8, window.innerHeight - h - 8));
    setCtxMenu({ row, x: left, y: top });
  };

  const startLongPress = (row: ContentRow, e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    const { clientX, clientY } = t;
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = setTimeout(() => openCtx(row, clientX, clientY), 500);
  };

  const cancelLongPress = () => {
    if (longPress.current) { clearTimeout(longPress.current); longPress.current = null; }
  };

  // Chip berlaku sebagai saklar: klik = tambah, klik lagi = hapus.
  const termActive = (term: string) => {
    const cur = ' ' + search.trim().toLowerCase().replace(/\s+/g, ' ') + ' ';
    return cur.includes(' ' + term.trim().toLowerCase() + ' ');
  };

  const toggleTerm = (term: string) => {
    const t = term.trim().toLowerCase();
    const cur = ' ' + search.trim().toLowerCase().replace(/\s+/g, ' ') + ' ';
    if (cur.includes(' ' + t + ' ')) {
      setSearch(cur.replace(' ' + t + ' ', ' ').trim());
    } else {
      setSearch((search.trim() + ' ' + t).trim());
    }
  };

  const newGroupId = () => {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch { /* lanjut ke cadangan */ }
    // Cadangan untuk browser/konteks tanpa crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const openDup = (rows_: ContentRow[]) => {
    if (!rows_.length) return;
    setDupErr('');
    setDupTargets([]);
    setDupRows(rows_);
  };

  const runDuplicate = async () => {
    if (!dupRows || !profile || dupTargets.length === 0) return;
    setDupBusy(true);
    setDupErr('');

    const payloads: Record<string, unknown>[] = [];
    const groupPatch: { id: string; gid: string }[] = [];
    let skipped = 0;

    for (const row of dupRows) {
      // Tiap konten asal punya kelompoknya sendiri; salinannya ikut kelompok itu.
      const gid = row.group_id || newGroupId();
      if (!row.group_id) groupPatch.push({ id: row.id, gid });

      for (const pf of dupTargets) {
        // Lewati kalau konten itu memang sudah ada di platform tersebut.
        if (row.platform === pf) { skipped++; continue; }
        payloads.push({
          title: row.title,
          project_id: row.project_id,
          account_id: row.account_id,
          category_id: row.category_id,
          status: row.status,
          publish_date: row.publish_date,
          caption: row.caption,
          hashtags: row.hashtags,
          visual_hook: row.visual_hook,
          asset_url: row.asset_url,
          pic_copywriter: row.pic_copywriter,
      pic_creative: row.pic_creative,
          pic_distribution: row.pic_distribution,
          pic_ads: row.pic_ads,
          potensi_fyp: row.potensi_fyp,
          platform: pf,
          group_id: gid,
          created_by: profile.id,
          // post_url & ads_code SENGAJA tidak disalin — keduanya khas per tayangan.
        });
      }
    }

    if (payloads.length === 0) {
      setDupBusy(false);
      setDupErr('Semua konten terpilih sudah ada di platform tersebut.');
      return;
    }

    const { error: insErr } = await supabase.from('contents').insert(payloads);
    if (insErr) {
      setDupBusy(false);
      setDupErr('Gagal menduplikat — cek wewenang tim kamu untuk tahap ini.');
      return;
    }
    for (const g of groupPatch) {
      await supabase.from('contents').update({ group_id: g.gid }).eq('id', g.id);
    }

    setDupBusy(false);
    setDupRows(null);
    setSelected([]);
    flashToast(
      `${payloads.length} salinan dibuat${skipped ? ` · ${skipped} dilewati (sudah ada di platform itu)` : ''}.`
    );
    load();
  };

  const needsAction = (r: ContentRow) =>
    !r.asset_url || ((r.status === 'published' || r.status === 'diiklankan') && !r.post_url);

  const todoCount = useMemo(() => filtered.filter(needsAction).length, [filtered]);

  // Pilihan dibersihkan tiap kali daftar berubah, supaya tidak ada aksi
  // massal yang mengenai baris di luar layar.
  useEffect(() => { setSelected([]); }, [projectFilter, division, search, range, pickDate, onlyTodo]);

  const toggleSel = (id: string) =>
    setSelected((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const shownCols = COLUMNS.filter((c) => !hiddenCols.includes(c.key));
  // Dengan tableLayout 'fixed', lebar total harus dihitung sendiri supaya
  // scroll mendatarnya pas — tidak ada kolom yang terhimpit.
  const tableWidth = CHECK_COL_W + titleColW + shownCols.reduce((a, c) => a + c.width, 0);
  const toggleCol = (k: ColKey) =>
    setHiddenCols((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]));

  const catsForRow = (row: ContentRow) =>
    categories.filter((c) => c.project_id === row.project_id && (c.is_active || c.id === row.category_id));

  const th = (label: string, width?: number) => (
    <th
      key={label}
      style={{
        width, minWidth: width, maxWidth: width,
        position: 'sticky', top: 0, background: 'var(--raised)', zIndex: 2,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </th>
  );

  // ---- Caption + Hashtag siap salin -------------------------------------
  // Digabung otomatis: caption dulu, satu baris kosong, lalu hashtag.
  const combinedCaption = useMemo(() => {
    const cap = (form.caption || '').trim();
    const tags = (form.hashtags || '').trim();
    return [cap, tags].filter(Boolean).join('\n\n');
  }, [form.caption, form.hashtags]);

  const combinedRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { growRef(combinedRef.current); }, [combinedCaption, modalOpen]);

  const copyCombined = async () => {
    if (!combinedCaption) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(combinedCaption);
      ok = true;
    } catch {
      // Fallback untuk browser/konteks yang memblokir Clipboard API
      try {
        const ta = document.createElement('textarea');
        ta.value = combinedCaption;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      setError('Browser menolak akses clipboard. Blok teksnya lalu salin manual (Ctrl+C).');
    }
  };
  // ----------------------------------------------------------------------

  const save = async () => {
    if (!form.title.trim()) { setError('Hook / brief konten wajib diisi.'); return; }
    // Project wajib: konten tanpa project lolos tembok unit (can_see_project
    // meloloskan project_id NULL), jadi bisa terbaca lintas unit bisnis.
    if (!form.project_id) { setError('Pilih project dulu — konten tanpa project bisa terbaca lintas unit.'); return; }
    setSaving(true); setError('');
    const payload = {
      title: form.title.trim(),
      project_id: form.project_id || null,
      account_id: form.account_id || null,
      category_id: form.category_id || null,
      pic_copywriter: form.pic_copywriter || null,
      pic_creative: form.pic_creative || null,
      pic_distribution: form.pic_distribution || null,
      pic_ads: form.pic_ads || null,
      deadline: form.deadline || null,
      publish_date: form.publish_date || null,
      caption: form.caption.trim() || null,
      platform: form.platform || null,
      hashtags: form.hashtags.trim() || null,
      asset_url: form.asset_url.trim() || null,
      post_url: form.post_url.trim() || null,
      visual_hook: form.visual_hook.trim() || null,
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

  const canAcc = profile?.role === 'superadmin' || profile?.role === 'manager';

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
    // Masalah yang sama seperti di openCreate: dulu jatuh ke projects[0] kalau
    // sidebar 'Semua project' — request bisa nyasar ke klien lain diam-diam.
    if (projectFilter === 'all') {
      setReqError('Pilih project di sidebar dulu — request harus jelas untuk project mana.');
      return;
    }
    setReqBusy('submit');
    setReqError('');
    const { error: err } = await supabase.from('content_requests').insert({
      title: reqForm.title.trim(),
      project_id: projectFilter,
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
        status: 'drafting' as ContentStatus,
        publish_date: rq.requested_date,
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (!ins.error && ins.data) {
      const newId = (ins.data as { id: string }).id;
      // Asal-usul request dicatat sebagai Catatan umum.
      // (Sebelumnya ditulis ke production_note — field itu sudah tidak
      // ditampilkan lagi, jadi infonya dipindah ke sini agar tetap terbaca.)
      const originNote = ['Request oleh ' + (rq.requester_name || 'PM'), rq.note]
        .filter(Boolean)
        .join(' · ');
      if (originNote) {
        await supabase.from('content_notes').insert({
          content_id: newId,
          author_id: profile.id,
          author_name: profile.full_name || profile.email,
          field: 'umum',
          note: originNote,
        });
      }
      await supabase.from('content_requests')
        .update({ status: 'diangkat', created_content_id: newId })
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

  // ---- Hapus konten lewat ikon di kartu Board ----
  // Konfirmasi pakai modal in-app, bukan window.confirm (diblokir di environment ini).
  const [delRow, setDelRow] = useState<ContentRow | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState('');

  const confirmDeleteRow = async () => {
    if (!delRow) return;
    setDelBusy(true);
    setDelErr('');
    const { error: err } = await supabase.from('contents').delete().eq('id', delRow.id);
    setDelBusy(false);
    if (err) { setDelErr('Gagal menghapus. Hanya superadmin/manager yang bisa menghapus.'); return; }
    setDelRow(null);
    load();
  };

  const canDelete = profile?.role === 'superadmin' || profile?.role === 'manager';
  const nextStep = editing ? nextActionFor(editing.status) : null;
  const prevIdx = editing ? ORDER.indexOf(editing.status) : -1;
  const prevStep = editing && prevIdx > 0 ? ORDER[prevIdx - 1] : null;
  const editingDef = statusDef(form.status);

  // Konten BARU + sidebar sudah menunjuk satu project → project sudah pasti,
  // jadi tidak perlu ditanya ulang; cukup ditampilkan sebagai penanda.
  // Kalau sidebar 'Semua project' atau sedang mengedit konten lama, dropdown
  // tetap muncul (perlu untuk memilih / memindahkan project).
  const lockedProject = !editing && projectFilter !== 'all'
    ? (projects.find((p) => p.id === projectFilter) || null)
    : null;

  // Konten yang SUDAH ADA juga dikunci project-nya. Dropdown baru muncul
  // setelah menekan "Pindahkan ke project lain" — supaya konten tidak bisa
  // berpindah klien hanya karena dropdown tersenggol.
  // Bahan saran pencarian: kategori milik project yang sedang dipilih.
  const boardCategories = projectFilter === 'all'
    ? []
    : categories.filter((c) => c.project_id === projectFilter && c.is_active);

  // Kategori untuk DROPDOWN di modal — ikut project konten itu sendiri.
  // Kategori nonaktif tetap ditampilkan bila konten ini masih memakainya,
  // supaya tidak diam-diam hilang saat konten disimpan ulang.
  const modalCategories = categories.filter(
    (c) => c.project_id === form.project_id && (c.is_active || c.id === form.category_id)
  );

  const currentProject = projects.find((p) => p.id === form.project_id) || null;
  const projectLocked = !!lockedProject || (!!editing && !movingProject);
  const shownProject = lockedProject || currentProject;

  const NOTE_FIELD_LABELS: Record<string, string> = {
    title: 'Hook / Brief',
    visual_hook: 'Visual Hook',
    production_note: 'Catatan produksi (arsip)',
    caption: 'Caption',
    hashtags: 'Hashtag',
    account: 'Akun',
    category_id: 'Category Content',
    status: 'Status',
    deadline: 'Deadline',
    publish_date: 'Tanggal tayang',
    pic: 'PIC',
    platform: 'Platform',
    asset_url: 'Link Drive',
    post_url: 'Link Post',
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
          <button className="btn" onClick={() => setColMenu(!colMenu)}>
            ☰ Kolom{hiddenCols.length ? ` (${hiddenCols.length})` : ''}
          </button>
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
        {/* Nama divisi dihapus dari sini — sudah terbaca dari tab di atas.
            Ruangnya dipakai untuk filter yang benar-benar dipakai sehari-hari. */}
        <div ref={searchBoxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 280, maxWidth: '100%' }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"
            style={{ position: 'absolute', left: 11, opacity: 0.4, pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              const r = searchBoxRef.current ? searchBoxRef.current.getBoundingClientRect() : null;
              if (r) setSearchPos({ top: r.bottom + 6, left: Math.min(r.left, Math.max(8, window.innerWidth - 308)) });
              setSearchFocus(true);
            }}
            onBlur={() => setSearchFocus(false)}
            placeholder="Cari apa saja — judul, akun, platform, kategori…"
            style={{
              width: '100%',
              padding: '7px 30px 7px 33px',
              background: 'var(--raised)',
              border: '1px solid ' + (searchFocus ? 'var(--accent)' : 'var(--border)'),
              borderRadius: 999,
              color: 'var(--text)',
              font: 'inherit',
              fontSize: 13,
              outline: 'none',
              transition: 'border-color .15s',
            }}
          />
          {searchFocus && searchPos && (
            <div
              style={{
                position: 'fixed',
                top: searchPos.top,
                left: searchPos.left,
                width: 'min(300px, calc(100vw - 24px))',
                maxHeight: 300,
                overflowY: 'auto',
                zIndex: 60,
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 12px',
                boxShadow: '0 14px 36px rgba(0,0,0,.55)',
              }}
              // preventDefault supaya kotak cari tidak kehilangan fokus saat diklik
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="modal-col-label" style={{ marginBottom: 6 }}>Platform</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {PLATFORMS.map((pf) => (
                  <SuggestChip key={pf.key} label={pf.label} color={pf.color}
                    active={termActive(pf.label)} onPick={() => toggleTerm(pf.label)} />
                ))}
              </div>

              {boardCategories.length > 0 && (
                <>
                  <div className="modal-col-label" style={{ marginBottom: 6 }}>Kategori</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {boardCategories.map((c) => (
                      <SuggestChip key={c.id} label={c.name} color={tagColor(c.name)}
                        active={termActive(c.name)} onPick={() => toggleTerm(c.name)} />
                    ))}
                  </div>
                </>
              )}

              <div className="modal-col-label" style={{ marginBottom: 6 }}>Status</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STATUSES.map((st) => (
                  <SuggestChip key={st.key} label={st.label} color={st.color}
                    active={termActive(st.label)} onPick={() => toggleTerm(st.label)} />
                ))}
              </div>

              <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                Pilih beberapa platform sekaligus untuk melihat semuanya (<b>Instagram + TikTok</b>).
                Beda jenis akan disaring bersamaan — <b>TikTok + Berita</b> = konten TikTok yang kategorinya Berita.
              </div>
            </div>
          )}
          {search && (
            <button
              type="button"
              title="Hapus pencarian"
              onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, padding: 0,
                background: 'transparent', border: 'none', borderRadius: 999,
                color: 'var(--text-3)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
              }}
            >✕</button>
          )}
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setOnlyTodo(!onlyTodo)}
          title="Tampilkan hanya konten yang belum ada link drive, atau sudah tayang tapi link post-nya kosong"
          style={{
            whiteSpace: 'nowrap',
            borderColor: onlyTodo ? 'var(--amber)' : undefined,
            color: onlyTodo ? 'var(--amber)' : undefined,
            background: onlyTodo ? 'rgba(245,158,11,.1)' : undefined,
            fontWeight: onlyTodo ? 600 : undefined,
          }}
        >
          ⚑ Perlu ditindak{todoCount > 0 ? ` (${todoCount})` : ''}
        </button>

        <div className="range-tabs">
          {([['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['week', '7 Hari'], ['all', 'Semua']] as [Range, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`range-tab ${range === k ? 'active' : ''}`}
              disabled={!!pickDate}
              title="Berdasarkan Tanggal tayang"
              onClick={() => setRange(k)}
            >{label}</button>
          ))}
        </div>
        <div className="date-pick">
          <input
            type="date"
            value={pickDate}
            onChange={(e) => setPickDate(e.target.value)}
            title="Pilih tanggal tayang tertentu"
          />
          {pickDate && <button className="date-clear" onClick={() => setPickDate('')} title="Hapus filter tanggal">✕</button>}
        </div>
      </div>

      {loading ? (
        <p className="empty">Memuat…</p>
      ) : (
        <div className="content-area" style={{ paddingTop: 4 }}>
          {colMenu && (
            <div
              style={{
                display: 'flex', flexWrap: 'wrap', gap: 12,
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '12px 14px', marginBottom: 12,
              }}
            >
              {COLUMNS.map((c) => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!hiddenCols.includes(c.key)} onChange={() => toggleCol(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}

          {visibleRequests.length > 0 && (
            <div
              style={{
                background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 12,
              }}
            >
              <div className="modal-col-label" style={{ marginBottom: 8 }}>
                Request dari Project Manager ({visibleRequests.length})
              </div>
              {visibleRequests.map((rq) => (
                <div
                  key={rq.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 0', borderTop: '1px solid var(--border)',
                  }}
                >
                  <span className="flag-dot" style={{ background: 'var(--req)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rq.title}
                    </div>
                    <div className="sub" style={{ fontSize: 12 }}>
                      {accName(rq.account_id)}
                      {rq.requester_name ? ' · oleh ' + rq.requester_name : ''}
                      {rq.requested_date ? ' · butuh ' + fmtDate(rq.requested_date) : ''}
                      {rq.note ? ' · ' + rq.note : ''}
                    </div>
                  </div>
                  {canLift && (
                    <button className="btn" disabled={reqBusy === rq.id} onClick={() => liftRequest(rq)}>
                      {reqBusy === rq.id ? 'Memproses…' : '↑ Angkat'}
                    </button>
                  )}
                  {canAcc && (
                    <button className="btn ghost danger-text" disabled={reqBusy === rq.id} onClick={() => rejectRequest(rq)}>
                      Tolak
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="table-wrap" style={{ maxHeight: '68vh', overflow: 'auto' }}>
            <table style={{ tableLayout: 'fixed', width: tableWidth, minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={{
                    width: CHECK_COL_W, minWidth: CHECK_COL_W, maxWidth: CHECK_COL_W,
                    position: 'sticky', top: 0, background: 'var(--raised)', zIndex: 2,
                  }}>
                    <input
                      type="checkbox"
                      title="Pilih semua yang sedang tampil"
                      checked={filtered.length > 0 && selected.length === filtered.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.length > 0 && selected.length < filtered.length;
                      }}
                      onChange={(e) => setSelected(e.target.checked ? filtered.map((r) => r.id) : [])}
                    />
                  </th>
                  {th('Konten', titleColW)}
                  {shownCols.map((c) => th(c.label, c.width))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const editable = canEditRow(profile, row.status);
                  const def = statusDef(row.status);
                  const targets = targetableStatuses(profile, row.status);
                  const rowCat = row.category_id
                    ? (categories.find((c) => c.id === row.category_id) || null)
                    : null;
                  return (
                    <tr
                      key={row.id}
                      // Belum ada link drive → seluruh barisnya diberi semburat amber,
                      // sama seperti penanda di kartu papan dulu.
                      style={row.asset_url ? undefined : {
                        backgroundImage: 'linear-gradient(rgba(245,158,11,.07), rgba(245,158,11,.07))',
                      }}
                      onContextMenu={(e) => { e.preventDefault(); openCtx(row, e.clientX, e.clientY); }}
                      onTouchStart={(e) => startLongPress(row, e)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                    >
                      <td style={{
                        width: CHECK_COL_W,
                        boxShadow: row.asset_url ? undefined : 'inset 3px 0 0 var(--amber)',
                      }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(row.id)}
                          onChange={() => toggleSel(row.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td style={{ width: titleColW, maxWidth: titleColW }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span
                            className="flag-dot"
                            title={row.asset_url ? 'Aset siap' : 'Perlu link drive'}
                            style={{ background: row.asset_url ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }}
                          />
                          <button
                            type="button"
                            onClick={() => { if (!ctxMenu) openEdit(row); }}
                            title="Buka detail konten — klik kanan untuk aksi lain"
                            style={{
                              flex: 1, minWidth: 0, textAlign: 'left',
                              background: 'none', border: 'none', padding: 0,
                              font: 'inherit', fontSize: 13, fontWeight: 600,
                              color: 'var(--text)', cursor: 'pointer',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            {plainTitle(row.title) || '(tanpa judul)'}
                          </button>
                        </div>
                      </td>

                      {shownCols.map((c) => {
                        if (c.key === 'akun') {
                          const h = accName(row.account_id);
                          // Dulu pakai className="sub" — 11,5px dengan warna --text-3
                          // yang paling pudar. Di layar terang hampir tidak terbaca,
                          // padahal nama akun ini yang paling sering dicari mata.
                          return (
                            <td
                              key={c.key}
                              style={{
                                ...CLIP,
                                fontFamily: 'var(--mono)',
                                fontSize: 12.5,
                                fontWeight: 600,
                                letterSpacing: '.01em',
                                color: row.account_id ? 'var(--text-2)' : 'var(--text-3)',
                                fontStyle: row.account_id ? undefined : 'italic',
                              }}
                              title={h}
                            >
                              {h}
                            </td>
                          );
                        }

                        if (c.key === 'platform') {
                          const pf = platformDef(row.platform);
                          return (
                            <td key={c.key}>
                              <select
                                value={row.platform || ''}
                                disabled={!editable}
                                onChange={(e) => patchRow(row, { platform: e.target.value || null }, 'Platform')}
                                style={{
                                  width: '100%', minWidth: 0,
                                  color: pf ? pf.color : undefined,
                                  fontWeight: pf ? 600 : undefined,
                                }}
                              >
                                <option value="">— pilih —</option>
                                {PLATFORMS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                              </select>
                            </td>
                          );
                        }

                        if (c.key === 'kategori') {
                          const list = catsForRow(row);
                          return (
                            <td key={c.key}>
                              {list.length === 0 ? (
                                <span className="sub">—</span>
                              ) : (
                                <select
                                  value={row.category_id || ''}
                                  disabled={!editable}
                                  onChange={(e) => patchRow(row, { category_id: e.target.value || null }, 'Kategori')}
                                  style={{
                                    width: '100%',
                                    minWidth: 0,
                                    color: rowCat ? tagColor(rowCat.name) : undefined,
                                    fontWeight: rowCat ? 600 : undefined,
                                  }}
                                >
                                  <option value="">— tanpa kategori —</option>
                                  {list.map((x) => (
                                    <option key={x.id} value={x.id}>{x.name}{x.is_active ? '' : ' (nonaktif)'}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                          );
                        }

                        if (c.key === 'status') {
                          const canMove = targets.length > 1;
                          return (
                            <td key={c.key}>
                              <select
                                value={row.status}
                                disabled={!canMove}
                                title={canMove ? undefined : 'Tahap ini dikelola tim lain'}
                                onChange={(e) => moveStatusInline(row, e.target.value as ContentStatus)}
                                style={{ width: '100%', minWidth: 0, color: def.color, fontWeight: 600 }}
                              >
                                {STATUSES.filter((s) => targets.includes(s.key) || s.key === row.status).map((s) => (
                                  <option key={s.key} value={s.key}>{s.label}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        if (c.key === 'caption') {
                          const has = !!(row.caption || row.hashtags);
                          return (
                            <td key={c.key}>
                              <button
                                className="btn"
                                disabled={!has}
                                onClick={() => copyRowCaption(row)}
                                title={has ? 'Salin caption + hashtag' : 'Caption & hashtag masih kosong'}
                                style={{
                                  fontSize: 12, padding: '4px 10px',
                                  color: copiedRow === row.id ? 'var(--green)' : undefined,
                                  opacity: has ? 1 : 0.4,
                                }}
                              >
                                {copiedRow === row.id ? '✓ Tersalin' : 'Copy ⧉'}
                              </button>
                            </td>
                          );
                        }

                        if (c.key === 'drive' || c.key === 'post') {
                          const field = c.key === 'drive' ? 'asset_url' : 'post_url';
                          const val = (c.key === 'drive' ? row.asset_url : row.post_url) || '';
                          // Sudah tayang tapi link post belum diisi → tandai selnya,
                          // supaya jelas kenapa baris ini terhitung "perlu ditindak".
                          const lacking = c.key === 'post'
                            && !val
                            && (row.status === 'published' || row.status === 'diiklankan');
                          return (
                            <td key={c.key} style={lacking ? { boxShadow: 'inset 0 0 0 1px var(--amber)', borderRadius: 8 } : undefined}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CellInput
                                  value={val}
                                  disabled={!editable}
                                  placeholder={c.key === 'drive' ? 'link / nama file' : 'https://…'}
                                  onSave={(v) => patchRow(row, { [field]: v || null }, c.label)}
                                />
                                {isUrl(val) && (
                                  <a
                                    className="open-link"
                                    href={val.trim()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Buka di tab baru"
                                    style={{ flexShrink: 0 }}
                                  >↗</a>
                                )}
                              </div>
                            </td>
                          );
                        }

                        if (c.key === 'ads') {
                          return (
                            <td key={c.key}>
                              <CellInput
                                value={row.ads_code || ''}
                                disabled={!editable}
                                placeholder="kode ads"
                                mono
                                onSave={(v) => patchRow(row, { ads_code: v || null }, 'Kode Ads')}
                              />
                            </td>
                          );
                        }

                        if (c.key === 'pic') {
                          return (
                            <td key={c.key}>
                              <PicCell
                                row={row}
                                members={members}
                                disabled={!editable}
                                onSave={(field, val) => patchRow(row, { [field]: val }, 'PIC')}
                              />
                            </td>
                          );
                        }

                        return <td key={c.key} className="sub" style={CLIP}>{fmtDate(row.publish_date)}</td>;
                      })}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={shownCols.length + 2} className="empty">
                      Tidak ada konten yang cocok dengan filter ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected.length > 0 && (
            <div
              className="bulk-bar"
              style={{
                position: 'fixed',
                left: '50%',
                bottom: 26,
                transform: 'translateX(-50%)',
                zIndex: 70,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                boxShadow: '0 14px 36px rgba(0,0,0,.55)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {selected.length} dipilih
              </span>
              <button
                className="btn primary"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => openDup(rows.filter((r) => selected.includes(r.id)))}
              >
                ⧉ <span className="bulk-long">Duplikat ke platform lain</span>
                <span className="bulk-short">Duplikat</span>
              </button>
              <button
                className="btn ghost"
                title="Batalkan pilihan"
                onClick={() => setSelected([])}
              >✕</button>
            </div>
          )}

          <p className="cal-legend">
            Ketik langsung di kolomnya — tersimpan otomatis saat pindah kolom atau tekan Enter, Esc untuk batal.
            Klik judul konten untuk membuka brief lengkapnya, atau klik kanan pada baris (tekan-tahan di HP) untuk duplikat, salin caption, dan hapus.
            Filter tanggal mengikuti <b>Tanggal tayang</b> — konten yang belum dijadwalkan hanya muncul di rentang <b>Semua</b>. Kolom yang tidak bisa diketik berarti tahapnya sedang dikelola tim lain.
          </p>

          {toast && (
            <div className="toast" onClick={() => setToast('')}>
              <span className="toast-dot" />
              {toast}
            </div>
          )}
        </div>
      )}
      {reqModalOpen && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--req)' }} />
                  Request konten
                </div>
                <div className="modal-title">Request Konten Baru</div>
                {/* Ditonjolkan supaya jelas ini wewenang Project Manager, bukan tim lain */}
                <div style={{ margin: '7px 0 4px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '5px 13px',
                      borderRadius: 999,
                      border: '1px solid var(--req)',
                      background: 'color-mix(in srgb, var(--req) 16%, transparent)',
                      color: 'var(--req)',
                      fontSize: 12.5,
                      fontWeight: 700,
                      letterSpacing: '.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--req)' }} />
                    Project Manager
                  </span>
                </div>
                <div className="modal-sub">
                  Diajukan oleh <b>Project Manager</b>. Masuk antrian Request di board —
                  tim Creative yang mengangkatnya jadi Drafting.
                </div>
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
                {error && <p className="error-msg" style={{ margin: '8px 0 0' }}>{error}</p>}
              </div>
              {/* Aksi utama ditaruh di atas — tidak perlu scroll ke bawah dulu
                  untuk menyimpan. marginLeft auto menjaga posisinya tetap di
                  kanan, baik saat .modal-close melayang maupun ikut alur. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                {!readOnly && (
                  <button className="btn primary" onClick={save} disabled={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan'}
                  </button>
                )}
              </div>
              <button
                className="btn ghost modal-close"
                title={readOnly ? 'Tutup' : 'Batal — tutup tanpa menyimpan'}
                onClick={() => setModalOpen(false)}
              >✕</button>
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
                <div className="field">
                  <label>Hashtag{noteBtn('hashtags')}</label>
                  <textarea
                    ref={growRef}
                    value={form.hashtags}
                    disabled={readOnly}
                    onInput={autoGrow}
                    onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
                    placeholder="#filmindonesia #rekomendasifilm #fyp"
                  />
                  <div className="hint">Pisahkan dengan spasi. Otomatis ikut tersalin bersama caption di bawah.</div>
                </div>
                <div className="field">
                  <label>
                    Caption + Hashtag (siap salin)
                    <button
                      type="button"
                      className="open-link"
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        cursor: combinedCaption ? 'pointer' : 'not-allowed',
                        opacity: combinedCaption ? 1 : 0.45,
                        color: copied ? 'var(--green)' : undefined,
                      }}
                      onClick={copyCombined}
                      disabled={!combinedCaption}
                      title={combinedCaption ? 'Salin ke clipboard' : 'Isi caption / hashtag dulu'}
                    >
                      {copied ? '✓ Tersalin' : 'Copy ⧉'}
                    </button>
                  </label>
                  <textarea
                    ref={(el) => { combinedRef.current = el; growRef(el); }}
                    value={combinedCaption}
                    readOnly
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="Otomatis terisi dari Caption + Hashtag di atas"
                    style={{ background: 'var(--raised)', cursor: 'text' }}
                  />
                  <div className="hint">
                    Terisi otomatis — tidak perlu diketik. Klik <b>Copy</b> lalu tempel langsung ke TikTok/Instagram.
                  </div>
                </div>
              </div>
              <div>
                <div className="modal-col-label">Detail &amp; aset</div>
                <div className="field">
                  <label>Project</label>
                  {projectLocked ? (
                    <>
                      <div className="status-chip" style={{ ['--sc' as never]: 'var(--accent)' }}>
                        <span className="sq" style={{ background: 'var(--accent)' }} />
                        {shownProject
                          ? shownProject.name + (shownProject.vertical ? ' · ' + shownProject.vertical : '')
                          : '— belum ada project —'}
                      </div>
                      {lockedProject ? (
                        <div className="hint">Ikut project aktif di sidebar — ganti lewat selector Project di kiri.</div>
                      ) : canAcc && !readOnly ? (
                        <button className="btn ghost flow-back" onClick={() => setMovingProject(true)}>
                          ⇄ Pindahkan ke project lain
                        </button>
                      ) : (
                        <div className="hint">Project konten tidak bisa diubah — hubungi lead kalau salah project.</div>
                      )}
                    </>
                  ) : (
                    <>
                      <select
                        value={form.project_id}
                        disabled={readOnly}
                        onChange={(e) => setForm({ ...form, project_id: e.target.value, account_id: '', category_id: '' })}
                      >
                        <option value="">— pilih —</option>
                        {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                      </select>
                      {editing && (
                        <div className="hint" style={{ color: 'var(--amber)' }}>
                          Memindahkan project juga memindahkan konten ini dari papan klien lama. Pilihan akun ikut direset.
                        </div>
                      )}
                    </>
                  )}
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
                    <label>Platform{noteBtn('platform')}</label>
                    <select
                      value={form.platform}
                      disabled={readOnly}
                      onChange={(e) => setForm({ ...form, platform: e.target.value })}
                      style={{ color: platformDef(form.platform)?.color, fontWeight: form.platform ? 600 : undefined }}
                    >
                      <option value="">— pilih —</option>
                      {PLATFORMS.map((pf) => <option key={pf.key} value={pf.key}>{pf.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Category Content{noteBtn('category_id')}</label>
                    <select
                      value={form.category_id}
                      disabled={readOnly || !form.project_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    >
                      <option value="">— tanpa kategori —</option>
                      {modalCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.is_active ? '' : ' (nonaktif)'}
                        </option>
                      ))}
                    </select>
                    {form.project_id && modalCategories.length === 0 && (
                      <div className="hint">
                        Project ini belum punya kategori — tambahkan di <b>Kelola Akses → Kategori Konten</b>.
                      </div>
                    )}
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
                <div className="field">
                  <label>Tanggal tayang{noteBtn('publish_date')}</label>
                  <input type="date" value={form.publish_date} disabled={readOnly} onChange={(e) => setForm({ ...form, publish_date: e.target.value })} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>PIC Copywriter{noteBtn('pic')}</label>
                    <select value={form.pic_copywriter} disabled={readOnly} onChange={(e) => setForm({ ...form, pic_copywriter: e.target.value })}>
                      <option value="">—</option>
                      {membersOf('creative').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>PIC Content</label>
                    <select value={form.pic_creative} disabled={readOnly} onChange={(e) => setForm({ ...form, pic_creative: e.target.value })}>
                      <option value="">—</option>
                      {membersOf('creative').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
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
                <div className="field">
                  <label>
                    Link Post{noteBtn('post_url')}
                    {isUrl(form.post_url) && (
                      <a className="open-link" href={form.post_url.trim()} target="_blank" rel="noopener noreferrer">Buka ↗</a>
                    )}
                  </label>
                  <input
                    value={form.post_url}
                    disabled={readOnly}
                    onChange={(e) => setForm({ ...form, post_url: e.target.value })}
                    placeholder="https://www.tiktok.com/@akun/video/…"
                  />
                  <div className="hint">Diisi Distribution setelah konten benar-benar tayang. Dipakai sebagai bukti tayang &amp; penghubung ke data SIGMA.</div>
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={form.potensi_fyp} disabled={readOnly} onChange={(e) => setForm({ ...form, potensi_fyp: e.target.checked })} />
                  Potensi FYP — sinyal ke tim Ads
                </label>
              </div>
            </div>
            {/* Footer tinggal keterangan singkat — tombolnya sudah pindah ke
                header supaya tidak perlu scroll. */}
            <div className="modal-foot">
              <span className="foot-note">
                {readOnly
                  ? 'Mode lihat — tahap ini dikelola tim lain.'
                  : editing
                    ? 'Perubahan tersimpan setelah klik Simpan di atas. Tutup dengan ✕ untuk membatalkan.'
                    : <>Konten akan masuk kolom <b>{editingDef.label}</b>.</>}
              </span>
            </div>
          </div>
          {noteSidePanel()}
          </div>
        </div>
      )}

      {/* Menu klik-kanan / tekan-tahan pada baris */}
      {ctxMenu && (() => {
        const row = ctxMenu.row;
        const hasCaption = !!(row.caption || row.hashtags);
        const ic = (d: string) => (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={d} />
          </svg>
        );
        return (
          <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 79 }}
            onMouseDown={() => setCtxMenu(null)}
            onTouchStart={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            style={{
              position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, width: 232, zIndex: 80,
              background: 'var(--raised)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 5,
              boxShadow: '0 14px 36px rgba(0,0,0,.55)',
            }}
          >
            <div style={{ padding: '5px 10px 7px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {plainTitle(row.title) || '(tanpa judul)'}
              </div>
              <div className="sub" style={{ fontSize: 11 }}>{accName(row.account_id)}</div>
            </div>

            <CtxItem
              label="Buka detail"
              icon={ic('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z')}
              onPick={() => { setCtxMenu(null); openEdit(row); }}
            />
            <CtxItem
              label={hasCaption ? 'Salin caption + hashtag' : 'Caption masih kosong'}
              disabled={!hasCaption}
              icon={ic('M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1')}
              onPick={() => { setCtxMenu(null); copyRowCaption(row); }}
            />
            <CtxItem
              label="Duplikat ke platform lain"
              icon={ic('M9 9h12v12H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')}
              onPick={() => { setCtxMenu(null); openDup([row]); }}
            />
            <CtxItem
              label="Buka Link Post"
              disabled={!isUrl(row.post_url)}
              icon={ic('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3')}
              onPick={() => {
                setCtxMenu(null);
                if (row.post_url) window.open(row.post_url.trim(), '_blank', 'noopener');
              }}
            />
            <CtxItem
              label="Buka Link Drive"
              disabled={!isUrl(row.asset_url)}
              icon={ic('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3')}
              onPick={() => {
                setCtxMenu(null);
                if (row.asset_url) window.open(row.asset_url.trim(), '_blank', 'noopener');
              }}
            />
            {canDelete && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <CtxItem
                  label="Hapus konten"
                  danger
                  icon={ic('M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6')}
                  onPick={() => { setCtxMenu(null); setDelErr(''); setDelRow(row); }}
                />
              </>
            )}
          </div>
          </>
        );
      })()}

      {/* Duplikat konten ke platform lain */}
      {dupRows && dupRows.length > 0 && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !dupBusy && setDupRows(null)}>
          <div className="modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  Duplikat konten
                </div>
                <div className="modal-title">Tayangkan juga di platform lain</div>
                <div className="modal-sub">
                  Tiap platform jadi barisnya sendiri, jadi caption &amp; jadwalnya tetap bisa dibedakan.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={dupBusy} onClick={() => setDupRows(null)}>✕</button>
            </div>

            <div style={{ padding: '4px 24px 0' }}>
              <div className="field">
                <label>Konten yang disalin</label>
                <div className="status-chip" style={{ ['--sc' as never]: 'var(--accent)', maxWidth: '100%' }}>
                  <span className="sq" style={{ background: 'var(--accent)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {dupRows.length === 1
                      ? (plainTitle(dupRows[0].title) || '(tanpa judul)')
                      : `${dupRows.length} konten terpilih`}
                  </span>
                </div>
              </div>

              <div className="field">
                <label>Pilih platform tujuan</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {PLATFORMS.map((pf) => {
                    const already = dupRows.length === 1 && dupRows[0].platform === pf.key;
                    const picked = dupTargets.includes(pf.key);
                    return (
                      <button
                        key={pf.key}
                        type="button"
                        disabled={already || dupBusy}
                        title={already ? 'Konten ini sudah di platform tersebut' : undefined}
                        onClick={() => setDupTargets((t) =>
                          t.includes(pf.key) ? t.filter((x) => x !== pf.key) : [...t, pf.key])}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '6px 12px',
                          borderRadius: 999,
                          border: '1px solid ' + (picked ? pf.color : 'var(--border)'),
                          background: picked ? pf.color + '1f' : 'transparent',
                          color: already ? 'var(--text-3)' : picked ? pf.color : 'var(--text)',
                          fontWeight: picked ? 600 : 400,
                          fontSize: 13,
                          cursor: already ? 'not-allowed' : 'pointer',
                          opacity: already ? 0.45 : 1,
                        }}
                      >
                        <span style={{
                          width: 8, height: 8, borderRadius: 999,
                          background: pf.color, flexShrink: 0, opacity: already ? 0.5 : 1,
                        }} />
                        {pf.label}{already ? ' (sudah)' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="hint" style={{ marginTop: 10 }}>
                <b>Ikut disalin:</b> brief, caption, hashtag, kategori, link drive, PIC, tanggal tayang.<br />
                <b>Tidak disalin:</b> Link Post &amp; Kode Ads — keduanya selalu beda per platform.
                {dupRows.length > 1 && <><br />Konten yang sudah berada di platform tujuan akan dilewati otomatis.</>}
              </div>

              {dupErr && <p className="error-msg" style={{ marginTop: 10 }}>{dupErr}</p>}
            </div>

            <div className="modal-foot">
              <span className="foot-note">
                {dupTargets.length > 0
                  ? `Sampai ${dupTargets.length * dupRows.length} baris baru akan dibuat.`
                  : 'Pilih minimal satu platform.'}
              </span>
              <div className="right">
                <button className="btn" disabled={dupBusy} onClick={() => setDupRows(null)}>Batal</button>
                <button
                  className="btn primary"
                  disabled={dupBusy || dupTargets.length === 0}
                  onClick={runDuplicate}
                >
                  {dupBusy ? 'Menduplikat…' : 'Duplikat'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus konten — dipicu dari ikon sampah di kartu Board */}
      {delRow && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !delBusy && setDelRow(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus konten
                </div>
                <div className="modal-title">Hapus konten ini?</div>
                <div className="modal-sub">
                  Tindakan ini permanen — catatan &amp; riwayat konten ikut terhapus dan tidak bisa dikembalikan.
                </div>
              </div>
              <button className="btn ghost modal-close" disabled={delBusy} onClick={() => setDelRow(null)}>✕</button>
            </div>
            <div style={{ padding: '4px 24px 0' }}>
              <div
                className="status-chip"
                style={{ ['--sc' as never]: statusDef(delRow.status).color, maxWidth: '100%' }}
              >
                <span className="sq" style={{ background: statusDef(delRow.status).color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {delRow.title.replace(/\*\*/g, '').split('\n')[0] || '(tanpa judul)'}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                {accName(delRow.account_id)} · {statusDef(delRow.status).label}
              </div>
              {delErr && <p className="error-msg" style={{ marginTop: 10 }}>{delErr}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" disabled={delBusy} onClick={() => setDelRow(null)}>Batal</button>
                <button
                  className="btn danger"
                  disabled={delBusy}
                  onClick={confirmDeleteRow}
                  style={{ background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' }}
                >
                  {delBusy ? 'Menghapus…' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
