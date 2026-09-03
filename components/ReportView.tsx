'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  STATUSES, initials, statusDef,
  type ContentRow, type Project, type TeamMember, type Team,
} from '@/lib/types';

interface Props {
  projects: Project[];
  projectFilter: string;
}

type Period = 'month' | 'last30' | 'quarter' | 'all';

const PERIODS: [Period, string][] = [
  ['month', 'Bulan ini'],
  ['last30', '30 Hari'],
  ['quarter', '3 Bulan'],
  ['all', 'Semua'],
];

const TEAM_FILTERS: (Team | 'all')[] = ['all', 'creative', 'distribution', 'ads', 'delta'];

interface Stat {
  member: TeamMember;
  total: number;
  perStatus: Record<string, number>;
  published: number;
  belumTayang: number;
  late: number;
}

/**
 * Sudah tayang atau belum.
 *
 * Published & Diiklankan jelas sudah. Yang perlu aturan sendiri adalah
 * PELANGGARAN — statusnya bukan tahap, tapi keadaan: sebagian kena setelah
 * konten naik, sebagian kena sebelum sempat naik.
 *
 * Terverifikasi 3 September 2026: dari 31 konten berstatus pelanggaran,
 * 23 punya link post (memang sudah sempat tayang) dan 8 tidak. Jadi
 * memasukkan semuanya ke "belum tayang" salah, memasukkan semuanya ke
 * "sudah tayang" juga salah. Yang dipakai: link post-nya terisi atau tidak.
 *
 * Konsekuensi yang perlu diingat: angka ini bisa berubah sendiri kalau ada
 * yang mengisi link post konten pelanggaran belakangan. Itu memang
 * disengaja — begitu linknya ada, kontennya memang terbukti pernah tayang.
 */
const sudahTayang = (r: ContentRow) => {
  if (r.status === 'published' || r.status === 'diiklankan') return true;
  if (r.status !== 'pelanggaran') return false;
  return !!r.post_url && r.post_url.trim() !== '';
};

