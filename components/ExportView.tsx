'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { downloadXlsx, type XlsxSheet } from '@/lib/xlsx';
import {
  PILLAR_LABEL, platformDef, statusDef,
  type Account, type ContentCategory, type ContentStatus, type Profile, type Project,
} from '@/lib/types';

/**
 * Ekspor data Alpha ke satu berkas .xlsx.
 *
 * Tiap modul jadi satu sheet terpisah. Jumlah baris dihitung DULU sebelum
 * diunduh supaya tidak ada kejutan berkas kosong — ini permintaan langsung
 * dari Mas Dik: "setelah dipencet export, muncul apa yang mau diekspor".
 *
 * Catatan penting soal ID: kolom seperti project_id / account_id / category_id
 * SELALU diterjemahkan jadi nama sebelum ditulis ke Excel. Kalau tidak, isi
 * berkasnya penuh UUID dan tidak ada gunanya buat orang non-teknis.
 */

// -------------------------------------------------------------- util tanggal

/** Tanggal lokal (WIB), bukan UTC. toISOString() menggeser konten larut malam. */
function dayStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayStr(d);
}

function firstOfMonth(): string {
  const d = new Date();
  return dayStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

type RangeKey = 'all' | 'today' | 'd7' | 'd30' | 'month' | 'custom';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'today', label: 'Hari ini' },
  { key: 'd7', label: '7 hari' },
  { key: 'd30', label: '30 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'custom', label: 'Pilih tanggal' },
];

// ------------------------------------------------------------------- modul

type ModKey =
  | 'konten' | 'request' | 'lembur' | 'budget'
  | 'sebaran' | 'komplain' | 'recap' | 'akun' | 'anggota';

interface ModuleDef {
  key: ModKey;
  label: string;
  sheet: string;
  table: string;
  /** Kolom tanggal yang dipakai untuk penyaringan rentang. null = tidak bisa disaring tanggal. */
  dateCol: string | null;
  /** Punya kolom project_id atau tidak. Komplain misalnya tidak punya. */
  hasProject: boolean;
  desc: string;
}

const MODULES: ModuleDef[] = [
  {
    key: 'konten', label: 'Konten (Board Pipeline)', sheet: 'Konten',
    table: 'contents', dateCol: 'publish_date', hasProject: true,
    desc: 'Disaring berdasarkan Tanggal tayang',
  },
  {
    key: 'request', label: 'Request Konten', sheet: 'Request Konten',
    table: 'content_requests', dateCol: 'created_at', hasProject: true,
    desc: 'Permintaan konten dari Project Manager',
  },
  {
    key: 'lembur', label: 'Lembur', sheet: 'Lembur',
    table: 'overtime_requests', dateCol: 'work_date', hasProject: true,
    desc: 'Disaring berdasarkan tanggal kerja',
  },
  {
    key: 'budget', label: 'Pengajuan Budget', sheet: 'Budget',
    table: 'budget_requests', dateCol: 'created_at', hasProject: true,
    desc: 'Termasuk status persetujuan & pembayaran',
  },
  {
    key: 'sebaran', label: 'Sebaran Harian', sheet: 'Sebaran Harian',
    table: 'distribution_logs', dateCol: 'created_at', hasProject: true,
    desc: 'Laporan sebaran per grup',
  },
  {
    key: 'komplain', label: 'Komplain', sheet: 'Komplain',
    table: 'complaints', dateCol: 'created_at', hasProject: false,
    desc: 'Tidak terikat project — filter project diabaikan',
  },
  {
    key: 'recap', label: 'Recap Report', sheet: 'Recap Report',
    table: 'recap_reports', dateCol: 'created_at', hasProject: true,
    desc: 'Daftar berkas rekap yang diunggah',
  },
  {
    key: 'akun', label: 'Akun Media', sheet: 'Akun Media',
    table: 'accounts', dateCol: null, hasProject: true,
    desc: 'Data induk — tidak terpengaruh rentang tanggal',
  },
  {
    key: 'anggota', label: 'Anggota Tim', sheet: 'Anggota Tim',
    table: 'team_members', dateCol: null, hasProject: false,
    desc: 'Data induk — tidak terpengaruh project & tanggal',
  },
];

