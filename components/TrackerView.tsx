'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { sigma, type SigmaPost } from '@/lib/sigma';

type SortKey = 'views' | 'likes' | 'recent';

const fmtNum = (n: number | null) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'jt';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'rb';
  return String(n);
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' });
};

const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#e0338a',
  tiktok: '#38bdf8',
  threads: '#a78bfa',
  youtube: '#f87171',
};

export default function TrackerView() {
  const [posts, setPosts] = useState<SigmaPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('views');
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await sigma
      .from('alpha_tracker_feed')
      .select('*')
      .order('upload_date', { ascending: false })
      .limit(1000);
    if (err) {
      setError('Gagal memuat data SIGMA. Cek koneksi / konfigurasi.');
      setLoading(false);
      return;
    }
    setPosts((data as SigmaPost[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const accounts = useMemo(() => Array.from(new Set(posts.map((p) => p.account).filter(Boolean))).sort() as string[], [posts]);
  const platforms = useMemo(() => Array.from(new Set(posts.map((p) => p.platform).filter(Boolean))).sort() as string[], [posts]);
  const categories = useMemo(() => Array.from(new Set(posts.map((p) => p.category).filter(Boolean))).sort() as string[], [posts]);

  const filtered = useMemo(() => {
    let r = posts.filter(
      (p) =>
        (account === 'all' || p.account === account) &&
        (platform === 'all' || p.platform === platform) &&
        (category === 'all' || p.category === category)
    );
    if (sort === 'views') r = [...r].sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (sort === 'likes') r = [...r].sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else r = [...r].sort((a, b) => new Date(b.upload_date || 0).getTime() - new Date(a.upload_date || 0).getTime());
    return r;
  }, [posts, account, platform, category, sort]);

  const totals = useMemo(() => {
    const sum = (k: keyof SigmaPost) => filtered.reduce((a, p) => a + (Number(p[k]) || 0), 0);
    const views = sum('views');
    const eng = sum('likes') + sum('comments') + sum('saves') + sum('shares');
    return {
      count: filtered.length,
      views,
      likes: sum('likes'),
      engRate: views ? ((eng / views) * 100).toFixed(1) + '%' : '—',
    };
  }, [filtered]);

  const shown = filtered.slice(0, limit);

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Tracker</h2>
          <span className="top-note">data SIGMA · read-only</span>
        </div>
        <div className="top-actions">
          <button className="btn" onClick={load}>↻ Muat ulang</button>
        </div>
      </div>

      <div className="content-area">
        {error ? (
          <div className="table-wrap"><p className="empty">{error}</p></div>
        ) : loading ? (
          <div className="table-wrap"><p className="empty">Memuat data dari SIGMA…</p></div>
        ) : (
          <>
            <div className="kpi-row">
              <div className="kpi"><div className="kpi-label">Post</div><div className="kpi-value">{totals.count}</div></div>
              <div className="kpi"><div className="kpi-label">Total views</div><div className="kpi-value">{fmtNum(totals.views)}</div></div>
              <div className="kpi"><div className="kpi-label">Total likes</div><div className="kpi-value">{fmtNum(totals.likes)}</div></div>
              <div className="kpi"><div className="kpi-label">Engagement rate</div><div className="kpi-value" style={{ color: 'var(--accent)' }}>{totals.engRate}</div></div>
            </div>

            <div className="tracker-filters">
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="all">Semua akun</option>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="all">Semua platform</option>
                {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">Semua kategori</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="views">Urut: Views terbanyak</option>
                <option value="likes">Urut: Likes terbanyak</option>
                <option value="recent">Urut: Terbaru</option>
              </select>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Konten</th>
                    <th>Akun</th>
                    <th>Views</th>
                    <th>Likes</th>
                    <th>Komentar</th>
                    <th>Saves</th>
                    <th>Shares</th>
                    <th>Upload</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className="tracker-row" onClick={() => p.url && window.open(p.url, '_blank', 'noopener')}>
                      <td>
                        <div className="tracker-post">
                          {p.cover_url
                            ? <img className="tracker-thumb" src={p.cover_url} alt="" loading="lazy" />
                            : <div className="tracker-thumb ph" />}
                          <div style={{ minWidth: 0 }}>
                            <div className="tracker-cat">
                              {p.category || '—'}
                              {p.is_manual && <span className="manual-tag">manual</span>}
                            </div>
                            <div className="sub" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.url || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="plat-dot" style={{ background: PLATFORM_COLOR[p.platform || ''] || 'var(--text-3)' }} />
                        {p.account || '—'}
                      </td>
                      <td><b>{fmtNum(p.views)}</b></td>
                      <td>{fmtNum(p.likes)}</td>
                      <td>{fmtNum(p.comments)}</td>
                      <td>{fmtNum(p.saves)}</td>
                      <td>{fmtNum(p.shares)}</td>
                      <td className="sub">{fmtDate(p.upload_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > limit && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button className="btn" onClick={() => setLimit(limit + 50)}>Tampilkan lebih banyak ({filtered.length - limit} lagi)</button>
              </div>
            )}
            <p className="cal-legend">
              Data ditarik langsung dari SIGMA (read-only). Scraping &amp; input tetap dilakukan di SIGMA — Alpha hanya menampilkan.
            </p>
          </>
        )}
      </div>
    </>
  );
}
