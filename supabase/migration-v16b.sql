-- ============================================================
-- ALPHA — MIGRATION V16b
-- Tambah kolom kategori konten di laporan sebaran (untuk filter).
-- Nilai sama dengan pillar konten: lagi_ramai/wajib_tonton/di_balik_layar/panas_timeline
-- ============================================================
alter table public.distribution_logs
  add column if not exists content_category text;
