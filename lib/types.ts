export type Role = 'superadmin' | 'manager' | 'tim';

/**
 * Daftar role sebagai NILAI, bukan cuma tipe.
 *
 * Tipe TypeScript hilang waktu dibuild — route API di server tidak bisa
 * memakainya untuk memeriksa isian, jadi dulu ia menyalin daftarnya sendiri.
 * Salinan itulah yang ketinggalan zaman. Satu daftar saja, dipakai bersama.
 */
export const ROLES: Role[] = ['superadmin', 'manager', 'tim'];
/**
 * Tim = jabatan pada bagan organisasi, bukan sekadar fungsi kerja.
 * Nilai-nilai ini harus SAMA PERSIS dengan enum `app_team` di database.
 * Ingat: nilai enum Postgres bisa ditambah, TIDAK bisa dihapus — jadi jangan
 * menambah nilai baru sebelum disepakati.
 */
export type Team =
  // Level PT Kahfi Indo Group
  | 'ceo' | 'komisaris' | 'coo' | 'cfo' | 'cpo' | 'ia' | 'staff' | 'ga' | 'delta'
  // Level unit bisnis (KC & GME)
  | 'pimpinan' | 'ho' | 'lo' | 'sm' | 'hrd' | 'pm' | 'finance' | 'developer'
  // Tim yang menggarap konten
  | 'creative' | 'distribution' | 'ads' | 'vmt';

/** Label yang enak dibaca manusia. Dipakai di dropdown Kelola Akses. */
export const TEAM_LABEL: Record<Team, string> = {
  ceo: 'CEO',
  komisaris: 'Komisaris',
  coo: 'COO',
  cfo: 'CFO',
  cpo: 'CPO',
  ia: 'Internal Affairs',
  staff: 'Staff KIG',
  ga: 'General Affairs',
  delta: 'Delta',
  pimpinan: 'Pimpinan Tertinggi',
  ho: 'Head of Operational',
  lo: 'Lead Operational',
  sm: 'Sales Manager',
  hrd: 'HRD',
  pm: 'Project Manager',
  finance: 'Finance',
  developer: 'Developer',
  creative: 'Creative',
  distribution: 'Distribution',
  ads: 'Ads',
  vmt: 'VMT',
};

/**
 * Semua nilai team yang sah, diturunkan dari TEAM_LABEL supaya tidak mungkin
 * beda. Menambah tim cukup di TEAM_LABEL (dan enum `app_team` di database) —
 * daftar ini ikut sendiri, termasuk yang dipakai server.
 */
export const TEAM_VALUES: Team[] = Object.keys(TEAM_LABEL) as Team[];

/** Pengelompokan untuk dropdown supaya 21 pilihan tidak jadi daftar panjang. */
export const TEAM_GROUPS: { label: string; teams: Team[] }[] = [
  { label: 'Konten', teams: ['creative', 'distribution', 'ads', 'vmt'] },
  { label: 'Unit Bisnis', teams: ['pimpinan', 'ho', 'lo', 'sm', 'hrd', 'pm', 'finance', 'developer'] },
  { label: 'PT Kahfi Indo Group', teams: ['ceo', 'komisaris', 'coo', 'cfo', 'cpo', 'ia', 'staff', 'ga', 'delta'] },
];

/**
 * Tim apa saja yang masuk akal untuk sebuah unit bisnis.
 * Ini hanya penyaring TAMPILAN — tembok akses yang sebenarnya tetap di RLS
 * lewat kolom `vertical`, bukan di sini.
 */
export function teamsForVertical(vertical: string | null | undefined): Team[] {
  const konten = TEAM_GROUPS[0].teams;
  const unit = TEAM_GROUPS[1].teams;
  const holding = TEAM_GROUPS[2].teams;
  if (vertical === 'KIG' || vertical === 'ALL') return [...konten, ...unit, ...holding];
  if (vertical === 'KC' || vertical === 'GME') return [...konten, ...unit];
  // Belum diatur — tampilkan semua supaya tidak ada yang tidak bisa dipilih.
  return [...konten, ...unit, ...holding];
}
export type ContentStatus =
  | 'drafting' | 'review'
  | 'siap_upload' | 'terjadwal'
  | 'published' | 'diiklankan'
  /** Sudah tayang lalu kena pelanggaran platform — harus ditindak. */
  | 'pelanggaran';
/**
 * @deprecated Sejak v24 kategori konten pindah ke tabel `content_categories`
 * (per project). Tipe & label ini dipertahankan hanya karena kolom `pillar`
 * masih ada di database sebagai warisan — tidak dipakai lagi di UI.
 */
export type Pillar = 'lagi_ramai' | 'wajib_tonton' | 'di_balik_layar' | 'panas_timeline';
export type Division = 'semua' | 'creative' | 'distribution' | 'ads';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  team: Team | null;
  vertical: string | null;
  is_active: boolean;
  created_at: string;
  /**
   * Atasan langsung yang DITUNJUK di Bagan Tim. Kosong = ikut tangga otomatis
   * (manager di tim yang sama → HO → Pimpinan). Perlu ditunjuk kalau satu tim
   * punya lebih dari satu manager, karena tangga otomatis tidak bisa memilih.
   */
  lead_id: string | null;
  /**
   * true = pengajuan cutinya SELESAI begitu lead menyetujui, tidak diteruskan
   * ke HRD. Dipakai untuk jajaran yang atasannya Pimpinan — janggal kalau HRD
   * yang mengetuk cuti atasannya sendiri.
   */
  cuti_lewati_hrd: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  team: Team;
  is_active: boolean;
  created_at: string;
}

export type Vertical = 'KC' | 'GME' | 'KIG';
export const VERTICALS: { key: Vertical; label: string }[] = [
  { key: 'KC', label: 'KC — Kahfi Corp' },
  { key: 'GME', label: 'GME — Gala Mega Enigma' },
  { key: 'KIG', label: 'KIG — lintas grup' },
];

