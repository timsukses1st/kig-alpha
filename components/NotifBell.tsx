'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { notifMeta, type Notif, type Profile } from '@/lib/types';

interface Props {
  profile: Profile | null;
  /** Dipanggil saat notifikasi diklik, supaya App bisa pindah layar. */
  onBuka: (view: string | null, refId: string | null) => void;
  /** Sidebar sedang menciut — loncengnya jadi ikon saja tanpa tulisan. */
  slim?: boolean;
}

/** Berapa notifikasi yang ditarik sekali muat. Sisanya cukup lewat layarnya. */
const BATAS = 30;

const waktuSingkat = (iso: string) => {
  const d = new Date(iso);
  const detik = Math.floor((Date.now() - d.getTime()) / 1000);
  if (detik < 60) return 'baru saja';
  if (detik < 3600) return `${Math.floor(detik / 60)} mnt`;
  if (detik < 86400) return `${Math.floor(detik / 3600)} jam`;
  if (detik < 604800) return `${Math.floor(detik / 86400)} hr`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
};

export default function NotifBell({ profile, onBuka, slim = false }: Props) {
  const [items, setItems] = useState<Notif[]>([]);
  const [buka, setBuka] = useState(false);
  const [izinTanya, setIzinTanya] = useState(false);
  const kotak = useRef<HTMLDivElement | null>(null);

  const belumDibaca = items.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(BATAS);
    setItems((data as Notif[]) || []);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  /**
   * Pemberitahuan desktop.
   *
   * Ini Notification API biasa, BUKAN Web Push — jadi hanya muncul selama tab
   * Alpha masih terbuka (boleh di tab lain, boleh di belakang jendela lain).
   * Kalau browsernya ditutup sama sekali, tidak ada yang muncul; itu perlu
   * service worker + Web Push, pekerjaan tersendiri.
   *
   * Dibungkus try/catch karena beberapa peramban melempar error kalau
   * Notification dipanggil dari konteks yang tidak diizinkan.
   */
  const munculkanDesktop = useCallback((n: Notif) => {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      // Tidak perlu diganggu kalau dia memang sedang melihat Alpha.
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      const notif = new Notification(n.title, {
        body: n.body || '',
        // tag membuat pemberitahuan sejenis saling menimpa, bukan menumpuk.
        tag: n.kind + (n.ref_id || ''),
      });
      notif.onclick = () => { window.focus(); notif.close(); };
    } catch { /* peramban menolak — abaikan, lonceng di dalam aplikasi tetap jalan */ }
  }, []);

  // Realtime: baris baru langsung masuk daftar tanpa memuat ulang semuanya.
  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel('notif-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const baru = payload.new as Notif;
            setItems((lama) => [baru].concat(lama.filter((x) => x.id !== baru.id)).slice(0, BATAS));
            munculkanDesktop(baru);
          } else {
            // UPDATE dipakai untuk notifikasi chat yang digabung, dan untuk
            // penandaan terbaca dari perangkat lain. Muat ulang saja — murah,
            // dan menjaga urutannya tetap benar.
            load();
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profile, load, munculkanDesktop]);

  // Klik di luar menutup panel. Tanpa ini panelnya menempel terus dan
  // menghalangi menu di bawahnya.
  useEffect(() => {
    if (!buka) return;
    const luar = (e: MouseEvent) => {
      if (kotak.current && !kotak.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('mousedown', luar);
    return () => document.removeEventListener('mousedown', luar);
  }, [buka]);

  // Tawaran izin hanya muncul kalau memang belum pernah dijawab. Sekali
  // ditolak, browser tidak akan menampilkan permintaannya lagi — jadi tidak
  // ada gunanya terus menawarkan.
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setIzinTanya(Notification.permission === 'default');
  }, []);

  const mintaIzin = async () => {
    try {
      const hasil = await Notification.requestPermission();
      setIzinTanya(hasil === 'default');
    } catch { setIzinTanya(false); }
  };

  const tandaiTerbaca = async (n: Notif) => {
    if (n.read_at) return;
    // Layar diperbarui lebih dulu supaya terasa seketika; kalau database
    // menolak, realtime akan mengembalikannya ke keadaan sebenarnya.
    setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
  };

  const tandaiSemua = async () => {
    if (!belumDibaca) return;
    const now = new Date().toISOString();
    setItems((l) => l.map((x) => (x.read_at ? x : { ...x, read_at: now })));
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null);
  };

  const klik = (n: Notif) => {
    tandaiTerbaca(n);
    setBuka(false);
    onBuka(n.view, n.ref_id);
  };

  if (!profile) return null;

  return (
    <div ref={kotak} style={{ position: 'relative' }}>
      <button
        className={slim ? 'icon-btn footer-icon' : 'btn ghost theme-btn'}
        title={belumDibaca ? `${belumDibaca} notifikasi belum dibaca` : 'Notifikasi'}
        onClick={() => setBuka(!buka)}
        style={{ position: 'relative' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {!slim && <span style={{ marginLeft: 8 }}>Notifikasi</span>}
        {belumDibaca > 0 && (
          <span
            aria-label={`${belumDibaca} belum dibaca`}
            style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 8, background: 'var(--red)', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
            }}
          >
            {belumDibaca > 99 ? '99+' : belumDibaca}
          </span>
        )}
      </button>

      {buka && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
            width: 320, maxHeight: 420, overflowY: 'auto', zIndex: 90,
            background: 'var(--panel)', border: '1px solid var(--border-strong)',
            borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.35)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            position: 'sticky', top: 0, background: 'var(--panel)',
          }}>
            <b style={{ fontSize: 12.5 }}>Notifikasi</b>
            {belumDibaca > 0 && (
              <button className="btn act" onClick={tandaiSemua}>Tandai semua terbaca</button>
            )}
          </div>

          {izinTanya && (
            <div style={{
              padding: '9px 12px', borderBottom: '1px solid var(--border)',
              fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-2)',
            }}>
              Mau notifikasi muncul di layar saat Alpha ada di tab lain?{' '}
              <button className="btn act" style={{ marginTop: 6 }} onClick={mintaIzin}>
                Izinkan
              </button>
            </div>
          )}

          {items.length === 0 ? (
            <p className="empty" style={{ padding: '22px 12px', fontSize: 12.5 }}>
              Belum ada notifikasi.
            </p>
          ) : (
            items.map((n) => {
              const m = notifMeta(n.kind);
              return (
                <button
                  key={n.id}
                  onClick={() => klik(n)}
                  style={{
                    display: 'flex', gap: 10, width: '100%', textAlign: 'left',
                    padding: '10px 12px', border: 0,
                    borderBottom: '1px solid var(--border)',
                    background: n.read_at ? 'transparent' : 'var(--accent-soft)',
                    cursor: 'pointer', font: 'inherit', color: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: '18px', flexShrink: 0 }}>{m.ikon}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{
                      display: 'block', fontSize: 12.5, fontWeight: n.read_at ? 500 : 700,
                      overflowWrap: 'anywhere',
                    }}>
                      {n.title}
                    </span>
                    {/* Isi pesan dipotong 2 baris — notifikasi panjang membuat
                        daftarnya jadi dinding teks dan malah tidak terbaca. */}
                    {n.body && (
                      <span style={{
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        fontSize: 11.5, color: 'var(--text-2)',
                        marginTop: 2, overflowWrap: 'anywhere',
                      } as React.CSSProperties}>
                        {n.body}
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                      {waktuSingkat(n.created_at)}
                    </span>
                  </span>
                  {!n.read_at && (
                    <span style={{
                      width: 7, height: 7, borderRadius: 4, flexShrink: 0,
                      background: m.warna, marginTop: 6,
                    }} />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
