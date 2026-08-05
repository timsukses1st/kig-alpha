'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  DIVISIONS, STATUSES,
  canEditRow, statusDef, tagColor, targetableStatuses,
  type Account, type ContentCategory, type ContentRow, type ContentStatus,
  type Division, type Profile, type Project, type TeamMember,
} from '@/lib/types';

interface Props {
  profile: Profile | null;
  accounts: Account[];
  projects: Project[];
  projectFilter: string; // 'all' | project id
}

type ColKey = 'akun' | 'kategori' | 'status' | 'caption' | 'drive' | 'post' | 'ads' | 'pic' | 'tayang';

const COLUMNS: { key: ColKey; label: string; width?: number }[] = [
  { key: 'akun', label: 'Akun', width: 150 },
  { key: 'kategori', label: 'Kategori', width: 140 },
  { key: 'status', label: 'Status', width: 150 },
  { key: 'caption', label: 'Caption', width: 90 },
  { key: 'drive', label: 'Link Drive', width: 190 },
  { key: 'post', label: 'Link Post', width: 210 },
  { key: 'ads', label: 'Kode Ads', width: 150 },
  { key: 'pic', label: 'PIC', width: 120 },
  { key: 'tayang', label: 'Tayang', width: 120 },
];

const isUrl = (s: string | null | undefined) => !!s && /^https?:\/\//i.test(s.trim());

/** Judul disimpan dengan penanda **bold** — dibersihkan untuk tampilan tabel. */
const plainTitle = (s: string) => (s || '').replace(/\*\*/g, '').split('\n')[0].trim();

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};

