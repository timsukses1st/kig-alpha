export type Role = 'superadmin' | 'manager' | 'tim';
export type Team = 'delta' | 'creative' | 'distribution' | 'ads' | 'pm' | 'finance';
export type ContentStatus =
  | 'drafting' | 'review'
  | 'siap_upload' | 'terjadwal'
  | 'published' | 'diiklankan';
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
}

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

export interface OvertimeRequest {
  id: string;
  project_id: string | null;
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
  { key: 'published', label: 'Published', ownerTeam: 'ads', color: 'var(--st-published)' },
  { key: 'diiklankan', label: 'Diiklankan', ownerTeam: 'ads', color: 'var(--st-diiklankan)' },
];

export const DIVISIONS: { key: Division; label: string; color: string; desc: string; statuses: ContentStatus[] }[] = [
  {
    key: 'semua', label: 'Semua', color: 'var(--accent)',
    desc: 'Semua konten lintas divisi — cari & edit tanpa pindah papan.',
    statuses: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan'],
  },
  {
    key: 'creative', label: 'Creative', color: 'var(--st-ide)',
    desc: 'Drafting → Review → ACC lead. Menyiapkan brief, copywriting, dan aset final.',
    statuses: ['drafting', 'review'],
  },
  {
    key: 'distribution', label: 'Distribution', color: 'var(--st-terjadwal)',
    desc: 'Siap Upload → Terjadwal → Published. Menyusun caption, media, dan menayangkan.',
    statuses: ['siap_upload', 'terjadwal'],
  },
  {
    key: 'ads', label: 'Ads', color: 'var(--st-diiklankan)',
    desc: 'Published → Diiklankan. Mengelola boosting dan kode ads.',
    statuses: ['published', 'diiklankan'],
  },
];

export const TEAM_EDITABLE: Record<Team, ContentStatus[]> = {
  delta: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan'],
  creative: ['drafting', 'review'],
  distribution: ['siap_upload', 'terjadwal'],
  ads: ['published', 'diiklankan'],
  pm: [],
  finance: [],
};

export const TEAM_TARGETABLE: Record<Team, ContentStatus[]> = {
  delta: ['drafting', 'review', 'siap_upload', 'terjadwal', 'published', 'diiklankan'],
  creative: ['drafting', 'review'],
  distribution: ['siap_upload', 'terjadwal', 'published'],
  ads: ['published', 'diiklankan'],
  pm: [],
  finance: [],
};

export function canEditRow(profile: Profile | null, status: ContentStatus): boolean {
  if (!profile || !profile.is_active) return false;
  if (profile.role === 'superadmin' || profile.role === 'manager') return true;
  if (!profile.team) return false;
  return TEAM_EDITABLE[profile.team].includes(status);
}

export function targetableStatuses(profile: Profile | null, current: ContentStatus): ContentStatus[] {
  if (!profile) return [current];
  if (profile.role === 'superadmin' || profile.role === 'manager') return STATUSES.map((s) => s.key);
  if (!profile.team) return [current];
  const targets = TEAM_TARGETABLE[profile.team];
  return targets.includes(current) ? targets : [current];
}

export function statusDef(key: ContentStatus): StatusDef {
  return STATUSES.find((s) => s.key === key) || STATUSES[0];
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}
