'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PLATFORMS, platformDef, statusDef, type Account, type ContentRow } from '@/lib/types';

interface Props {
  accounts: Account[];
  projectFilter: string; // 'all' | project id
  /** Klik kartu → buka brief-nya di Board Pipeline. */
  onBukaKonten?: (row: ContentRow) => void;
}

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const stripMd = (s: string) => s.replace(/\*\*/g, '');

/** Kode pendek platform untuk kartu yang sempit. Nama panjangnya ada di legenda. */
const KODE_PLATFORM: Record<string, string> = {
  instagram: 'IG', tiktok: 'TT', youtube: 'YT', threads: 'TH', facebook: 'FB',
};

/**
 * Warna garis samping kartu = PLATFORM, bukan status.
 *
 * Sebelumnya garis ini memakai warna status. Diganti 2 September 2026 atas
 * permintaan Mas Dik: di kalender tayang, yang paling perlu dibedakan sekilas
 * adalah platform mana yang tayang hari itu. Statusnya tetap terbaca di
 * tooltip, dan `pelanggaran` justru jadi lebih menonjol daripada sebelumnya
 * karena sekarang seluruh kartunya diberi warna merah.
 *
 * Platform kosong dapat abu-abu redup — sengaja tidak ditebak.
 */
const warnaGaris = (platform: string | null) =>
  platformDef(platform)?.color || 'var(--border-strong)';

export default function CalendarView({ accounts, projectFilter, onBukaKonten }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('contents')
      .select('*')
      .not('publish_date', 'is', null)
      .order('publish_date');
    setRows((data as ContentRow[]) || []);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: kalender ikut berubah begitu tanggal tayang diubah di Board ---
  // Tidak perlu pengaman "beku" seperti di Board: layar ini hanya menampilkan,
  // tidak ada isian yang bisa tertimpa.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(true); }, 400);
    };
    const ch = supabase
      .channel('calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contents' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => projectFilter === 'all' || r.project_id === projectFilter),
    [rows, projectFilter]
  );

  const byDate = useMemo(() => {
    const m: Record<string, ContentRow[]> = {};
    for (const r of filtered) {
      if (!r.publish_date) continue;
      (m[r.publish_date] ||= []).push(r);
    }
    return m;
  }, [filtered]);

  const accName = (id: string | null) => accounts.find((a) => a.id === id)?.handle || '';

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1);
  };

  // susun sel: offset hari pertama (Minggu=0) + jumlah hari
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const dateKey = (d: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const monthCount = Object.keys(byDate)
    .filter((k) => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .reduce((acc, k) => acc + byDate[k].length, 0);

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Kalender Tayang</h2>
          <span className="top-note">{monthCount} konten bulan ini</span>
        </div>
        <div className="cal-nav">
          <button className="btn ghost" onClick={prevMonth}>‹</button>
          <span className="cal-month">{MONTH_NAMES[month]} {year}</span>
          <button className="btn ghost" onClick={nextMonth}>›</button>
        </div>
      </div>
      <div className="content-area">
        {loading ? (
          <p className="empty">Memuat kalender…</p>
        ) : (
          <div className="calendar">
            {DAY_NAMES.map((d) => (
              <div className="cal-dayname" key={d}>{d}</div>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <div className="cal-cell blank" key={`b${i}`} />;
              const key = dateKey(d);
              const items = byDate[key] || [];
              const isToday = key === todayKey;
              return (
                <div className={`cal-cell ${isToday ? 'today' : ''}`} key={key}>
                  <div className="cal-daynum">{d}</div>
                  {items.map((r) => {
                    // Pelanggaran diberi blok merah penuh, bukan cuma garis —
                    // ini keadaan yang harus ketahuan tanpa perlu mengarahkan
                    // kursor ke kartunya.
                    const pelanggaran = r.status === 'pelanggaran';
                    const pf = platformDef(r.platform);
                    return (
                      <div
                        className="cal-item"
                        key={r.id}
                        role={onBukaKonten ? 'button' : undefined}
                        tabIndex={onBukaKonten ? 0 : undefined}
                        onClick={() => onBukaKonten?.(r)}
                        onKeyDown={(e) => {
                          if (!onBukaKonten) return;
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBukaKonten(r); }
                        }}
                        style={{
                          cursor: onBukaKonten ? 'pointer' : undefined,
                          ['--ci' as never]: pelanggaran ? 'var(--red)' : warnaGaris(r.platform),
                          ...(pelanggaran
                            ? { background: 'rgba(239, 68, 68, .15)', borderColor: 'var(--red)' }
                            : null),
                        }}
                        title={
                          `${stripMd(r.title)} — ${statusDef(r.status).label}` +
                          (pf ? ` · ${pf.label}` : '') +
                          (onBukaKonten ? '\nKlik untuk melompat ke barisnya di Board' : '')
                        }
                      >
                        <div className="cal-item-title">{stripMd(r.title)}</div>
                        <div className="cal-item-acc">
                          {accName(r.account_id)}
                          {r.platform && KODE_PLATFORM[r.platform] && (
                            /* Warna kode platform TIDAK ikut merah saat pelanggaran —
                               justru di kartu itulah platformnya paling perlu
                               tetap terbaca, karena garis sampingnya sudah dipakai
                               untuk menandai pelanggaran. */
                            <span style={{ color: warnaGaris(r.platform), marginLeft: 5 }}>
                              {KODE_PLATFORM[r.platform]}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <div className="cal-legend">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <b style={{ color: 'var(--text-2)' }}>Warna garis = platform:</b>
            {PLATFORMS.map((p) => (
              <span key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 3, height: 13, borderRadius: 2, background: p.color, display: 'inline-block',
                }} />
                {p.label} <span style={{ opacity: .6 }}>({KODE_PLATFORM[p.key]})</span>
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 13, height: 13, borderRadius: 3, display: 'inline-block',
                background: 'rgba(239, 68, 68, .15)', border: '1px solid var(--red)',
              }} />
              Kartu merah = <b>pelanggaran</b>
            </span>
          </div>
          <b>Klik kartu</b> untuk melompat ke barisnya di Board Pipeline — barisnya akan disorot kuning sebentar.
          Konten muncul di sini otomatis begitu <b>Tanggal tayang</b> diisi di Board.
          Status lengkapnya terbaca saat kursor diarahkan ke kartunya.
        </div>
      </div>
    </>
  );
}
