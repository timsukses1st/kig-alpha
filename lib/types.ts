export type Role = 'superadmin' | 'manager' | 'tim';
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

/** Peran yang bebas memindahkan status apa pun. */
function bebasPindahStatus(profile: Profile): boolean {
  if (profile.role === 'superadmin') return true;
  if (profile.role !== 'manager') return false;
  return !!profile.team && TIM_KONTEN.includes(profile.team);
}

/**
 * Boleh membuat konten baru (termasuk mengangkat request jadi konten).
 *
 * Cerminan dari policy `contents_insert` di database. Dua-duanya harus selalu
 * diubah berbarengan — kalau layar menawarkan tombol yang ditolak database,
 * pengguna cuma melihat kegagalan tanpa tahu sebabnya.
 */
export function canCreateContent(profile: Profile | null): boolean {
  if (!profile || !profile.is_active) return false;
  if (bebasPindahStatus(profile)) return true;
  return profile.role === 'tim' && (profile.team === 'creative' || profile.team === 'delta');
}

/**
 * Boleh menghapus konten, dan boleh menarik status mundur.
 *
 * Disamakan dengan aturan memindahkan status (keputusan Mas Dik 21 Agustus):
 * janggal kalau seseorang tidak boleh menggeser status tapi boleh menghapus
 * barisnya sekalian. Cerminan dari policy `contents_delete`.
 */
export function canDeleteContent(profile: Profile | null): boolean {
  if (!profile || !profile.is_active) return false;
  return bebasPindahStatus(profile);
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
  if (!profile || !profile.is_active) return false;
  if (profile.role === 'superadmin') return true;
  return profile.role === 'manager' && profile.team === 'pm';
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
  if (bebasPindahStatus(profile)) return true;
  if (!profile.team) return false;
  // `?? []` penting: kalau ada nilai enum baru ditambahkan di database tapi
  // file ini belum ikut ter-deploy, tanpa ini barisnya jadi undefined.includes()
  // dan seluruh Board error untuk pemilik tim tersebut.
  return (TEAM_EDITABLE[profile.team] ?? []).includes(status);
}

export function targetableStatuses(profile: Profile | null, current: ContentStatus): ContentStatus[] {
  if (!profile) return [current];
  if (bebasPindahStatus(profile)) return STATUSES.map((s) => s.key);
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
