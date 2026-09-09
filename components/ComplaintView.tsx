'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { boleh, initials, TUGAS, type Complaint, type ComplaintMessage, type Profile } from '@/lib/types';

interface Props {
  profile: Profile | null;
}

const CATEGORIES = [
  { key: 'bug', label: 'Bug / error' },
  { key: 'fitur', label: 'Usulan fitur' },
  { key: 'akses', label: 'Akses & login' },
  { key: 'data', label: 'Data tidak sesuai' },
  { key: 'proses', label: 'Alur kerja' },
  { key: 'lainnya', label: 'Lainnya' },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  baru: { label: 'Baru', color: 'var(--st-review)' },
  diproses: { label: 'Diproses', color: 'var(--amber)' },
  selesai: { label: 'Selesai', color: 'var(--green)' },
};

const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || k;

export default function ComplaintView({ profile }: Props) {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'baru' | 'diproses' | 'selesai'>('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: 'bug', title: '', detail: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [active, setActive] = useState<Complaint | null>(null);
  const [messages, setMessages] = useState<ComplaintMessage[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [msgBusy, setMsgBusy] = useState(false);

  const isLead = boleh(profile, TUGAS.komplainLihat);
  const bisaUbah = boleh(profile, TUGAS.komplainUbah);
  /**
   * Boleh menghapus komplain.
   *
   * Cerminan dari policy `complaints_delete` yang memakai boleh('komplain_hapus').
   * Sengaja TIDAK ditulis `role === 'superadmin'`: yang menentukan siapa boleh
   * adalah matriks Izin Peran, dan matriksnya sekarang cuma menyisakan
   * superadmin. Kalau suatu saat izinnya dibuka lagi lewat Kelola Akses,
   * tombolnya ikut muncul sendiri tanpa perlu deploy ulang.
   */
  const bisaHapus = boleh(profile, TUGAS.komplainHapus);

  /** Komplain yang dicentang untuk dihapus sekaligus. */
  const [terpilih, setTerpilih] = useState<string[]>([]);
  /** Daftar id yang sedang dikonfirmasi. `judul` hanya diisi kalau satuan. */
  const [konfirmHapus, setKonfirmHapus] = useState<{ ids: string[]; judul: string | null } | null>(null);
  const [hapusBusy, setHapusBusy] = useState(false);

  // --- notifikasi in-app (window.alert diblokir di browser) ---
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
    setRows((data as Complaint[]) || []);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // --- REALTIME: daftar komplain ---
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { load(true); }, 250);
    };
    const ch = supabase
      .channel('complaint-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [load]);

  // Sinkronkan modal thread yang sedang terbuka dengan data terbaru.
  useEffect(() => {
    setActive((cur) => (cur ? rows.find((r) => r.id === cur.id) || cur : cur));
  }, [rows]);

  /**
   * Buang centang yang barisnya sudah tidak ada lagi — mis. dihapus dari
   * perangkat lain. Kalau dibiarkan, tombol "Hapus 3" akan mengirim id hantu
   * dan hasilnya cuma 1 yang terhapus tanpa penjelasan.
   */
  useEffect(() => {
    setTerpilih((cur) => cur.filter((id) => rows.some((r) => r.id === id)));
  }, [rows]);

  const loadMessages = async (id: string) => {
    const { data } = await supabase
      .from('complaint_messages')
      .select('*')
      .eq('complaint_id', id)
      .order('created_at', { ascending: true });
    setMessages((data as ComplaintMessage[]) || []);
  };

  // --- REALTIME: balasan pada thread yang sedang dibuka ---
  const activeId = active?.id || null;
  useEffect(() => {
    if (!activeId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const segarkan = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadMessages(activeId); }, 200);
    };
    const ch = supabase
      .channel(`complaint-msg-${activeId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'complaint_messages',
        filter: `complaint_id=eq.${activeId}`,
      }, segarkan)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const openThread = (c: Complaint) => {
    setActive(c);
    setMessages([]);
    setNewMsg('');
    loadMessages(c.id);
  };

  const submit = async () => {
    if (!profile) return;
    if (!form.title.trim()) { setError('Judul komplain wajib diisi.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.from('complaints').insert({
      category: form.category,
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      reporter_id: profile.id,
      reporter_name: profile.full_name || profile.email,
    });
    setBusy(false);
    if (err) { setError('Gagal mengirim komplain.'); return; }
    setOpen(false);
    setForm({ category: 'bug', title: '', detail: '' });
    flashToast('Komplain terkirim. Lead akan menindaklanjuti.');
    load(true);
  };

  const sendMsg = async () => {
    if (!active || !newMsg.trim() || !profile) return;
    setMsgBusy(true);
    const { error: err } = await supabase.from('complaint_messages').insert({
      complaint_id: active.id,
      author_id: profile.id,
      author_name: profile.full_name || profile.email,
      message: newMsg.trim(),
    });
    setMsgBusy(false);
    if (!err) { setNewMsg(''); loadMessages(active.id); }
  };

  const setStatus = async (c: Complaint, status: string) => {
    const patch: Record<string, unknown> = { status };
    if (status === 'selesai') {
      patch.resolved_at = new Date().toISOString();
      patch.handler_name = profile?.full_name || profile?.email || null;
    }
    const { error: err } = await supabase.from('complaints').update(patch).eq('id', c.id);
    if (err) { flashToast('Gagal mengubah status — cek wewenang akunmu.'); return; }
    if (active?.id === c.id) setActive({ ...active, status });
    flashToast(`Status diubah ke "${STATUS_META[status]?.label || status}".`);
    load(true);
  };

  /**
   * Menghapus komplain — satu atau sekaligus.
   *
   * Balasannya ikut terhapus lewat `ON DELETE CASCADE` di
   * `complaint_messages.complaint_id`, jadi tidak ada thread yatim yang
   * tertinggal di database.
   *
   * `.select('id')` WAJIB: penolakan RLS mengenai 0 baris TANPA memunculkan
   * error, jadi tanpa ini penghapusan yang ditolak akan terlihat berhasil.
   */
  const jalankanHapus = async () => {
    if (!konfirmHapus) return;
    const ids = konfirmHapus.ids;
    if (ids.length === 0) { setKonfirmHapus(null); return; }
    setHapusBusy(true);
    const { data, error: err } = await supabase
      .from('complaints').delete().in('id', ids).select('id');
    setHapusBusy(false);
    const terhapus = data ? data.length : 0;
    setKonfirmHapus(null);
    if (err || terhapus === 0) {
      flashToast('Gagal menghapus — izin "Hapus komplain" tidak ada di akunmu.');
      return;
    }
    // Thread yang sedang terbuka ikut ditutup kalau barisnya termasuk yang
    // dihapus — kalau tidak, modalnya menggantung menampilkan data hantu.
    if (active && ids.indexOf(active.id) !== -1) setActive(null);
    setTerpilih((cur) => cur.filter((id) => ids.indexOf(id) === -1));
    if (terhapus < ids.length) {
      flashToast(`${terhapus} dari ${ids.length} komplain dihapus — sisanya ditolak database.`);
    } else {
      flashToast(terhapus > 1 ? `${terhapus} komplain dihapus.` : 'Komplain dihapus.');
    }
    load(true);
  };

  const filtered = useMemo(
    () => rows.filter((r) => filter === 'all' || r.status === filter),
    [rows, filter]
  );

  /** Centang hanya berlaku untuk baris yang sedang tampil di filter aktif. */
  const terpilihTampil = useMemo(
    () => terpilih.filter((id) => filtered.some((r) => r.id === id)),
    [terpilih, filtered],
  );
  const semuaTercentang = filtered.length > 0 && terpilihTampil.length === filtered.length;

  const toggleSatu = (id: string) => {
    setTerpilih((cur) => (cur.indexOf(id) === -1 ? cur.concat([id]) : cur.filter((x) => x !== id)));
  };
  const toggleSemua = () => {
    if (semuaTercentang) {
      setTerpilih((cur) => cur.filter((id) => !filtered.some((r) => r.id === id)));
    } else {
      const tambah = filtered.map((r) => r.id).filter((id) => terpilih.indexOf(id) === -1);
      setTerpilih((cur) => cur.concat(tambah));
    }
  };

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {};
    const byPerson: Record<string, number> = {};
    for (const r of rows) {
      byCat[r.category] = (byCat[r.category] || 0) + 1;
      const p = r.reporter_name || 'anonim';
      byPerson[p] = (byPerson[p] || 0) + 1;
    }
    const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const topPerson = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      total: rows.length,
      baru: rows.filter((r) => r.status === 'baru').length,
      diproses: rows.filter((r) => r.status === 'diproses').length,
      selesai: rows.filter((r) => r.status === 'selesai').length,
      topCat,
      topPerson,
    };
  }, [rows]);

  /** Tanggal + jam — `created_at` memang menyimpan jamnya. */
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' +
      d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    );
  };

  const jumlahKolom = bisaHapus ? 6 : 5;

  return (
    <>
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2>Komplain</h2>
          <span className="top-note">{isLead ? 'semua laporan' : 'laporan saya'}</span>
        </div>
        <div className="top-actions">
          <button className="btn primary" onClick={() => { setOpen(true); setError(''); }}>+ Lapor kendala</button>
        </div>
      </div>

      <div className="content-area">
        {isLead && (
          <>
            <div className="kpi-row">
              <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-value">{stats.total}</div></div>
              <div className="kpi"><div className="kpi-label">Baru</div><div className="kpi-value" style={{ color: 'var(--st-review)' }}>{stats.baru}</div></div>
              <div className="kpi"><div className="kpi-label">Diproses</div><div className="kpi-value" style={{ color: 'var(--amber)' }}>{stats.diproses}</div></div>
              <div className="kpi"><div className="kpi-label">Selesai</div><div className="kpi-value" style={{ color: 'var(--green)' }}>{stats.selesai}</div></div>
            </div>

            {stats.total > 0 && (
              <div className="stat-grid">
                <div className="stat-box">
                  <div className="modal-col-label">Masalah tersering</div>
                  {stats.topCat.map(([k, n]) => (
                    <div className="stat-line" key={k}>
                      <span>{catLabel(k)}</span>
                      <div className="stat-bar"><span style={{ width: `${(n / stats.total) * 100}%` }} /></div>
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
                <div className="stat-box">
                  <div className="modal-col-label">Pelapor teraktif</div>
                  {stats.topPerson.map(([name, n]) => (
                    <div className="stat-line" key={name}>
                      <span>{name}</span>
                      <div className="stat-bar"><span style={{ width: `${(n / stats.total) * 100}%` }} /></div>
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="team-filter">
          {(['all', 'baru', 'diproses', 'selesai'] as const).map((f) => (
            <button key={f} className={`chip-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Semua' : STATUS_META[f].label}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          {loading ? (
            <p className="empty">Memuat komplain…</p>
          ) : filtered.length === 0 ? (
            <p className="empty">Belum ada komplain pada filter ini.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {bisaHapus && (
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        aria-label="Centang semua komplain yang tampil"
                        checked={semuaTercentang}
                        ref={(el) => {
                          if (el) el.indeterminate = terpilihTampil.length > 0 && !semuaTercentang;
                        }}
                        onChange={toggleSemua}
                      />
                    </th>
                  )}
                  <th>Komplain</th><th>Kategori</th><th>Pelapor</th><th>Status</th><th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    {bisaHapus && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Centang komplain ${c.title}`}
                          checked={terpilih.indexOf(c.id) !== -1}
                          onChange={() => toggleSatu(c.id)}
                        />
                      </td>
                    )}
                    <td>
                      <b>{c.title}</b>
                      {c.detail && <div className="sub" style={{ fontFamily: 'inherit' }}>{c.detail.slice(0, 90)}{c.detail.length > 90 ? '…' : ''}</div>}
                    </td>
                    <td><span className="link-tag">{catLabel(c.category)}</span></td>
                    <td>
                      <span className="row-avatar">{initials(c.reporter_name)}</span>
                      {c.reporter_name}
                      <div className="sub" style={{ marginLeft: 40 }}>{fmt(c.created_at)}</div>
                    </td>
                    <td>
                      {bisaUbah ? (
                        <select value={c.status} onChange={(e) => setStatus(c, e.target.value)}
                          style={{ color: STATUS_META[c.status]?.color, borderColor: STATUS_META[c.status]?.color }}>
                          <option value="baru">Baru</option>
                          <option value="diproses">Diproses</option>
                          <option value="selesai">Selesai</option>
                        </select>
                      ) : (
                        <>
                          <span className="status-dot" style={{ background: STATUS_META[c.status]?.color }} />
                          {STATUS_META[c.status]?.label || c.status}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="recap-actions">
                        <button className="btn act" onClick={() => openThread(c)}>💬 Balasan</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {bisaHapus && terpilihTampil.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={jumlahKolom} style={{ background: 'var(--raised)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 12.5 }}>{terpilihTampil.length} komplain dicentang</b>
                        <button
                          className="btn"
                          style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                          onClick={() => setKonfirmHapus({ ids: terpilihTampil, judul: null })}
                        >
                          Hapus {terpilihTampil.length} komplain
                        </button>
                        <button className="btn ghost" onClick={() => setTerpilih([])}>Batalkan centang</button>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
        <p className="cal-legend">
          Komplain kamu hanya terlihat olehmu dan lead. Semua laporan &amp; perubahan statusnya tercatat di Log Aktivitas.
          {bisaHapus && ' Menghapus komplain ikut menghapus seluruh balasannya, dan tidak bisa dibatalkan.'}
        </p>
      </div>

      {/* modal lapor */}
      {open && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--st-review)' }} />
                  Komplain
                </div>
                <div className="modal-title">Lapor Kendala</div>
                <div className="modal-sub">Kendala aplikasi, data, akses, atau usulan perbaikan alur kerja.</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ padding: '18px 24px' }}>
              <div className="field">
                <label>Kategori</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Judul</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="mis. Tombol ACC tidak muncul di kartu Review" />
              </div>
              <div className="field">
                <label>Detail</label>
                <textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })}
                  placeholder="Langkah yang dilakukan, apa yang terjadi, dan apa yang diharapkan" />
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Batal</button>
                <button className="btn primary" onClick={submit} disabled={busy || !form.title.trim()}>
                  {busy ? 'Mengirim…' : 'Kirim'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* modal thread */}
      {active && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: STATUS_META[active.status]?.color }} />
                  {catLabel(active.category)} · {STATUS_META[active.status]?.label}
                </div>
                <div className="modal-title">{active.title}</div>
                <div className="modal-sub">{active.reporter_name} · {fmt(active.created_at)}</div>
              </div>
              <button className="btn ghost modal-close" onClick={() => setActive(null)}>✕</button>
            </div>
            <div style={{ padding: '14px 24px' }}>
              {active.detail && <p className="thread-detail">{active.detail}</p>}
              <div className="thread-box">
                {messages.length === 0 && <div className="notes-empty">Belum ada balasan.</div>}
                {messages.map((m) => (
                  <div className="note-item" key={m.id}>
                    <span className="row-avatar note-avatar">{initials(m.author_name)}</span>
                    <div className="note-body">
                      <div className="note-meta">
                        <b>{m.author_name || 'anonim'}</b>
                        <span>{new Date(m.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="note-text">{m.message}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="note-input">
                <input value={newMsg} placeholder="Tulis balasan…"
                  onChange={(e) => setNewMsg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMsg()} />
                <button className="btn" onClick={sendMsg} disabled={msgBusy || !newMsg.trim()}>Kirim</button>
              </div>
            </div>
            <div className="modal-foot">
              {bisaHapus && (
                <button
                  className="btn"
                  style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
                  onClick={() => setKonfirmHapus({ ids: [active.id], judul: active.title })}
                >
                  Hapus
                </button>
              )}
              {bisaUbah && active.status !== 'selesai' && (
                <button className="btn" onClick={() => setStatus(active, 'selesai')}>✓ Tandai selesai</button>
              )}
              <div className="right">
                <button className="btn primary" onClick={() => setActive(null)}>Tutup</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi hapus (pengganti window.confirm yang diblokir browser) */}
      {konfirmHapus && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && !hapusBusy && setKonfirmHapus(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <div>
                <div className="modal-eyebrow">
                  <span className="sq" style={{ background: 'var(--red)' }} />
                  Hapus komplain
                </div>
                <div className="modal-title">
                  {konfirmHapus.ids.length > 1
                    ? `Hapus ${konfirmHapus.ids.length} komplain?`
                    : 'Hapus komplain ini?'}
                </div>
                {konfirmHapus.judul && <div className="modal-sub">{konfirmHapus.judul}</div>}
              </div>
              <button className="btn ghost modal-close" disabled={hapusBusy} onClick={() => setKonfirmHapus(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <p className="thread-detail">
                Komplain beserta <b>seluruh balasannya</b> akan hilang permanen dan tidak bisa dikembalikan.
                Pelapornya tidak diberi tahu.
              </p>
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setKonfirmHapus(null)} disabled={hapusBusy}>Batal</button>
                <button
                  className="btn primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  onClick={jalankanHapus}
                  disabled={hapusBusy}
                >
                  {hapusBusy ? 'Menghapus…' : (konfirmHapus.ids.length > 1 ? `Ya, hapus ${konfirmHapus.ids.length}` : 'Ya, hapus')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
