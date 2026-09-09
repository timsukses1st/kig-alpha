'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface PilihanCari {
  id: string;
  label: string;
  /** Baris kecil di bawah label — mis. platform akun atau tim anggota. */
  sub?: string;
  /** Warna teks label, kalau pilihannya berwarna (kategori, status). */
  warna?: string;
  /** Ikut dicari walau tidak ditampilkan. Mis. nama project sebuah akun. */
  cari?: string;
}

interface Props {
  value: string;
  options: PilihanCari[];
  onChange: (id: string) => void;
  /** Label untuk pilihan kosong. Kalau null, pilihan kosong tidak ditawarkan. */
  kosongLabel?: string | null;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Di bawah jumlah ini kotak pencarian TIDAK ditampilkan.
   *
   * Kategori konten paling banyak 2 pilihan per project; memberi kotak cari di
   * situ cuma menambah satu langkah untuk sesuatu yang sudah kelihatan semua.
   * Akun media bisa 100 dalam satu project — di situ pencarian baru berguna.
   */
  ambangCari?: number;
  style?: React.CSSProperties;
}

const TINGGI_PANEL = 300;
const LEBAR_PANEL = 280;

export default function PilihCari({
  value, options, onChange, kosongLabel = '— pilih —',
  disabled = false, placeholder = 'Ketik untuk mencari…',
  ambangCari = 8, style,
}: Props) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState('');
  const [sorot, setSorot] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; lebar: number } | null>(null);
  const kotakRef = useRef<HTMLDivElement | null>(null);

  const terpilih = options.find((o) => o.id === value) || null;

  const tersaring = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      o.label.toLowerCase().indexOf(q) !== -1
      || (o.sub ? o.sub.toLowerCase().indexOf(q) !== -1 : false)
      || (o.cari ? o.cari.toLowerCase().indexOf(q) !== -1 : false));
  }, [options, cari]);

  /**
   * Panel dipasang `position: fixed` dan ditempatkan dari letak tombolnya.
   *
   * Kalau memakai `absolute`, panelnya terpotong begitu dipasang di dalam
   * tabel yang bisa digulir atau di dalam modal — dan pilihan paling bawah
   * jadi tidak bisa diklik sama sekali. Pola ini sama dengan PicCell.
   */
  const bukaPanel = () => {
    if (disabled) return;
    const r = kotakRef.current ? kotakRef.current.getBoundingClientRect() : null;
    if (r) {
      const muatBawah = window.innerHeight - r.bottom > TINGGI_PANEL + 16;
      setPos({
        top: muatBawah ? r.bottom + 4 : Math.max(8, r.top - TINGGI_PANEL - 4),
        left: Math.min(r.left, Math.max(8, window.innerWidth - LEBAR_PANEL - 8)),
        lebar: Math.max(r.width, 220),
      });
    }
    setCari('');
    setSorot(0);
    setBuka(true);
  };

  useEffect(() => {
    if (!buka) return;
    const tutup = () => setBuka(false);
    const luar = (e: MouseEvent) => {
      if (kotakRef.current && !kotakRef.current.contains(e.target as Node)) {
        // Panelnya di luar kotakRef karena fixed — jadi klik di dalam panel
        // ditandai lewat atribut, bukan lewat containment.
        const el = e.target as HTMLElement;
        if (!el.closest || !el.closest('[data-pilihcari-panel]')) setBuka(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tutup(); };
    // Menutup saat digulir: panelnya fixed, jadi kalau halamannya bergerak
    // panelnya akan tertinggal menggantung di tempat lama.
    window.addEventListener('scroll', tutup, true);
    window.addEventListener('resize', tutup);
    document.addEventListener('mousedown', luar);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', tutup, true);
      window.removeEventListener('resize', tutup);
      document.removeEventListener('mousedown', luar);
      document.removeEventListener('keydown', onKey);
    };
  }, [buka]);

  const pilih = (id: string) => { onChange(id); setBuka(false); };

  // Pilihan kosong selalu ikut di paling atas kalau ditawarkan — juga saat
  // sedang mencari, supaya "hapus pilihan" tidak hilang begitu mengetik.
  const daftar: PilihanCari[] = kosongLabel === null
    ? tersaring
    : ([{ id: '', label: kosongLabel }] as PilihanCari[]).concat(tersaring);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSorot((i) => Math.min(i + 1, daftar.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSorot((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const p = daftar[sorot];
      if (p) pilih(p.id);
    }
  };

  return (
    <div ref={kotakRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={bukaPanel}
        title={terpilih ? terpilih.label : undefined}
        style={{
          // Sengaja meniru bentuk <select> bawaan Alpha supaya di satu baris
          // form tidak kelihatan ada dua jenis kotak yang berbeda.
          width: '100%', minWidth: 0, textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', borderRadius: 8, font: 'inherit', fontSize: 12.5,
          background: 'var(--input, var(--raised))',
          border: '1px solid ' + (buka ? 'var(--accent)' : 'var(--border-strong)'),
          color: terpilih ? (terpilih.warna || 'var(--text)') : 'var(--text-3)',
          fontWeight: terpilih ? 600 : 400,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          ...style,
        }}
      >
        <span style={{
          minWidth: 0, flex: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {terpilih ? terpilih.label : (kosongLabel || '—')}
        </span>
        <span style={{ flexShrink: 0, fontSize: 9, color: 'var(--text-3)' }}>▼</span>
      </button>

      {buka && pos && (
        <div
          data-pilihcari-panel
          style={{
            position: 'fixed', top: pos.top, left: pos.left,
            width: Math.max(pos.lebar, LEBAR_PANEL), maxHeight: TINGGI_PANEL,
            display: 'flex', flexDirection: 'column', zIndex: 200,
            background: 'var(--panel)', border: '1px solid var(--border-strong)',
            borderRadius: 10, boxShadow: '0 14px 36px rgba(0,0,0,.5)', overflow: 'hidden',
          }}
        >
          {options.length > ambangCari && (
            <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                value={cari}
                placeholder={placeholder}
                onChange={(e) => { setCari(e.target.value); setSorot(0); }}
                onKeyDown={onKeyDown}
                style={{ width: '100%', fontSize: 12.5 }}
              />
              <div className="hint" style={{ marginTop: 4 }}>
                {tersaring.length} dari {options.length}
              </div>
            </div>
          )}

          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {daftar.length === 0 ? (
              <p className="empty" style={{ padding: '18px 12px', fontSize: 12.5 }}>
                Tidak ada yang cocok dengan &ldquo;{cari}&rdquo;.
              </p>
            ) : daftar.map((o, i) => (
              <button
                key={o.id || '__kosong__'}
                type="button"
                onMouseEnter={() => setSorot(i)}
                onClick={() => pilih(o.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 11px', border: 0, font: 'inherit', fontSize: 12.5,
                  cursor: 'pointer',
                  background: i === sorot ? 'var(--raised)' : 'transparent',
                  color: o.id === value ? 'var(--accent)' : (o.warna || 'inherit'),
                  fontWeight: o.id === value ? 700 : 500,
                }}
              >
                <span style={{
                  display: 'block', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {o.label}
                </span>
                {o.sub && (
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)' }}>
                    {o.sub}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
