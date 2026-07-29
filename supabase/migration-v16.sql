-- ============================================================
-- ALPHA — MIGRATION V16
-- Modul Sebaran Harian (Distribution Log).
-- 3 pilar kredibilitas: timestamp server (created_at), deteksi
-- foto duplikat (proof_hash), field terstruktur.
-- ============================================================

create table if not exists public.distribution_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  platform text not null,                    -- facebook / whatsapp / telegram
  group_names text not null,                 -- daftar grup (bebas, boleh banyak baris)
  group_count int not null default 1,        -- jumlah grup yang disebar
  content_url text,                          -- link konten yang disebar (post sendiri)
  note text,
  proof_path text,                           -- file bukti di storage
  proof_name text,
  proof_hash text,                           -- sidik jari file (deteksi duplikat)
  reporter_id uuid references public.profiles (id),
  reporter_name text,
  created_at timestamptz not null default now()  -- TIMESTAMP SERVER (tak bisa diubah user)
);

create index if not exists dist_project_idx on public.distribution_logs (project_id);
create index if not exists dist_reporter_idx on public.distribution_logs (reporter_id);
create index if not exists dist_hash_idx on public.distribution_logs (proof_hash);
create index if not exists dist_created_idx on public.distribution_logs (created_at);

alter table public.distribution_logs enable row level security;

-- SELECT: ikut tembok unit; pelapor selalu lihat miliknya
drop policy if exists dist_select on public.distribution_logs;
create policy dist_select on public.distribution_logs
  for select to authenticated
  using (
    public.my_role() is not null
    and (reporter_id = auth.uid() or public.can_see_project(project_id))
  );

-- INSERT: semua user login boleh melapor untuk dirinya
drop policy if exists dist_insert on public.distribution_logs;
create policy dist_insert on public.distribution_logs
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and public.my_role() is not null
    and public.can_see_project(project_id)
  );

-- UPDATE: hanya superadmin (koreksi), agar laporan tak bisa diubah sembarang
drop policy if exists dist_update on public.distribution_logs;
create policy dist_update on public.distribution_logs
  for update to authenticated
  using (coalesce(public.my_role() = 'superadmin', false))
  with check (coalesce(public.my_role() = 'superadmin', false));

-- DELETE: pelapor sendiri (hari yang sama) atau superadmin
drop policy if exists dist_delete on public.distribution_logs;
create policy dist_delete on public.distribution_logs
  for delete to authenticated
  using (
    reporter_id = auth.uid()
    or coalesce(public.my_role() = 'superadmin', false)
  );

grant select, insert, update, delete on public.distribution_logs to authenticated;

-- ---- Storage bucket untuk bukti sebaran ----
insert into storage.buckets (id, name, public)
select 'sebaran', 'sebaran', false
where not exists (select 1 from storage.buckets where id = 'sebaran');

drop policy if exists sebaran_read on storage.objects;
create policy sebaran_read on storage.objects
  for select to authenticated using (bucket_id = 'sebaran');
drop policy if exists sebaran_write on storage.objects;
create policy sebaran_write on storage.objects
  for insert to authenticated with check (bucket_id = 'sebaran');
drop policy if exists sebaran_remove on storage.objects;
create policy sebaran_remove on storage.objects
  for delete to authenticated using (bucket_id = 'sebaran');

-- ---- Log aktivitas ----
create or replace function public.log_distribution_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_email text; v_name text;
begin
  select email, full_name into v_email, v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_id, actor_email, actor_name, action, entity, entity_title, detail)
    values (auth.uid(), v_email, v_name, 'melaporkan', 'sebaran',
            new.platform, new.group_count::text || ' grup');
  end if;
  return new;
end;
$$;

drop trigger if exists distribution_log on public.distribution_logs;
create trigger distribution_log
after insert on public.distribution_logs
for each row execute function public.log_distribution_change();

-- Cek: select * from distribution_logs;
