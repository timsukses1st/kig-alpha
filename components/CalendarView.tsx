'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { statusDef, type Account, type ContentRow } from '@/lib/types';

interface Props {
  accounts: Account[];
  projectFilter: string; // 'all' | project id
}

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const stripMd = (s: string) => s.replace(/\*\*/g, '');

export default function CalendarView({ accounts, projectFilter }: Props) {
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
                  {items.map((r) => (
                    <div
                      className="cal-item"
                      key={r.id}
                      style={{ ['--ci' as never]: statusDef(r.status).color }}
                      title={`${stripMd(r.title)} — ${statusDef(r.status).label}`}
                    >
                      <div className="cal-item-title">{stripMd(r.title)}</div>
                      <div className="cal-item-acc">{accName(r.account_id)}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="cal-legend">
          Warna garis = status konten. Konten muncul di sini otomatis begitu <b>Tanggal tayang</b> diisi di Board.
        </div>
      </div>
    </>
  );
}
