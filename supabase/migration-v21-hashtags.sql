-- ============================================================
-- ALPHA — MIGRATION V21
-- Menambah kolom hashtags pada tabel contents.
--
-- CATATAN NOMOR VERSI:
-- Sesuaikan angka "v21" kalau di repo sudah ada migration v21.
-- Isi skrip ini idempotent (aman dijalankan berulang kali).
--
-- CATATAN PENTING:
-- Kolom production_note SENGAJA TIDAK DIHAPUS. Field-nya hanya
-- disembunyikan dari tampilan Board. Data lama tetap utuh dan
-- keputusan menghapus permanen dibuat terpisah (irreversible).
-- ============================================================

-- 1) Tambah kolom hashtags
alter table public.contents
  add column if not exists hashtags text;

comment on column public.contents.hashtags is
  'Daftar hashtag untuk caption upload. Digabung dengan caption di kotak "Caption + Hashtag (siap salin)" pada Board.';

-- ============================================================
-- VERIFIKASI (jalankan setelah migration di atas)
-- ============================================================

-- a) Pastikan kolom sudah ada
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'contents'
--   and column_name in ('hashtags', 'production_note')
-- order by column_name;

-- b) Pastikan GRANT tidak berubah — anon TIDAK BOLEH punya privilege
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name = 'contents'
-- order by grantee, privilege_type;

-- Catatan RLS: kolom baru otomatis mengikuti policy tabel contents
-- yang sudah ada. Tidak ada policy baru yang perlu dibuat.