export default function ReportView({ projects, projectFilter }: Props) {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('month');
  const [teamFilter, setTeamFilter] = useState<Team | 'all'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [c, m] = await Promise.all([
      supabase.from('contents').select('*'),
      supabase.from('team_members').select('*').order('team').order('name'),
    ]);
    setRows((c.data as ContentRow[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startDate = useMemo(() => {
    const now = new Date();
    if (period === 'all') return null;
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - (period === 'last30' ? 29 : 89));
    return d;
  }, [period]);

  const scoped = useMemo(
    () =>
      rows.filter((r) => {
        if (projectFilter !== 'all' && r.project_id !== projectFilter) return false;
        if (startDate && new Date(r.created_at) < startDate) return false;
        return true;
      }),
    [rows, projectFilter, startDate]
  );

  const picIdsOf = (r: ContentRow) =>
    [r.pic_creative, r.pic_distribution, r.pic_ads].filter(Boolean) as string[];

  const stats: Stat[] = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return members
      .filter((m) => (teamFilter === 'all' || m.team === teamFilter))
      .filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()))
      .map((m) => {
        const mine = scoped.filter((r) => picIdsOf(r).includes(m.id));
        const perStatus: Record<string, number> = {};
        for (const s of STATUSES) perStatus[s.key] = 0;
        let published = 0;
        let late = 0;
        for (const r of mine) {
          perStatus[r.status] = (perStatus[r.status] || 0) + 1;
          if (sudahTayang(r)) published++;
          // Konten yang sudah tayang tidak lagi dihitung lewat deadline —
          // termasuk pelanggaran yang terbukti sempat naik. Kalau tidak,
          // orangnya dihukum dua kali untuk konten yang sebenarnya selesai.
          if (r.deadline && r.deadline < todayStr && !sudahTayang(r)) late++;
        }
        return {
          member: m, total: mine.length, perStatus,
          published, belumTayang: mine.length - published, late,
        };
      })
      .sort((a, b) => b.total - a.total || a.member.name.localeCompare(b.member.name));
  }, [members, scoped, teamFilter, search]);

  const totals = useMemo(() => {
    const assigned = scoped.filter((r) => picIdsOf(r).length > 0).length;
    const published = scoped.filter(sudahTayang).length;
    return {
      konten: scoped.length,
      assigned,
      belumAssign: scoped.length - assigned,
      published,
      belumTayang: scoped.length - published,
    };
  }, [scoped]);

  const accLabel =
    projectFilter === 'all'
      ? 'semua project'
      : projects.find((p) => p.id === projectFilter)?.name || 'project';

  const exportCsv = () => {
    const head = ['Nama', 'Tim', 'Total', ...STATUSES.map((s) => s.label), 'Tayang', 'Belum tayang', 'Lewat deadline'];
    const lines = stats.map((s) =>
      [
        s.member.name,
        s.member.team,
        s.total,
        ...STATUSES.map((st) => s.perStatus[st.key] || 0),
        s.published,
        s.belumTayang,
        s.late,
      ].join(',')
    );
    const csv = [head.join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-kerja-alpha-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Laporan Kerja</h2>
          <span className="top-note">rekap konten · {accLabel}</span>
        </div>
        <div className="top-actions">
          <input
            className="search-input"
            placeholder="Cari nama…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" onClick={exportCsv} disabled={stats.length === 0}>↓ Ekspor CSV</button>
        </div>
      </div>

      <div className="div-desc">
        <span className="bar" style={{ background: 'var(--accent)' }} />
        <span className="div-name">Rekap PIC</span>
        <span>· Dihitung dari konten yang PIC-nya orang tersebut (Creative / Distribution / Ads).</span>
        <div className="range-tabs">
          {PERIODS.map(([k, label]) => (
            <button key={k} className={`range-tab ${period === k ? 'active' : ''}`} onClick={() => setPeriod(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="content-area">
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-label">Total konten</div><div className="kpi-value">{totals.konten}</div></div>
          <div className="kpi"><div className="kpi-label">Sudah ada PIC</div><div className="kpi-value">{totals.assigned}</div></div>
          <div className="kpi"><div className="kpi-label">Belum ada PIC</div><div className="kpi-value" style={{ color: totals.belumAssign ? 'var(--amber)' : undefined }}>{totals.belumAssign}</div></div>
          <div className="kpi"><div className="kpi-label">Sudah tayang</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{totals.published}</div></div>
          <div className="kpi"><div className="kpi-label">Belum tayang</div><div className="kpi-value" style={{ color: totals.belumTayang ? 'var(--st-drafting)' : undefined }}>{totals.belumTayang}</div></div>
        </div>

        <div className="team-filter">
          {TEAM_FILTERS.map((t) => (
            <button key={t} className={`chip-btn ${teamFilter === t ? 'active' : ''}`} onClick={() => setTeamFilter(t)}>
              {t === 'all' ? 'Semua tim' : t}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? (
            <p className="empty">Memuat laporan…</p>
          ) : stats.length === 0 ? (
            <p className="empty">Tidak ada anggota yang cocok dengan filter.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Anggota</th>
                  <th>Total</th>
                  {STATUSES.map((s) => <th key={s.key}>{s.label}</th>)}
                  <th>Tayang</th>
                  <th>Belum tayang</th>
                  <th>Lewat deadline</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.member.id}>
                    <td>
                      <span className="row-avatar">{initials(s.member.name)}</span>
                      <b>{s.member.name}</b>
                      <div className="sub" style={{ marginLeft: 40 }}>{s.member.team}</div>
                    </td>
                    <td><b>{s.total}</b></td>
                    {STATUSES.map((st) => (
                      <td key={st.key} style={{ color: s.perStatus[st.key] ? statusDef(st.key).color : 'var(--text-3)' }}>
                        {s.perStatus[st.key] || '—'}
                      </td>
                    ))}
                    <td style={{ color: s.published ? 'var(--green)' : 'var(--text-3)' }}>{s.published || '—'}</td>
                    <td style={{ color: s.belumTayang ? 'var(--st-drafting)' : 'var(--text-3)' }}>{s.belumTayang || '—'}</td>
                    <td style={{ color: s.late ? 'var(--red)' : 'var(--text-3)' }}>{s.late || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="cal-legend">
          Satu konten bisa dihitung untuk beberapa orang jika PIC Creative, Distribution, dan Ads-nya berbeda —
          angka per orang menggambarkan keterlibatan, bukan pembagian jatah.
          <br />
          <b>Tayang</b> = Published, Diiklankan, dan Pelanggaran yang link post-nya sudah terisi — pelanggaran
          memang sebagian kena setelah konten naik. <b>Belum tayang</b> = Total dikurangi Tayang.
        </p>
      </div>
    </>
  );
}
