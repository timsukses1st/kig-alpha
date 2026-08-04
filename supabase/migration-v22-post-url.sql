-- ============================================================
-- ALPHA — MIGRATION V22
-- Menambah kolom post_url pada tabel contents.
-- Link konten yang sudah tayang (TikTok/IG), diisi Distribution.
--
-- Selain jadi bukti tayang, kolom ini adalah calon JEMBATAN ke
-- SIGMA: tabel posts di SIGMA punya kolom url, sehingga dua
-- sistem bisa dicocokkan lewat URL tanpa perlu kode apa pun.
--
-- CATATAN NOMOR VERSI:
-- Sesuaikan angka "v22" kalau di repo sudah ada migration v22.
-- Skrip ini idempotent (aman dijalankan berulang kali).
-- ============================================================

alter table public.contents
  add column if not exists post_url text;

comment on column public.contents.post_url is
  'Link konten yang sudah tayang di TikTok/IG. Diisi Distribution setelah upload. Calon jembatan pencocokan ke kolom url pada tabel posts di SIGMA.';

-- ============================================================
-- VERIFIKASI (jalankan setelah migration di atas)
-- ============================================================

-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'contents'
--   and column_name in ('hashtags', 'post_url', 'production_note')
-- order by column_name;

-- Hasil yang benar: 3 baris — hashtags, post_url, production_note.

-- Catatan RLS: kolom baru otomatis mengikuti policy tabel contents
-- yang sudah ada. Tidak ada policy baru yang perlu dibuat.
