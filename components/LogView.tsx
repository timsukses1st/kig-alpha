'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { initials, type ActivityLog, type Profile } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = {
  ide: 'Ide',
  drafting: 'Drafting',
  review: 'Review',
  siap_upload: 'Siap Upload',
  terjadwal: 'Terjadwal',
  published: 'Published',
  diiklankan: 'Diiklankan',
};

// judul konten sering panjang (bold ** + link) — rapikan untuk log
const cleanTitle = (raw: string | null) => {
  if (!raw) return '';
  const t = raw
    .replace(/\*\*/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 55 ? t.slice(0, 55).trimEnd() + '…' : t;
};

const cleanDetail = (raw: string | null) => {
  if (!raw) return '';
  return raw.replace(/[a-z_]+/g, (w) => STATUS_LABEL[w] || w);
};

const BADGE: Record<string, string> = {
  membuat: 'BUAT',
  mengubah: 'UPDATE',
  memindahkan: 'STATUS',
  menghapus: 'HAPUS',
  role_change: 'ROLE',
  izin_change: 'IZIN',
};

/** Berapa kejadian yang ditarik sekali muat. */
const BATAS = 200;

/** Nilai penyaring untuk kejadian yang tidak punya pelaku. */
const SISTEM = '__sistem__';

export default function LogView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [orangDaftar, setOrangDaftar] = useState<Profile[]>([]);
  const [orang, setOrang] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  /**
   * Daftar orang diambil dari `profiles`, BUKAN dari log yang sedang tampil.
   *
   * Kalau diambil dari log, isinya cuma orang yang kebetulan muncul di 200
   * kejadian terakhir — orang yang aktifnya minggu lalu tidak akan bisa dipilih
   * sama sekali. Padahal justru dia yang biasanya dicari.
   */
  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name')
      .then(({ data }) => setOrangDaftar((data as Profile[]) || []));
  }, []);

  /**
   * Penyaringan dilakukan di DATABASE, bukan di layar.
   *
   * Kalau disaring di layar, yang tersaring hanya 200 kejadian terakhir milik
   * semua orang — untuk satu orang mungkin cuma tersisa dua tiga baris, dan
   * riwayatnya seolah kosong. Dengan .eq() di query, 200 barisnya benar-benar
   * milik orang yang dipilih.
   */
  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(BATAS);

    if (orang === SISTEM) q = q.is('actor_id', null);
    else if (orang !== 'all') q = q.eq('actor_id', orang);

    const { data } = await q;
    setLogs((data as ActivityLog[]) || []);
    setLoading(false);
  }, [orang]);

  useEffect(() => { load(); }, [load]);

  const namaTerpilih = useMemo(() => {
    if (orang === 'all') return null;
    if (orang === SISTEM) return 'Sistem';
    const p = orangDaftar.find((x) => x.id === orang);
    return p ? (p.full_name || p.email) : 'orang ini';
  }, [orang, orangDaftar]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
    const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if (d >= startToday) return `Hari ini · ${time}`;
    if (d >= startYest) return `Kemarin · ${time}`;
    return `${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} · ${time}`;
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Log Aktivitas</h2>
          <span className="top-note">
            {loading
              ? 'memuat…'
              : `${logs.length}${logs.length >= BATAS ? '+' : ''} kejadian${namaTerpilih ? ` · ${namaTerpilih}` : ''}`}
          </span>
        </div>
        <div className="top-actions">
          <select
            value={orang}
            onChange={(e) => setOrang(e.target.value)}
            title="Saring log menurut pelakunya"
            style={{ minWidth: 190 }}
          >
            <option value="all">Semua orang</option>
            {orangDaftar.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.full_name || p.email) + (p.is_active ? '' : ' (nonaktif)')}
              </option>
            ))}
            <option value={SISTEM}>— Tanpa pelaku (sistem) —</option>
          </select>
          {orang !== 'all' && (
            <button className="btn" onClick={() => setOrang('all')}>Kosongkan</button>
          )}
        </div>
      </div>
      <div className="content-area">
        {loading ? (
          <p className="empty">Memuat log…</p>
        ) : logs.length === 0 ? (
          <p className="empty">
            {namaTerpilih
              ? `Belum ada aktivitas tercatat atas nama ${namaTerpilih}.`
              : 'Belum ada aktivitas tercatat.'}
          </p>
        ) : (
          <div className="feed">
            {logs.map((l) => {
              const actor = l.actor_name || l.actor_email || 'sistem';
              return (
                <div className="feed-item" key={l.id}>
                  <div className="row-avatar">{initials(actor)}</div>
                  <div>
                    <div className="feed-text">
                      {/* Nama pelaku bisa diklik untuk langsung menyaring —
                          lebih cepat daripada mencarinya di dropdown, dan
                          justru begitulah orang biasanya menelusuri log:
                          melihat satu kejadian, lalu ingin lihat sisanya. */}
                      <b
                        onClick={() => l.actor_id && setOrang(l.actor_id)}
                        style={l.actor_id ? { cursor: 'pointer' } : undefined}
                        title={l.actor_id ? `Lihat semua aktivitas ${actor}` : undefined}
                      >
                        {actor}
                      </b>{' '}
                      {l.action}{' '}
                      {l.entity_title && (
                        <span className="obj" title={l.entity_title}>&ldquo;{cleanTitle(l.entity_title)}&rdquo;</span>
                      )}
                      {l.detail && <span className="feed-detail"> — {cleanDetail(l.detail)}</span>}
                    </div>
                    <div className="feed-time">{fmt(l.created_at)}</div>
                  </div>
                  <span className="feed-badge">{BADGE[l.action] || l.entity.toUpperCase()}</span>
                </div>
              );
            })}
          </div>
        )}
        {!loading && logs.length >= BATAS && (
          <p className="section-hint" style={{ marginTop: 12 }}>
            Menampilkan {BATAS} kejadian terbaru{namaTerpilih ? ` dari ${namaTerpilih}` : ''}.
            Yang lebih lama belum ditampilkan — pilih satu orang untuk mempersempitnya.
          </p>
        )}
      </div>
    </>
  );
}