/**
 * Sel yang bisa diketik langsung. Uncontrolled + key mengikuti nilai server:
 * begitu data server berubah, sel di-remount dengan nilai terbaru — sekaligus
 * mengembalikan nilai lama secara otomatis kalau simpan gagal.
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

export default function TableView({ profile, accounts, projects, projectFilter }: Props) {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [division, setDivision] = useState<Division>('semua');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<ColKey[]>([]);
  const [colMenu, setColMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const flash = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(''), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, cc, m] = await Promise.all([
      supabase.from('contents').select('*').order('updated_at', { ascending: false }),
      supabase.from('content_categories').select('*').order('name'),
      supabase.from('team_members').select('*').eq('is_active', true).order('name'),
    ]);
    setRows((c.data as ContentRow[]) || []);
    setCategories((cc.data as ContentCategory[]) || []);
    setMembers((m.data as TeamMember[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setCatFilter('all'); }, [projectFilter]);

  // ---- simpan satu sel ----
  const patchRow = async (row: ContentRow, patch: Record<string, unknown>, label: string) => {
    const { error } = await supabase.from('contents').update(patch).eq('id', row.id);
    if (error) { flash(`Gagal menyimpan ${label} — cek wewenang tim kamu untuk tahap ini.`); }
    else { flash(`${label} tersimpan.`); }
    load();
  };

  const moveStatus = async (row: ContentRow, target: ContentStatus) => {
    if (target === row.status) return;
    if (target === 'terjadwal' && !row.publish_date) {
      flash('Isi Tanggal tayang dulu sebelum menjadwalkan.');
      load();
      return;
    }
    await patchRow(row, { status: target }, 'Status');
  };

  const copyCaption = async (row: ContentRow) => {
    const text = [(row.caption || '').trim(), (row.hashtags || '').trim()].filter(Boolean).join('\n\n');
    if (!text) { flash('Caption & hashtag masih kosong.'); return; }
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
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId((c) => (c === row.id ? null : c)), 1600);
    } else {
      flash('Browser menolak akses clipboard — buka kartunya lalu salin manual.');
    }
  };

  // ---- daftar & filter ----
  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.handle || '—';
  const personName = (id: string | null) => members.find((m) => m.id === id)?.name || null;

  const boardCategories = useMemo(
    () => (projectFilter === 'all'
      ? []
      : categories.filter((c) => c.project_id === projectFilter && c.is_active)),
    [categories, projectFilter]
  );

  const activeDiv = DIVISIONS.find((d) => d.key === division)!;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (projectFilter !== 'all' && r.project_id !== projectFilter) return false;
      if (!activeDiv.statuses.includes(r.status)) return false;
      if (catFilter !== 'all' && r.category_id !== catFilter) return false;
      // "Perlu ditindak" = aset atau link tayang belum lengkap
      if (onlyTodo) {
        const needsAsset = !r.asset_url;
        const needsPost = (r.status === 'published' || r.status === 'diiklankan') && !r.post_url;
        if (!needsAsset && !needsPost) return false;
      }
      if (q) {
        const hay = [plainTitle(r.title), accName(r.account_id), r.ads_code || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, projectFilter, activeDiv, catFilter, onlyTodo, search, accounts]);

  const shownCols = COLUMNS.filter((c) => !hiddenCols.includes(c.key));
  const toggleCol = (k: ColKey) =>
    setHiddenCols((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]));

  const catOf = (row: ContentRow) =>
    row.category_id ? categories.find((c) => c.id === row.category_id) || null : null;

  const catsForRow = (row: ContentRow) =>
    categories.filter(
      (c) => c.project_id === row.project_id && (c.is_active || c.id === row.category_id)
    );

  const th = (label: string, width?: number) => (
    <th key={label} style={{ width, position: 'sticky', top: 0, background: 'var(--raised)', zIndex: 2 }}>
      {label}
    </th>
  );

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Tabel Kerja</h2>
          <span className="top-note">{filtered.length} konten · edit langsung tanpa buka kartu</span>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={() => setColMenu(!colMenu)}>
            ☰ Kolom{hiddenCols.length ? ` (${hiddenCols.length} disembunyikan)` : ''}
          </button>
          <button className="btn" onClick={load}>↻ Muat ulang</button>
        </div>
      </div>

      <div className="content-area">
        {colMenu && (
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 10,
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

        <div className="div-tabs">
          {DIVISIONS.map((d) => (
            <button
              key={d.key}
              className={`div-tab ${division === d.key ? 'active' : ''}`}
              onClick={() => setDivision(d.key)}
            >
              <span className="div-dot" style={{ background: d.color }} />
              {d.label}
            </button>
          ))}
        </div>

        <div className="tracker-filters">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul / akun / kode ads…"
          />
          <select
            value={catFilter}
            disabled={projectFilter === 'all'}
            onChange={(e) => setCatFilter(e.target.value)}
          >
            <option value="all">
              {projectFilter === 'all' ? 'Kategori — pilih project dulu' : 'Semua kategori'}
            </option>
            {boardCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} />
            Hanya yang perlu ditindak
          </label>
        </div>

        {loading ? (
          <div className="table-wrap"><p className="empty">Memuat…</p></div>
        ) : (
          <>
            <div className="table-wrap" style={{ maxHeight: '68vh', overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {th('Konten', 260)}
                    {shownCols.map((c) => th(c.label, c.width))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const editable = canEditRow(profile, row.status);
                    const cat = catOf(row);
                    const def = statusDef(row.status);
                    const targets = targetableStatuses(profile, row.status);
                    return (
                      <tr key={row.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span
                              className="flag-dot"
                              title={row.asset_url ? 'Aset siap' : 'Perlu link drive'}
                              style={{ background: row.asset_url ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }}
                            />
                            <span
                              title={plainTitle(row.title)}
                              style={{
                                fontWeight: 600, fontSize: 13,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                maxWidth: 230, display: 'inline-block',
                              }}
                            >
                              {plainTitle(row.title) || '(tanpa judul)'}
                            </span>
                          </div>
                        </td>

                        {shownCols.map((c) => {
                          if (c.key === 'akun') return <td key={c.key} className="sub">{accName(row.account_id)}</td>;

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
                                      color: cat ? tagColor(cat.name) : undefined,
                                      fontWeight: cat ? 600 : undefined,
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
                                  onChange={(e) => moveStatus(row, e.target.value as ContentStatus)}
                                  style={{ width: '100%', color: def.color, fontWeight: 600 }}
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
                                  onClick={() => copyCaption(row)}
                                  title={has ? 'Salin caption + hashtag' : 'Caption & hashtag masih kosong'}
                                  style={{
                                    fontSize: 12, padding: '4px 10px',
                                    color: copiedId === row.id ? 'var(--green)' : undefined,
                                    opacity: has ? 1 : 0.4,
                                  }}
                                >
                                  {copiedId === row.id ? '✓ Tersalin' : '📋 Copy'}
                                </button>
                              </td>
                            );
                          }

                          if (c.key === 'drive' || c.key === 'post') {
                            const field = c.key === 'drive' ? 'asset_url' : 'post_url';
                            const val = (c.key === 'drive' ? row.asset_url : row.post_url) || '';
                            return (
                              <td key={c.key}>
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
                            const team = def.ownerTeam;
                            const id = team === 'creative' ? row.pic_creative
                              : team === 'distribution' ? row.pic_distribution : row.pic_ads;
                            return <td key={c.key} className="sub">{personName(id) || '—'}</td>;
                          }

                          return <td key={c.key} className="sub">{fmtDate(row.publish_date)}</td>;
                        })}
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={shownCols.length + 1} className="empty">
                        Tidak ada konten yang cocok dengan filter ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="cal-legend">
              Ketik langsung di kolomnya — tersimpan otomatis saat pindah kolom atau tekan Enter.
              Tekan Esc untuk membatalkan. Kolom yang tidak bisa diketik berarti tahapnya sedang dikelola tim lain.
            </p>
          </>
        )}

        {msg && (
          <div className="toast" onClick={() => setMsg('')}>
            <span className="toast-dot" />
            {msg}
          </div>
        )}
      </div>
    </>
  );
}