/**
 * Nilai vertical yang sah untuk kolom `profiles.vertical`.
 * 'ALL' tidak ada di VERTICALS karena bukan unit bisnis — itu penanda
 * "lintas unit" yang dibaca can_see_all() di database, tapi tetap harus sah.
 */
export const VERTICAL_VALUES: string[] = ['KC', 'GME', 'KIG', 'ALL'];

export interface Project {
  id: string;
  name: string;
  label: string | null;
  vertical: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Palet warna untuk kategori & label. Sengaja mid-tone supaya tetap terbaca
 * di mode gelap maupun terang.
 */
export const TAG_PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#06b6d4', '#f97316', '#ef4444', '#6366f1'];

/**
 * Warna tetap untuk sebuah nama — nama yang sama SELALU dapat warna yang sama,
 * di mana pun ditampilkan. Dipakai bersama oleh chip kategori di Kelola Akses
 * dan warna kartu di Board, supaya keduanya tidak pernah berbeda.
 */
export function tagColor(s: string): string {
  const t = (s || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

/** Platform tayang. Daftar tetap supaya tidak muncul "TikTok" / "tiktok" / "Tik Tok". */
export const PLATFORMS: { key: string; label: string; color: string }[] = [
  { key: 'instagram', label: 'Instagram', color: '#e0338a' },
  { key: 'tiktok', label: 'TikTok', color: '#38bdf8' },
  { key: 'youtube', label: 'YouTube', color: '#f87171' },
  { key: 'threads', label: 'Threads', color: '#a78bfa' },
  { key: 'facebook', label: 'Facebook', color: '#60a5fa' },
];

export const platformDef = (k: string | null) => PLATFORMS.find((p) => p.key === k) || null;

/**
 * Alamat profil akun untuk satu platform — **dibaca, bukan ditebak**.
 *
 * Versi pertama fungsi ini merakit alamat dari platform + handle. Itu salah:
 * handle di Alpha tidak selalu sama dengan username asli di platformnya, dan
 * satu akun dipakai di beberapa platform dengan username berbeda. Akibatnya
 * sebagian tautan menuju akun milik orang lain. (20 Agustus 2026)
 *
 * Sekarang alamatnya disimpan per akun per platform di Kelola Akses.
 * Kalau belum diisi, fungsi ini mengembalikan `null` dan pemanggilnya wajib
 * menampilkan teks biasa — **jangan pernah menambal dengan tebakan.**
 *
 * Alamat yang tidak diawali http:// atau https:// juga ditolak, supaya salah
 * ketik tidak berubah jadi tautan relatif yang menuju ke dalam Alpha sendiri.
 */
export function accountUrl(
  account: Account | null | undefined,
  platform: string | null | undefined,
): string | null {
  if (!account || !platform) return null;
  const kolom = KOLOM_URL_AKUN[platform];
  if (!kolom) return null;
  const nilai = account[kolom];
  if (typeof nilai !== 'string') return null;
  const bersih = nilai.trim();
  if (!bersih) return null;
  if (!/^https?:\/\//i.test(bersih)) return null;
  return bersih;
}

/** Kategori konten — dikelola per project lewat Kelola Akses. */
export interface ContentCategory {
  id: string;
  project_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Account {
  id: string;
  handle: string;
  label: string | null;
  is_active: boolean;
  project_id: string | null;
  /**
   * Akun umum yang mengangkat banyak judul — mis. `@sudutsinema_` yang dipakai
   * Seni Merayu Tuhan sekaligus Film Rumah Singgah.
   *
   * Kalau true, akun ini ikut muncul di dropdown SEMUA project yang se-unit
   * dengan project asalnya. `project_id` tetap wajib dan tetap menentukan unit
   * bisnisnya (dipakai policy `accounts_select`) serta jadi satu-satunya tempat
   * akun ini diurus di Kelola Akses.
   *
   * Opsional di TypeScript supaya komponen yang memakai `select()` terbatas
   * tidak ikut rusak.
   */
  universal?: boolean | null;
  /**
   * Alamat profil per platform. Satu baris akun dipakai lintas platform —
   * `@mediaruangfilm` ada di Instagram, TikTok, dan YouTube — dan username
   * aslinya bisa berbeda di tiap tempat, jadi tiap platform punya kolomnya
   * sendiri. Boleh kosong; yang kosong tidak ditautkan.
   *
   * Opsional di TypeScript supaya komponen yang memakai `select()` terbatas
   * tidak ikut rusak.
   */
  url_instagram?: string | null;
  url_tiktok?: string | null;
  url_youtube?: string | null;
  url_threads?: string | null;
  url_facebook?: string | null;
}

/**
 * Akun yang boleh dipilih untuk sebuah project.
 *
 * Isinya: akun milik project itu sendiri, DITAMBAH akun universal yang project
 * asalnya berada di unit bisnis yang sama.
 *
 * Penjaga unit itu bukan basa-basi. RLS `accounts_select` sudah menyaring per
 * unit, jadi anggota KC memang tidak pernah menerima baris akun KIG — tapi
 * superadmin (vertical ALL) menerima semuanya. Tanpa pemeriksaan ini, akun
 * universal milik KC akan muncul di dropdown project KIG, dan cuma superadmin
 * yang melihatnya. Bug seperti itu baru ketahuan berbulan-bulan kemudian.
 *
 * Dipakai bersama oleh Board, App, dan Kelola Akses supaya tidak ada dua layar
 * yang berbeda pendapat soal akun mana yang boleh dipakai.
 */
export function akunUntukProject(
  accounts: Account[],
  projects: Project[],
  projectId: string | null,
): Account[] {
  if (!projectId) return accounts;
  const verticalDari = (id: string | null): string | null => {
    if (!id) return null;
    const p = projects.find((x) => x.id === id);
    return p ? (p.vertical as string) : null;
  };
  const unit = verticalDari(projectId);
  return accounts.filter((a) => {
    if (a.project_id === projectId) return true;
    if (!a.universal || !a.project_id) return false;
    // Unit project asal harus sama. Kalau salah satunya tidak diketahui,
    // akunnya TIDAK ditawarkan — lebih baik kurang daripada bocor lintas unit.
    const unitAsal = verticalDari(a.project_id);
    return !!unit && !!unitAsal && unitAsal === unit;
  });
}

/** Platform -> nama kolom penyimpan alamatnya di tabel `accounts`. */
export const KOLOM_URL_AKUN: Record<string, keyof Account> = {
  instagram: 'url_instagram',
  tiktok: 'url_tiktok',
  youtube: 'url_youtube',
  threads: 'url_threads',
  facebook: 'url_facebook',
};

export interface ContentRow {
  id: string;
  title: string;
  project_id: string | null;
  account_id: string | null;
  /** @deprecated Warisan — kolom DB masih ada (punya DEFAULT), tapi tidak dipakai UI sejak v24. */
  pillar: Pillar;
  /** Kategori konten per project. Null = belum dikategorikan. */
  category_id: string | null;
  status: ContentStatus;
  pic_copywriter: string | null;
  pic_creative: string | null;
  pic_distribution: string | null;
  pic_ads: string | null;
  deadline: string | null;
  publish_date: string | null;
  caption: string | null;
  hashtags: string | null;
  asset_url: string | null;
  /** Link konten yang sudah tayang (TikTok/IG). Jembatan ke kolom url di SIGMA. */
  post_url: string | null;
  /** Kode ads yang diinput tim Ads. */
  ads_code: string | null;
  /** Platform tayang: instagram / tiktok / youtube / threads / facebook. */
  platform: string | null;
  /** Penanda serumpun — konten hasil duplikat berbagi nilai yang sama. */
  group_id: string | null;
  visual_hook: string | null;
  /** @deprecated Disembunyikan dari Board sejak v21. Kolom DB sengaja dipertahankan agar data lama tidak hilang. */
  production_note: string | null;
  potensi_fyp: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentNote {
  id: string;
  content_id: string;
  author_id: string | null;
  author_name: string | null;
  field: string;
  note: string;
  created_at: string;
}

export interface ContentRequest {
  id: string;
  title: string;
  project_id: string | null;
  account_id: string | null;
  requested_date: string | null;
  note: string | null;
  requester_id: string | null;
  requester_name: string | null;
  status: string;
  created_content_id: string | null;
  created_at: string;
}

export interface RecapReport {
  id: string;
  project_id: string | null;
  title: string;
  period: string | null;
  note: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  link_url: string | null;
  link_type: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
  created_at: string;
}

export interface Complaint {
  id: string;
  category: string;
  title: string;
  detail: string | null;
  status: string;
  reporter_id: string | null;
  reporter_name: string | null;
  handler_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ComplaintMessage {
  id: string;
  complaint_id: string;
  author_id: string | null;
  author_name: string | null;
  message: string;
  created_at: string;
}

export interface BudgetRequest {
  id: string;
  project_id: string | null;
  category: string;
  title: string;
  description: string | null;
  amount: number;
  urgency: string | null;
  request_proof_path: string | null;
  request_proof_name: string | null;
  status: string;
  requester_id: string | null;
  requester_name: string | null;
  approver_id: string | null;
  approver_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  payer_id: string | null;
  payer_name: string | null;
  paid_at: string | null;
  payment_proof_path: string | null;
  payment_proof_name: string | null;
  created_at: string;
}

/** Satu foto bukti lembur. `path` = lokasi di bucket `lembur` (privat, harus
 *  dibuka lewat signed URL), `name` = nama file asli untuk ditampilkan. */
export interface OvertimeProof {
  path: string;
  name: string;
}

/** Maksimal foto bukti per pengajuan lembur. Dijaga juga oleh constraint
 *  `overtime_proofs_maks_3` di database. */
export const MAKS_FOTO_LEMBUR = 3;

/**
 * Tautan hasil pengerjaan lembur — dashboard, dokumen, sheet, apa pun yang
 * bisa dibuka. `label` boleh kosong; kalau kosong, tampilan memakai nama
 * domainnya supaya daftar tautan tetap enak dibaca.
 */
export interface OvertimeLink {
  url: string;
  label: string;
}

/** Maksimal tautan per pengajuan lembur. Dijaga juga oleh constraint
 *  `overtime_links_maks_3` di database. */
export const MAKS_LINK_LEMBUR = 3;

/**
 * Membersihkan tautan yang diketik orang.
 *
 * Orang biasa menempel "kig-beta.vercel.app/..." tanpa https://, dan tanpa
 * skema itu href-nya dianggap alamat relatif — kliknya nyasar ke dalam Alpha
 * sendiri, bukan ke tujuannya. Kembalinya null kalau memang bukan tautan.
 */
export function rapikanLink(mentah: string): string | null {
  const t = (mentah || '').trim();
  if (!t) return null;
  const lengkap = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  // Harus punya titik pada nama host — menahan ketikan seperti "dashboard"
  // yang jelas bukan alamat.
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(lengkap)) return null;
  return lengkap;
}

/** Nama domain untuk dipakai sebagai label bawaan. */
export function domainSingkat(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./i, '') : url;
}

/* ------------------------------------------------------------------ *
 * Tautan ke sekumpulan brief di Board
 * ------------------------------------------------------------------ */

/**
 * Satu tautan pendek yang menunjuk ke beberapa brief sekaligus.
 *
 * Dipakai untuk mencantumkan pekerjaan di pengajuan lembur: pilih briefnya di
 * Board, klik kanan, dapat satu alamat. Yang membukanya melihat Board yang
 * sudah disaring ke daftar itu.
 *
 * Yang disimpan HANYA daftar id. Isi tiap brief tetap dijaga RLS `contents`,
 * jadi memegang tautannya tidak membuat orang bisa melihat brief yang bukan
 * haknya — brief itu sekadar tidak muncul.
 */
export interface BoardLink {
  id: string;
  /** Kode pendek di alamat, mis. `?b=4cbe22a80d`. Dibuat oleh database. */
  kode: string;
  content_ids: string[];
  label: string;
  created_by: string;
  created_at: string;
}

/** Maksimal brief dalam satu tautan. Dijaga juga oleh constraint
 *  `board_links_isi_wajar` di database. */
export const MAKS_BRIEF_TAUTAN = 200;

/** Nama parameter alamat yang dibaca App saat halaman dibuka. */
export const PARAM_TAUTAN_BOARD = 'b';

/** Alamat lengkap sebuah tautan board, dari kodenya. */
export function alamatTautanBoard(kode: string): string {
  if (typeof window === 'undefined') return `?${PARAM_TAUTAN_BOARD}=${kode}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname || '/'}?${PARAM_TAUTAN_BOARD}=${kode}`;
}

/* ------------------------------------------------------------------ *
 * Blok jam lembur
 * ------------------------------------------------------------------ */

/** Satu blok jam kerja dalam sebuah pengajuan lembur. Format "HH:MM". */
export interface OvertimeSession {
  mulai: string;
  selesai: string;
}

/** Maksimal blok jam per pengajuan. Dijaga juga oleh constraint
 *  `overtime_sesi_maks_5` dan trigger `jaga_sesi_lembur` di database. */
export const MAKS_SESI_LEMBUR = 5;

/**
 * Lama satu blok dalam menit.
 *
 * `menit < 0` berarti bloknya melewati tengah malam (22:00 → 01:00), bukan
 * kesalahan input — jadi ditambah 24 jam, tidak dibuang.
 */
export function menitBlok(mulai: string, selesai: string): number {
  if (typeof mulai !== 'string' || typeof selesai !== 'string') return 0;
  const m = mulai.split(':').map(Number);
  const s = selesai.split(':').map(Number);
  if (m.length < 2 || s.length < 2) return 0;
  let menit = s[0] * 60 + s[1] - (m[0] * 60 + m[1]);
  if (menit < 0) menit += 24 * 60;
  return menit;
}

/**
 * Blok jam sebuah pengajuan, sudah menangani baris lama.
 *
 * Pola yang sama dengan `fotoDari()`: kolom barunya kosong berarti pakai cara
 * lama, bukan berarti datanya hilang.
 */
export function sesiLembur(o: {
  sessions?: OvertimeSession[] | null;
  start_time: string;
  end_time: string;
}): OvertimeSession[] {
  const s = Array.isArray(o.sessions) ? o.sessions : [];
  if (s.length) return s;
  return [{ mulai: (o.start_time || '').slice(0, 5), selesai: (o.end_time || '').slice(0, 5) }];
}

/**
 * Total menit sebuah pengajuan.
 *
 * `total_menit` dari database yang dipakai kalau ada — dialah satu-satunya
 * sumber kebenaran. Hitungan dari blok cuma jaring pengaman untuk baris yang
 * kebetulan belum sempat dihitung ulang (mis. tepat saat migrasi berjalan).
 */
export function menitLembur(o: {
  total_menit?: number | null;
  sessions?: OvertimeSession[] | null;
  start_time: string;
  end_time: string;
}): number {
  if (typeof o.total_menit === 'number' && o.total_menit > 0) return o.total_menit;
  return sesiLembur(o).reduce((a, s) => a + menitBlok(s.mulai, s.selesai), 0);
}

/** 360 → "6j"; 155 → "2j 35m". Untuk dibaca manusia. */
export function jamTeksMenit(menit: number): string {
  const H = Math.floor(menit / 60);
  const M = Math.round(menit % 60);
  return M ? `${H}j ${M}m` : `${H}j`;
}

/** Jam dalam angka desimal — untuk dijumlah di Excel, bukan dibaca. */
export function jamLemburAngka(menit: number): number {
  return Math.round((menit / 60) * 100) / 100;
}

/** "09:00–10:00, 14:00–17:00, 19:00–22:00" */
export function ringkasBlokJam(o: {
  sessions?: OvertimeSession[] | null;
  start_time: string;
  end_time: string;
}): string {
  return sesiLembur(o).map((s) => `${s.mulai}–${s.selesai}`).join(', ');
}

export interface OvertimeRequest {
  id: string;
  /** Project utama — dipertahankan karena policy RLS lama masih memakainya. */
  project_id: string | null;
  /** Semua project yang dikerjakan pada lembur ini. Termasuk project utama. */
  project_ids: string[];
  /** Foto bukti lama (satu foto). Tidak dipakai lagi oleh Alpha — disimpan
   *  supaya baris/deploy lama tidak patah. Baca `proofs`. */
  proof_path: string | null;
  proof_name: string | null;
  /** Foto bukti di bucket `lembur`, maksimal 3. Kosong = tidak melampirkan. */
  proofs: OvertimeProof[];
  /** Tautan hasil pengerjaan, maksimal 3. Kosong = tidak melampirkan. */
  work_links: OvertimeLink[];
  /**
   * Blok jam kerja, maksimal 5. Kosong = pengajuan satu blok — jamnya dibaca
   * dari `start_time`/`end_time` seperti sebelumnya. Baca lewat `sesiLembur()`,
   * jangan langsung, supaya baris lama ikut tertangani.
   */
  sessions: OvertimeSession[];
  /**
   * Total menit kerja, DIHITUNG DATABASE oleh trigger `jaga_sesi_lembur`.
   *
   * Jangan pernah menghitungnya ulang di layar dari start/end: untuk pengajuan
   * berblok (09–10, 14–17, 19–22) selisih selubungnya 13 jam, sedangkan yang
   * benar 7 jam — dan angka ini yang masuk rekap jam HRD.
   */
  total_menit: number;
  work_date: string;
  start_time: string;
  end_time: string;
  description: string;
  status: string;
  requester_id: string | null;
  requester_name: string | null;
  approver_id: string | null;
  approver_name: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface DistributionLog {
  id: string;
  project_id: string | null;
  platform: string;
  content_category: string | null;
  group_names: string;
  group_count: number;
  content_url: string | null;
  note: string | null;
  proof_path: string | null;
  proof_name: string | null;
  proof_hash: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: number;
  /** Pelaku. Null untuk kejadian yang dipicu sistem, bukan orang. */
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_title: string | null;
  detail: string | null;
  created_at: string;
}

export const PILLAR_LABEL: Record<Pillar, string> = {
  lagi_ramai: 'Lagi Ramai',
  wajib_tonton: 'Wajib Tonton',
  di_balik_layar: 'Di Balik Layar',
  panas_timeline: 'Panas di Timeline',
};

export interface StatusDef {
  key: ContentStatus;
  label: string;
  ownerTeam: Team;
  color: string;
}

export const STATUSES: StatusDef[] = [
  { key: 'drafting', label: 'Drafting', ownerTeam: 'creative', color: 'var(--st-drafting)' },
  { key: 'review', label: 'Review', ownerTeam: 'creative', color: 'var(--st-review)' },
  { key: 'siap_upload', label: 'Siap Upload', ownerTeam: 'distribution', color: 'var(--st-siap)' },
  { key: 'terjadwal', label: 'Terjadwal', ownerTeam: 'distribution', color: 'var(--st-terjadwal)' },
  { key: 'published', label: 'Published', ownerTeam: 'distribution', color: 'var(--st-published)' },
  { key: 'diiklankan', label: 'Diiklankan', ownerTeam: 'ads', color: 'var(--st-diiklankan)' },
  { key: 'pelanggaran', label: 'Pelanggaran', ownerTeam: 'distribution', color: 'var(--st-pelanggaran)' },
];

export const DIVISIONS: { key: Division; label: string; color: string; desc: string; statuses: ContentStatus[] }[] = [
  {
    key: 'semua', label: 'Semua', color: 'var(--accent)',
    desc: 'Semua konten lintas divisi — cari & edit tanpa pindah papan.',
    statuses: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan', 'pelanggaran'],
  },
  {
    key: 'creative', label: 'Creative', color: 'var(--st-ide)',
    desc: 'Drafting → Review → ACC lead. Menyiapkan brief, copywriting, dan aset final.',
    statuses: ['drafting', 'review'],
  },
  {
    key: 'distribution', label: 'Distribution', color: 'var(--st-terjadwal)',
    desc: 'Siap Upload → Terjadwal → Published. Menyusun caption, media, dan menayangkan.',
    statuses: ['siap_upload', 'terjadwal', 'published', 'pelanggaran'],
  },
  {
    key: 'ads', label: 'Ads', color: 'var(--st-diiklankan)',
    desc: 'Konten yang sudah diiklankan — boosting & kode ads.',
    statuses: ['diiklankan'],
  },
];

export const TEAM_EDITABLE: Record<Team, ContentStatus[]> = {
  delta: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan', 'pelanggaran'],
  // Creative ikut memegang 'pelanggaran' supaya konten bermasalah bisa ditarik
  // kembali ke Drafting untuk diperbaiki.
  creative: ['drafting', 'review', 'pelanggaran'],
  distribution: ['siap_upload', 'terjadwal', 'published', 'pelanggaran'],
  // Ads perlu bisa menyentuhnya untuk menghentikan iklan konten bermasalah.
  ads: ['published', 'diiklankan', 'pelanggaran'],
  // VMT sejajar dengan Creative di bagan CV KahfiCorp — menggarap materi,
  // bukan menayangkan. Kalau ternyata VMT ikut menayangkan, ganti barisnya
  // jadi: ['siap_upload', 'terjadwal', 'published', 'pelanggaran'].
  vmt: ['drafting', 'review', 'pelanggaran'],

  // --- Jabatan yang tidak menggarap konten ---
  // Boleh melihat dan memakai modul pengajuan, tidak memindahkan status.
  pimpinan: [],
  ho: [],
  lo: [],
  sm: [],
  hrd: [],
  pm: [],
  finance: [],
  developer: [],
  ceo: [],
  komisaris: [],
  coo: [],
  cfo: [],
  cpo: [],
  ia: [],
  staff: [],
  ga: [],
};

export const TEAM_TARGETABLE: Record<Team, ContentStatus[]> = {
  delta: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan', 'pelanggaran'],
  creative: ['drafting', 'review', 'pelanggaran'],
  distribution: ['siap_upload', 'terjadwal', 'published', 'pelanggaran'],
  ads: ['published', 'diiklankan', 'pelanggaran'],
  vmt: ['drafting', 'review', 'pelanggaran'],

  pimpinan: [],
  ho: [],
  lo: [],
  sm: [],
  hrd: [],
  pm: [],
  finance: [],
  developer: [],
  ceo: [],
  komisaris: [],
  coo: [],
  cfo: [],
  cpo: [],
  ia: [],
  staff: [],
  ga: [],
};

/**
 * Tim yang memang menggarap konten. Anggotanya — termasuk Lead-nya —
 * berurusan dengan status konten. Tim di luar daftar ini tidak, seberapa pun
 * tinggi perannya.
 *
 * Dipakai untuk menutup temuan yang terverifikasi 20 Agustus 2026: peran
 * `manager` melewati seluruh batasan tim, sehingga PM, Finance, HO, dan GA
 * bisa memindahkan status konten — bertentangan dengan panduan yang sudah
 * dibagikan ke tim. Cerminannya di database adalah fungsi `can_move_content()`.
 *
 * Keputusan Mas Dik: Lead tim konten TETAP bebas lintas tahap (supaya bisa
 * menolong saat anggotanya berhalangan). Yang ditutup hanya tim non-konten.
 */
export const TIM_KONTEN: Team[] = ['creative', 'distribution', 'ads', 'vmt', 'delta'];

/* ===================================================================
   MATRIKS IZIN PERAN
   ===================================================================
   Cerminan tabel `role_permissions` + `role_permission_teams` dan fungsi
   `boleh()` di database. Layar HARUS memakai sumber yang sama dengan RLS —
   kalau tidak, tombol terlihat aktif lalu ditolak diam-diam.

   Matriksnya dimuat SEKALI saat login (lihat App.tsx) lalu disimpan di
   modul ini, supaya tidak perlu dialirkan sebagai prop melewati puluhan
   komponen. Selama belum termuat, semua pertanyaan dijawab memakai
   ATURAN BAWAAN di bawah — yaitu perilaku Alpha sebelum matriks ada.
   Jadi kegagalan memuat matriks tidak pernah membuat orang kehilangan
   akses, paling buruk cuma tidak mendapat perubahan terbaru.
=================================================================== */

/** Nama tugas. Dipakai sebagai kunci di database — jangan diubah sembarangan,
 *  harus sama persis dengan kolom `tugas` di tabel `permission_tasks`. */
export const TUGAS = {
  kontenBuat:        'konten_buat',
  kontenPindahBebas: 'konten_pindah_bebas',
  kontenHapus:       'konten_hapus',
  catatanHapusOrang: 'catatan_hapus_orang',
  requestBuat:       'request_buat',
  requestUbah:       'request_ubah',
  requestHapus:      'request_hapus',
  projectTambah:     'project_tambah',
  projectUbahHapus:  'project_ubah_hapus',
  kategoriKelola:    'kategori_kelola',
  akunMediaKelola:   'akun_media_kelola',
  anggotaPicKelola:  'anggota_pic_kelola',
  budgetAjukan:      'budget_ajukan',
  budgetPutuskan:    'budget_putuskan',
  budgetHapus:       'budget_hapus',
  lemburPutuskan:    'lembur_putuskan',
  lemburHapusOrang:  'lembur_hapus_orang',
  komplainLihat:     'komplain_lihat',
  komplainUbah:      'komplain_ubah',
  komplainHapus:     'komplain_hapus',
  logLihat:          'log_lihat',
  rekapHapusOrang:   'rekap_hapus_orang',
  sebaranUbahOrang:  'sebaran_ubah_orang',
} as const;

export interface TugasDef {
  tugas: string;
  label: string;
  kelompok: string;
  urutan: number;
  keterangan: string | null;
  terkunci: boolean;
}
export interface IzinBaris { tugas: string; role: Role; boleh: boolean }
export interface IzinTim   { tugas: string; role: Role; team: Team }

/** null = belum dimuat. Sengaja variabel modul, bukan React context: helper
 *  seperti canEditRow() dipanggil dari dalam perulangan render Board yang
 *  tidak memegang context apa pun. */
let MATRIKS: { baris: IzinBaris[]; tim: IzinTim[] } | null = null;

export function pasangMatriks(baris: IzinBaris[], tim: IzinTim[]): void {
  MATRIKS = { baris, tim };
}
export function matriksTerpasang(): boolean {
  return MATRIKS !== null;
}

/** Perilaku Alpha SEBELUM matriks ada. Dipakai kalau matriks gagal dimuat. */
function bawaan(profile: Profile, tugas: string): boolean {
  const manager = profile.role === 'manager';
  const tim = profile.role === 'tim';
  const timKonten = !!profile.team && TIM_KONTEN.includes(profile.team);
  switch (tugas) {
    case TUGAS.kontenBuat:
      return (manager && timKonten) || (tim && (profile.team === 'creative' || profile.team === 'delta'));
    case TUGAS.kontenPindahBebas:
    case TUGAS.kontenHapus:
      return manager && timKonten;
    case TUGAS.requestBuat:
      return manager || profile.team === 'pm';
    case TUGAS.requestUbah:
      return manager || profile.team === 'creative' || profile.team === 'delta';
    case TUGAS.projectTambah:
      return manager && profile.team === 'pm';
    case TUGAS.budgetPutuskan:
      return profile.team === 'pm' || profile.team === 'finance';
    case TUGAS.kategoriKelola:
    case TUGAS.catatanHapusOrang:
    case TUGAS.requestHapus:
    case TUGAS.budgetAjukan:
    case TUGAS.lemburPutuskan:
    case TUGAS.komplainLihat:
    case TUGAS.komplainUbah:
    case TUGAS.komplainHapus:
    case TUGAS.logLihat:
    case TUGAS.rekapHapusOrang:
      return manager;
    // Sisanya superadmin saja — sudah dijawab di boleh() sebelum sampai sini.
    default:
      return false;
  }
}

/**
 * Pertanyaan tunggal: orang ini boleh melakukan tugas ini atau tidak?
 *
 * Superadmin dijawab SEBELUM matriks dibaca — sama persis seperti fungsi
 * `boleh()` di database. Jadi tidak ada centang yang bisa mengunci superadmin
 * keluar dari aplikasinya sendiri.
 */
export function boleh(profile: Profile | null, tugas: string): boolean {
  if (!profile || !profile.is_active) return false;
  if (profile.role === 'superadmin') return true;
  if (!MATRIKS) return bawaan(profile, tugas);

  const baris = MATRIKS.baris.find((b) => b.tugas === tugas && b.role === profile.role);
  if (!baris || !baris.boleh) return false;

  const pembatas = MATRIKS.tim.filter((t) => t.tugas === tugas && t.role === profile.role);
  if (pembatas.length === 0) return true;              // tanpa pembatas = semua tim
  if (!profile.team) return false;
  return pembatas.some((t) => t.team === profile.team);
}

/**
 * Boleh membuat konten baru (termasuk mengangkat request jadi konten).
 *
 * Cerminan dari policy `contents_insert` di database. Dua-duanya harus selalu
 * diubah berbarengan — kalau layar menawarkan tombol yang ditolak database,
 * pengguna cuma melihat kegagalan tanpa tahu sebabnya.
 */
export function canCreateContent(profile: Profile | null): boolean {
  return boleh(profile, TUGAS.kontenBuat) || boleh(profile, TUGAS.kontenPindahBebas);
}

/**
 * Boleh menghapus konten, dan boleh menarik status mundur.
 *
 * Disamakan dengan aturan memindahkan status (keputusan Mas Dik 21 Agustus):
 * janggal kalau seseorang tidak boleh menggeser status tapi boleh menghapus
 * barisnya sekalian. Cerminan dari policy `contents_delete`.
 */
export function canDeleteContent(profile: Profile | null): boolean {
  return boleh(profile, TUGAS.kontenHapus);
}

/**
 * Boleh menambah project baru.
 *
 * Cerminan fungsi `can_add_project()` dan policy `projects_insert` di database
 * — **ubah dua-duanya berbarengan**, kalau tidak tombolnya muncul tapi
 * simpannya ditolak (atau sebaliknya: bisa simpan tapi tombolnya tidak ada).
 *
 * Sengaja TIDAK memakai `can_see_all()`. Fungsi itu dipakai 13 policy di 6
 * tabel (chat grup, log aktivitas, join request); melonggarkannya akan
 * membuka hal-hal yang sama sekali tidak berhubungan dengan project.
 */
export function canAddProject(profile: Profile | null): boolean {
  return boleh(profile, TUGAS.projectTambah);
}

/**
 * Boleh memilih vertical project secara bebas. Yang tidak boleh, project
 * barunya dikunci ke vertical akunnya sendiri — supaya PM KC tidak membuat
 * project KIG yang kemudian hilang dari layarnya sendiri.
 */
export function bebasPilihVertical(profile: Profile | null): boolean {
  if (!profile || !profile.is_active) return false;
  return profile.role === 'superadmin' || profile.vertical === 'ALL';
}

export function canEditRow(profile: Profile | null, status: ContentStatus): boolean {
  if (!profile || !profile.is_active) return false;
  if (boleh(profile, TUGAS.kontenPindahBebas)) return true;
  // Cabang tahap-per-tim sengaja TETAP hardcode. Kalau dijadikan centang,
  // jadi 21 tim x 8 status = 168 kotak. Cerminannya team_can_edit() di database.
  if (profile.role !== 'tim') return false;
  if (!profile.team) return false;
  // `?? []` penting: kalau ada nilai enum baru ditambahkan di database tapi
  // file ini belum ikut ter-deploy, tanpa ini barisnya jadi undefined.includes()
  // dan seluruh Board error untuk pemilik tim tersebut.
  return (TEAM_EDITABLE[profile.team] ?? []).includes(status);
}

export function targetableStatuses(profile: Profile | null, current: ContentStatus): ContentStatus[] {
  if (!profile) return [current];
  if (boleh(profile, TUGAS.kontenPindahBebas)) return STATUSES.map((s) => s.key);
  if (profile.role !== 'tim') return [current];
  if (!profile.team) return [current];
  const targets = TEAM_TARGETABLE[profile.team] ?? [];
  return targets.includes(current) ? targets : [current];
}

export function statusDef(key: ContentStatus): StatusDef {
  return STATUSES.find((s) => s.key === key) || STATUSES[0];
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

// ============================================================================
// CUTI & WFH
//
// Usulan Qintana (HRD KC) lewat Komplain, 3 September 2026: pengajuan cuti dan
// WFH yang disetujui lead dulu lalu HRD, dan karyawannya bisa memantau sendiri
// statusnya di Alpha.
// ============================================================================

export type JenisCuti = 'cuti' | 'sakit' | 'izin' | 'wfh';

export const JENIS_CUTI: { key: JenisCuti; label: string; color: string }[] = [
  { key: 'cuti',  label: 'Cuti',  color: 'var(--st-terjadwal)' },
  { key: 'sakit', label: 'Sakit', color: 'var(--st-pelanggaran)' },
  { key: 'izin',  label: 'Izin',  color: 'var(--st-ide)' },
  { key: 'wfh',   label: 'WFH',   color: 'var(--st-siap)' },
];

/**
 * Empat status ini SAMA PERSIS dengan CHECK di tabel leave_requests.
 * Menambah status di sini tanpa mengubah database berarti pengajuannya ditolak
 * saat disimpan, dengan pesan yang tidak menjelaskan apa-apa.
 */
export type StatusCuti = 'menunggu_lead' | 'menunggu_hrd' | 'disetujui' | 'ditolak';

export const STATUS_CUTI: Record<StatusCuti, { label: string; color: string; urut: number }> = {
  menunggu_lead: { label: 'Menunggu Lead', color: 'var(--st-ide)',          urut: 1 },
  menunggu_hrd:  { label: 'Menunggu HRD',  color: 'var(--st-review)',       urut: 2 },
  disetujui:     { label: 'Disetujui',     color: 'var(--green)',           urut: 3 },
  ditolak:       { label: 'Ditolak',       color: 'var(--red)',             urut: 4 },
};

export interface LeaveRequest {
  id: string;
  kind: JenisCuti;
  start_date: string;
  end_date: string;
  reason: string;
  requester_id: string;
  requester_name: string | null;
  status: StatusCuti;
  lead_id: string | null;
  lead_name: string | null;
  lead_at: string | null;
  hrd_id: string | null;
  hrd_name: string | null;
  hrd_at: string | null;
  reject_by: 'lead' | 'hrd' | null;
  reject_reason: string | null;
  /** Dihitung database (end_date - start_date + 1). Hari kalender, bukan hari kerja. */
  hari_kalender: number;
  created_at: string;
  updated_at: string;
}

/** Bentuk ringkas profil orang lain, secukupnya untuk menentukan lead & HRD. */
export interface OrangRingkas {
  id: string;
  nama: string;
  role: Role;
  team: Team | null;
  vertical: string | null;
  /** Atasan yang ditunjuk di Bagan Tim. WAJIB ikut diambil dari query —
   *  tanpa ini penunjukan bagan tidak terbaca dan layar jatuh ke tangga
   *  otomatis, sementara database sudah memakai penunjukannya. */
  lead_id: string | null;
  /** true = cutinya selesai begitu lead menyetujui, tanpa tahap HRD. */
  cuti_lewati_hrd?: boolean;
}

/**
 * Apakah `saya` adalah lead dari `pemohon`?
 *
 * Ini CERMINAN dari fungsi is_lead_for() di database — dipakai hanya untuk
 * menentukan tombol mana yang tampil. Tembok sebenarnya tetap RLS; kalau
 * cerminan ini keliru, UPDATE-nya ditolak database dan mengenai 0 baris.
 * Karena itu setiap penyimpanan tetap memeriksa .select('id').
 *
 * Tangganya:
 *   anggota (role tim)     -> manager di tim yang sama
 *   manager tim biasa      -> manager tim 'ho'
 *   manager tim 'ho'       -> manager tim 'pimpinan'
 *   manager tim 'pimpinan' -> superadmin saja
 */
export function akuLeadUntuk(saya: Profile | null, pemohon: OrangRingkas | null): boolean {
  if (!saya || !pemohon) return false;
  if (saya.role === 'superadmin') return true;
  if (pemohon.id === saya.id) return false;          // tidak menyetujui diri sendiri

  // Atasan yang DITUNJUK di Bagan Tim menang atas tangga otomatis, dan
  // diperiksa SEBELUM syarat peran — persis seperti urutan di is_lead_for().
  //
  // Cabang ini sempat tertinggal waktu Bagan Tim dibuat: database sudah
  // memakai penunjukan, layar masih memakai tangga otomatis. Akibatnya Febry
  // (Pimpinan) ditunjuk jadi atasan Erika & Qintana, database mengizinkan,
  // tapi tombol Setujui tidak pernah muncul — karena tangga otomatis bilang
  // atasan seorang manager itu HO, dan Febry bukan HO.
  if (pemohon.lead_id) return pemohon.lead_id === saya.id;

  if (saya.role !== 'manager') return false;
  if (saya.vertical !== 'ALL' && saya.vertical !== pemohon.vertical) return false;
  if (pemohon.team === 'pimpinan') return false;
  if (pemohon.team === 'ho') return saya.team === 'pimpinan';
  if (pemohon.role === 'manager') return saya.team === 'ho';
  return saya.team === pemohon.team;
}

/** Cerminan is_hrd_for(). HRD unit yang sama; superadmin selalu lolos. */
export function akuHrdUntuk(saya: Profile | null, pemohon: OrangRingkas | null): boolean {
  if (!saya || !pemohon) return false;
  if (saya.role === 'superadmin') return true;
  // Tidak seorang pun memutus pengajuannya sendiri, termasuk HRD.
  //
  // Sempat terlewat: tingkat lead sudah menolaknya sejak awal, tingkat HRD
  // belum. Karena HRD cuma satu orang, dia bisa meloloskan cutinya sendiri di
  // tahap kedua. Sekarang pengajuannya berhenti di antrean HRD sampai
  // superadmin turun tangan — dan memang begitu seharusnya.
  if (pemohon.id === saya.id) return false;
  if (saya.team !== 'hrd') return false;
  if (saya.vertical === 'ALL') return true;
  return saya.vertical === pemohon.vertical;
}

/** Label jenis yang enak dibaca; jatuh ke kodenya kalau ada jenis tak dikenal. */
export function jenisCutiDef(key: string): { key: string; label: string; color: string } {
  const f = JENIS_CUTI.find((j) => j.key === key);
  return f || { key, label: key, color: 'var(--text-3)' };
}

/** Label status; jatuh ke kodenya kalau database punya status yang belum dikenal UI. */
export function statusCutiDef(key: string): { label: string; color: string; urut: number } {
  return STATUS_CUTI[key as StatusCuti] || { label: key, color: 'var(--text-3)', urut: 9 };
}

// ============================================================================
// NOTIFIKASI
//
// Satu baris = satu pemberitahuan untuk SATU orang. Notifikasi hanya lahir dari
// pemicu database; layar tidak punya izin menyisipkan, supaya tidak ada yang
// bisa mengarang pemberitahuan atas nama sistem.
// ============================================================================

export interface Notif {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  /** Kunci menu tujuan saat diklik — nilainya sama dengan View di App.tsx. */
  view: string | null;
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Lambang & warna per jenis notifikasi. Jenis tak dikenal tetap tampil, pakai bawaan. */
export const NOTIF_META: Record<string, { ikon: string; warna: string }> = {
  cuti_antrean:       { ikon: '🗓', warna: 'var(--st-ide)' },
  cuti_putus:         { ikon: '🗓', warna: 'var(--st-terjadwal)' },
  lembur_antrean:     { ikon: '⏱', warna: 'var(--st-ide)' },
  lembur_putus:       { ikon: '⏱', warna: 'var(--st-terjadwal)' },
  budget_antrean:     { ikon: '💰', warna: 'var(--st-ide)' },
  budget_putus:       { ikon: '💰', warna: 'var(--st-terjadwal)' },
  konten_pic:         { ikon: '🎬', warna: 'var(--accent)' },
  konten_pelanggaran: { ikon: '⚠️', warna: 'var(--red)' },
  chat_pesan:         { ikon: '💬', warna: 'var(--st-siap)' },
  chat_join:          { ikon: '🙋', warna: 'var(--st-ide)' },
  chat_join_putus:    { ikon: '🙋', warna: 'var(--st-terjadwal)' },
  komplain_baru:      { ikon: '📣', warna: 'var(--st-review)' },
  komplain_balas:     { ikon: '📣', warna: 'var(--st-review)' },
};

export function notifMeta(kind: string): { ikon: string; warna: string } {
  return NOTIF_META[kind] || { ikon: '🔔', warna: 'var(--text-3)' };
}