const DEFAULT_PICK: ModKey[] = ['konten'];

// -------------------------------------------------------------------- UI

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="range-tab"
      style={{
        padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-2)',
      }}
    >
      {label}
    </button>
  );
}

interface Props {
  profile: Profile | null;
  projects: Project[];
  accounts: Account[];
  projectFilter: string;
}

export default function ExportView({ profile, projects, accounts, projectFilter }: Props) {
  const [projectId, setProjectId] = useState<string>(projectFilter || 'all');
  const [range, setRange] = useState<RangeKey>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<ModKey[]>(DEFAULT_PICK);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Sidebar berganti project → ikut berubah, kecuali user sudah memilih sendiri.
  useEffect(() => { setProjectId(projectFilter || 'all'); }, [projectFilter]);

  const bounds = useMemo<{ from: string | null; to: string | null }>(() => {
    const today = dayStr(new Date());
    switch (range) {
      case 'today': return { from: today, to: today };
      case 'd7': return { from: shiftDays(6), to: today };
      case 'd30': return { from: shiftDays(29), to: today };
      case 'month': return { from: firstOfMonth(), to: today };
      case 'custom': return { from: from || null, to: to || null };
      default: return { from: null, to: null };
    }
  }, [range, from, to]);

  /**
   * Menyusun query dasar sebuah modul. Dipakai bersama oleh penghitung jumlah
   * dan pengambil data — supaya angka yang ditampilkan dan isi berkas TIDAK
   * mungkin berbeda aturan penyaringannya.
   */
  const buildQuery = useCallback((m: ModuleDef, headOnly: boolean) => {
    let q = headOnly
      ? supabase.from(m.table).select('*', { count: 'exact', head: true })
      : supabase.from(m.table).select('*');

    if (m.hasProject && projectId !== 'all') q = q.eq('project_id', projectId);

    if (m.dateCol && bounds.from) {
      // created_at bertipe timestamp — batas atas ditambah satu hari penuh,
      // kalau tidak, data hari terakhir jam 10 pagi ikut terbuang.
      const isTs = m.dateCol === 'created_at';
      q = q.gte(m.dateCol, isTs ? `${bounds.from}T00:00:00` : bounds.from);
      if (bounds.to) q = q.lte(m.dateCol, isTs ? `${bounds.to}T23:59:59.999` : bounds.to);
    }
    return q;
  }, [projectId, bounds]);

  // Hitung ulang jumlah baris tiap kali filter berubah.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setCounting(true);
      const next: Record<string, number | null> = {};
      await Promise.all(MODULES.map(async (m) => {
        try {
          const { count, error } = await buildQuery(m, true);
          next[m.key] = error ? null : (count ?? 0);
        } catch {
          next[m.key] = null;
        }
      }));
      if (!cancelled) { setCounts(next); setCounting(false); }
    };
    void run();
    return () => { cancelled = true; };
  }, [buildQuery]);

  const toggle = (k: ModKey) =>
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const allPicked = picked.length === MODULES.length;
  const toggleAll = () => setPicked(allPicked ? [] : MODULES.map((m) => m.key));

  const totalRows = picked.reduce((a, k) => a + (counts[k] ?? 0), 0);

  // ------------------------------------------------------- penerjemah ID

  const projName = useCallback(
    (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? '(project terhapus)') : ''),
    [projects],
  );
  const accHandle = useCallback(
    (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.handle ?? '(akun terhapus)') : ''),
    [accounts],
  );

  const doExport = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      // Kategori diambil sekali di sini, bukan di dalam perulangan — supaya
      // tidak memanggil database berkali-kali untuk hal yang sama.
      const { data: catData } = await supabase.from('content_categories').select('*');
      const cats = (catData as ContentCategory[]) || [];
      const catName = (id: string | null) =>
        id ? (cats.find((c) => c.id === id)?.name ?? '(kategori terhapus)') : '';

      const sheets: XlsxSheet[] = [];
      const gagal: string[] = [];

      for (const m of MODULES) {
        if (!picked.includes(m.key)) continue;
        const { data, error } = await buildQuery(m, false);
        if (error) { gagal.push(`${m.label} (${error.message})`); continue; }
        const rows = (data as Record<string, unknown>[]) || [];
        sheets.push(sheetFor(m, rows, { projName, accHandle, catName }));
      }

      if (!sheets.length) {
        setErr(gagal.length
          ? `Tidak ada yang bisa diekspor. Gagal: ${gagal.join('; ')}`
          : 'Tidak ada data pada filter ini.');
        setBusy(false);
        return;
      }

      const namaProject = projectId === 'all' ? 'Semua-Project' : projName(projectId).replace(/\s+/g, '-');
      const stamp = dayStr(new Date());
      await downloadXlsx(`Alpha_${namaProject}_${stamp}.xlsx`, sheets);

      const jumlah = sheets.reduce((a, s) => a + s.rows.length, 0);
      setMsg(
        `Berhasil: ${sheets.length} sheet, ${jumlah.toLocaleString('id-ID')} baris.` +
        (gagal.length ? ` Dilewati: ${gagal.join('; ')}` : ''),
      );
    } catch (e) {
      setErr(`Gagal membuat berkas: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const canExport = !busy && picked.length > 0 && totalRows > 0;

  return (
    <>
      <div className="topbar">
        <h2>Ekspor Data</h2>
        <span className="top-note">
          {counting ? 'menghitung…' : `${totalRows.toLocaleString('id-ID')} baris siap diekspor`}
        </span>
      </div>

      <div className="content-area">
        <div className="table-wrap" style={{ padding: 18, marginBottom: 16 }}>

          {/* ---- Project ---- */}
          <div className="section-label" style={{ marginTop: 0 }}>Project</div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{
              width: '100%', maxWidth: 380, padding: '9px 12px', borderRadius: 9,
              background: 'var(--raised)', border: '1px solid var(--border-strong)',
              marginBottom: 18,
            }}
          >
            <option value="all">Semua project ({projects.length} aktif)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.vertical ? ` — ${p.vertical}` : ''}
              </option>
            ))}
          </select>

          {/* ---- Rentang ---- */}
          <div className="section-label">Rentang tanggal</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {RANGES.map((r) => (
              <Chip key={r.key} active={range === r.key} label={r.label} onClick={() => setRange(r.key)} />
            ))}
          </div>

          {range === 'custom' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--raised)', border: '1px solid var(--border-strong)' }} />
              <span style={{ color: 'var(--text-3)' }}>sampai</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--raised)', border: '1px solid var(--border-strong)' }} />
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
            Tiap modul disaring pakai kolom tanggalnya sendiri — konten pakai Tanggal tayang,
            lembur pakai tanggal kerja. Konten yang belum punya Tanggal tayang hanya ikut
            kalau rentangnya <strong>Semua</strong>.
          </p>
        </div>

        {/* ---- Pilihan modul ---- */}
        <div className="table-wrap" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div className="section-label" style={{ margin: 0 }}>Pilih data yang mau diekspor</div>
            <button className="btn ghost" style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }}
              onClick={toggleAll}>
              {allPicked ? 'Kosongkan semua' : 'Pilih semua'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {MODULES.map((m) => {
              const n = counts[m.key];
              const on = picked.includes(m.key);
              const kosong = n === 0;
              return (
                <label
                  key={m.key}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11, cursor: 'pointer',
                    padding: '11px 13px', borderRadius: 10,
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    background: on ? 'var(--accent-soft)' : 'var(--raised)',
                    opacity: n === null ? 0.55 : 1,
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(m.key)} style={{ marginTop: 2 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{m.desc}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap',
                    color: n === null ? 'var(--red)' : kosong ? 'var(--text-3)' : 'var(--text-2)' }}>
                    {counting && n === undefined ? '…'
                      : n === null ? 'tabel tidak terbaca'
                      : `${n.toLocaleString('id-ID')} baris`}
                  </div>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={!canExport} onClick={doExport}
              style={{ opacity: canExport ? 1 : 0.5 }}>
              {busy ? 'Menyiapkan berkas…' : '⤓ Unduh Excel'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {picked.length === 0 ? 'Belum ada yang dicentang'
                : totalRows === 0 ? 'Tidak ada baris pada filter ini'
                : `${picked.length} sheet · ${totalRows.toLocaleString('id-ID')} baris`}
            </span>
          </div>

          {msg && <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--green)' }}>{msg}</p>}
          {err && <p style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)' }}>{err}</p>}

          <p style={{ marginTop: 14, fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
            Berkas dibuat langsung di browser — tidak ada data yang dikirim ke pihak ketiga.
            Format .xlsx, bisa dibuka di Excel maupun Google Sheets.
            {profile?.role !== 'superadmin' && profile?.role !== 'manager' &&
              ' Isi berkas mengikuti hak akses akunmu, jadi bisa lebih sedikit dari data sebenarnya.'}
          </p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------- pemetaan kolom sheet

interface Lookups {
  projName: (id: string | null) => string;
  accHandle: (id: string | null) => string;
  catName: (id: string | null) => string;
}

/** Ambil nilai apa adanya, ubah null jadi string kosong biar sel Excel bersih. */
const v = (r: Record<string, unknown>, k: string): unknown => {
  const x = r[k];
  return x === null || x === undefined ? '' : x;
};

const ya = (x: unknown) => (x ? 'Ya' : 'Tidak');

/** Potong 'T' pada timestamp supaya kolom tanggal terbaca enak di Excel. */
const tgl = (x: unknown) => (typeof x === 'string' ? x.slice(0, 10) : '');
const tglJam = (x: unknown) => (typeof x === 'string' ? x.slice(0, 16).replace('T', ' ') : '');

function sheetFor(m: ModuleDef, rows: Record<string, unknown>[], L: Lookups): XlsxSheet {
  switch (m.key) {
    case 'konten':
      return {
        name: m.sheet,
        columns: [
          { header: 'Judul', key: 'title', width: 46 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Akun', key: 'akun', width: 20 },
          { header: 'Platform', key: 'platform', width: 13 },
          { header: 'Kategori', key: 'kategori', width: 18 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Tanggal Tayang', key: 'tayang', width: 15 },
          { header: 'PIC Copywriter', key: 'pic_cw', width: 18 },
          { header: 'PIC Content', key: 'pic_cr', width: 18 },
          { header: 'PIC Distribution', key: 'pic_ds', width: 18 },
          { header: 'PIC Ads', key: 'pic_ad', width: 18 },
          { header: 'Link Drive', key: 'drive', width: 34 },
          { header: 'Link Post', key: 'post', width: 34 },
          { header: 'Kode Ads', key: 'ads', width: 16 },
          { header: 'Caption', key: 'caption', width: 52 },
          { header: 'Hashtag', key: 'hashtags', width: 30 },
          { header: 'Visual Hook', key: 'hook', width: 30 },
          { header: 'Potensi FYP', key: 'fyp', width: 12 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
          { header: 'Pillar (lama)', key: 'pillar', width: 16 },
        ],
        rows: rows.map((r) => ({
          title: v(r, 'title'),
          project: L.projName(r.project_id as string | null),
          akun: L.accHandle(r.account_id as string | null),
          platform: platformDef(r.platform as string | null)?.label ?? '',
          kategori: L.catName(r.category_id as string | null),
          status: statusDef(r.status as ContentStatus).label,
          tayang: v(r, 'publish_date'),
          pic_cw: v(r, 'pic_copywriter'),
          pic_cr: v(r, 'pic_creative'),
          pic_ds: v(r, 'pic_distribution'),
          pic_ad: v(r, 'pic_ads'),
          drive: v(r, 'asset_url'),
          post: v(r, 'post_url'),
          ads: v(r, 'ads_code'),
          caption: v(r, 'caption'),
          hashtags: v(r, 'hashtags'),
          hook: v(r, 'visual_hook'),
          fyp: ya(r.potensi_fyp),
          dibuat: tglJam(r.created_at),
          pillar: PILLAR_LABEL[r.pillar as keyof typeof PILLAR_LABEL] ?? '',
        })),
      };

    case 'request':
      return {
        name: m.sheet,
        columns: [
          { header: 'Judul', key: 'title', width: 44 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Akun', key: 'akun', width: 20 },
          { header: 'Tanggal Diminta', key: 'diminta', width: 16 },
          { header: 'Pengaju', key: 'pengaju', width: 22 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Catatan', key: 'note', width: 44 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
        ],
        rows: rows.map((r) => ({
          title: v(r, 'title'),
          project: L.projName(r.project_id as string | null),
          akun: L.accHandle(r.account_id as string | null),
          diminta: v(r, 'requested_date'),
          pengaju: v(r, 'requester_name'),
          status: v(r, 'status'),
          note: v(r, 'note'),
          dibuat: tglJam(r.created_at),
        })),
      };

    case 'lembur':
      return {
        name: m.sheet,
        columns: [
          { header: 'Tanggal Kerja', key: 'tanggal', width: 15 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Pengaju', key: 'pengaju', width: 22 },
          { header: 'Mulai', key: 'mulai', width: 10 },
          { header: 'Selesai', key: 'selesai', width: 10 },
          { header: 'Uraian', key: 'uraian', width: 52 },
          { header: 'Status', key: 'status', width: 13 },
          { header: 'Penyetuju', key: 'approver', width: 22 },
          { header: 'Diputus', key: 'diputus', width: 17 },
          { header: 'Alasan Ditolak', key: 'alasan', width: 30 },
        ],
        rows: rows.map((r) => ({
          tanggal: v(r, 'work_date'),
          project: L.projName(r.project_id as string | null),
          pengaju: v(r, 'requester_name'),
          mulai: v(r, 'start_time'),
          selesai: v(r, 'end_time'),
          uraian: v(r, 'description'),
          status: v(r, 'status'),
          approver: v(r, 'approver_name'),
          diputus: tglJam(r.decided_at),
          alasan: v(r, 'reject_reason'),
        })),
      };

    case 'budget':
      return {
        name: m.sheet,
        columns: [
          { header: 'Judul', key: 'title', width: 36 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Kategori', key: 'kategori', width: 18 },
          { header: 'Nominal', key: 'amount', width: 16 },
          { header: 'Urgensi', key: 'urgensi', width: 12 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Pengaju', key: 'pengaju', width: 20 },
          { header: 'Penyetuju', key: 'approver', width: 20 },
          { header: 'Disetujui', key: 'approved', width: 17 },
          { header: 'Pembayar', key: 'payer', width: 20 },
          { header: 'Dibayar', key: 'paid', width: 17 },
          { header: 'Alasan Ditolak', key: 'alasan', width: 28 },
          { header: 'Uraian', key: 'desc', width: 44 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
        ],
        rows: rows.map((r) => ({
          title: v(r, 'title'),
          project: L.projName(r.project_id as string | null),
          kategori: v(r, 'category'),
          // Sengaja dibiarkan angka, bukan teks "Rp ..." — supaya bisa dijumlah di Excel.
          amount: typeof r.amount === 'number' ? r.amount : Number(r.amount ?? 0),
          urgensi: v(r, 'urgency'),
          status: v(r, 'status'),
          pengaju: v(r, 'requester_name'),
          approver: v(r, 'approver_name'),
          approved: tglJam(r.approved_at),
          payer: v(r, 'payer_name'),
          paid: tglJam(r.paid_at),
          alasan: v(r, 'reject_reason'),
          desc: v(r, 'description'),
          dibuat: tglJam(r.created_at),
        })),
      };

    case 'sebaran':
      return {
        name: m.sheet,
        columns: [
          { header: 'Tanggal', key: 'tanggal', width: 15 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Platform', key: 'platform', width: 14 },
          { header: 'Kategori Konten', key: 'kategori', width: 20 },
          { header: 'Nama Grup', key: 'grup', width: 46 },
          { header: 'Jumlah Grup', key: 'jml', width: 13 },
          { header: 'Link Konten', key: 'url', width: 38 },
          { header: 'Pelapor', key: 'pelapor', width: 20 },
          { header: 'Catatan', key: 'note', width: 36 },
        ],
        rows: rows.map((r) => ({
          tanggal: tgl(r.created_at),
          project: L.projName(r.project_id as string | null),
          platform: v(r, 'platform'),
          kategori: v(r, 'content_category'),
          grup: v(r, 'group_names'),
          jml: typeof r.group_count === 'number' ? r.group_count : Number(r.group_count ?? 0),
          url: v(r, 'content_url'),
          pelapor: v(r, 'reporter_name'),
          note: v(r, 'note'),
        })),
      };

    case 'komplain':
      return {
        name: m.sheet,
        columns: [
          { header: 'Judul', key: 'title', width: 40 },
          { header: 'Kategori', key: 'kategori', width: 18 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Pelapor', key: 'pelapor', width: 22 },
          { header: 'Penangan', key: 'handler', width: 22 },
          { header: 'Detail', key: 'detail', width: 52 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
          { header: 'Selesai', key: 'selesai', width: 17 },
        ],
        rows: rows.map((r) => ({
          title: v(r, 'title'),
          kategori: v(r, 'category'),
          status: v(r, 'status'),
          pelapor: v(r, 'reporter_name'),
          handler: v(r, 'handler_name'),
          detail: v(r, 'detail'),
          dibuat: tglJam(r.created_at),
          selesai: tglJam(r.resolved_at),
        })),
      };

    case 'recap':
      return {
        name: m.sheet,
        columns: [
          { header: 'Judul', key: 'title', width: 40 },
          { header: 'Project', key: 'project', width: 20 },
          { header: 'Periode', key: 'periode', width: 18 },
          { header: 'Nama Berkas', key: 'file', width: 34 },
          { header: 'Ukuran (KB)', key: 'size', width: 13 },
          { header: 'Link', key: 'link', width: 38 },
          { header: 'Diunggah oleh', key: 'oleh', width: 22 },
          { header: 'Catatan', key: 'note', width: 40 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
        ],
        rows: rows.map((r) => ({
          title: v(r, 'title'),
          project: L.projName(r.project_id as string | null),
          periode: v(r, 'period'),
          file: v(r, 'file_name'),
          size: typeof r.file_size === 'number' ? Math.round(r.file_size / 1024) : '',
          link: v(r, 'link_url'),
          oleh: v(r, 'uploader_name'),
          note: v(r, 'note'),
          dibuat: tglJam(r.created_at),
        })),
      };

    case 'akun':
      return {
        name: m.sheet,
        columns: [
          { header: 'Handle', key: 'handle', width: 26 },
          { header: 'Label', key: 'label', width: 22 },
          { header: 'Project', key: 'project', width: 22 },
          { header: 'Aktif', key: 'aktif', width: 10 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
        ],
        rows: rows.map((r) => ({
          handle: v(r, 'handle'),
          label: v(r, 'label'),
          project: L.projName(r.project_id as string | null),
          aktif: ya(r.is_active),
          dibuat: tglJam(r.created_at),
        })),
      };

    case 'anggota':
    default:
      return {
        name: m.sheet,
        columns: [
          { header: 'Nama', key: 'nama', width: 26 },
          { header: 'Tim', key: 'tim', width: 16 },
          { header: 'Aktif', key: 'aktif', width: 10 },
          { header: 'Dibuat', key: 'dibuat', width: 17 },
        ],
        rows: rows.map((r) => ({
          nama: v(r, 'name'),
          tim: v(r, 'team'),
          aktif: ya(r.is_active),
          dibuat: tglJam(r.created_at),
        })),
      };
  }
}
