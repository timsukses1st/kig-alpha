-- ============================================================
-- ALPHA — MIGRATION V14a (JALANKAN SENDIRI DULU)
-- Tambah team 'finance' ke enum. Postgres wajib commit nilai enum
-- baru sebelum dipakai — makanya dipisah dari v14b.
-- ============================================================
alter type app_team add value if not exists 'finance';
