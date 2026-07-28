-- ============================================================
-- ALPHA — MIGRATION V14b (jalankan SETELAH v14a sukses)
-- Modul Pengajuan Budget.
-- Alur: team/manager ajukan -> PM ACC -> Finance tandai dibayar.
-- Bukti: saat request (QR/halaman payment) & saat dibayar (struk).
-- ============================================================

create table if not exists public.budget_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  category text not null default 'lainnya',   -- ads/boosting/langganan/buzzer/clipper/homeless/kol/lainnya
  title text not null,
  description text,
  amount bigint not null default 0,            -- rupiah
  urgency text default 'normal',               -- normal / mendesak
  -- bukti pengajuan (QR / halaman payment)
  request_proof_path text,
  request_proof_name text,
  -- alur & status: diajukan / disetujui / ditolak / dibayar
  status text not null default 'diajukan',
  requester_id uuid references public.profiles (id),
  requester_name text,
  -- ACC oleh PM
  approver_id uuid references public.profiles (id),
  approver_name text,
  approved_at timestamptz,
  reject_reason text,
  -- pembayaran oleh finance
  payer_id uuid references public.profiles (id),
  payer_name text,
  paid_at timestamptz,
  payment_proof_path text,
  payment_proof_name text,
  created_at timestamptz not null default now()
);

create index if not exists budget_project_idx on public.budget_requests (project_id);
create index if not exists budget_status_idx on public.budget_requests (status);

alter table public.budget_requests enable row level security;

-- Helper: apakah PM (boleh ACC budget)?
create or replace function public.is_pm()
returns boolean language sql security definer stable set search_path = public
as $$ select public.my_team() = 'pm' or coalesce(public.my_role() = 'superadmin', false); $$;

-- Helper: apakah finance (boleh tandai dibayar)?
create or replace function public.is_finance()
returns boolean language sql security definer stable set search_path = public
as $$ select public.my_team() = 'finance' or coalesce(public.my_role() = 'superadmin', false); $$;

-- SELECT: ikut tembok unit project (via can_see_project)
drop policy if exists budget_select on public.budget_requests;
create policy budget_select on public.budget_requests
  for select to authenticated
  using (public.my_role() is not null and public.can_see_project(project_id));

-- INSERT: team & manager boleh mengajukan (pada project yang boleh dilihat)
drop policy if exists budget_insert on public.budget_requests;
create policy budget_insert on public.budget_requests
  for insert to authenticated
  with check (
    public.can_see_project(project_id)
    and requester_id = auth.uid()
    and (public.my_role() in ('manager', 'superadmin') or public.my_role() = 'tim')
  );

-- UPDATE: PM (ACC/tolak) atau Finance (dibayar) atau superadmin
drop policy if exists budget_update on public.budget_requests;
create policy budget_update on public.budget_requests
  for update to authenticated
  using (public.can_see_project(project_id) and (public.is_pm() or public.is_finance()))
  with check (public.can_see_project(project_id) and (public.is_pm() or public.is_finance()));

-- DELETE: pengaju sendiri (selama masih diajukan) atau superadmin
drop policy if exists budget_delete on public.budget_requests;
create policy budget_delete on public.budget_requests
  for delete to authenticated
  using (public.is_pm() or requester_id = auth.uid() or coalesce(public.my_role() = 'superadmin', false));

grant select, insert, update, delete on public.budget_requests to authenticated;

-- ---- Storage bucket untuk bukti budget ----
insert into storage.buckets (id, name, public)
select 'budget', 'budget', false
where not exists (select 1 from storage.buckets where id = 'budget');

drop policy if exists budget_files_read on storage.objects;
create policy budget_files_read on storage.objects
  for select to authenticated using (bucket_id = 'budget');

drop policy if exists budget_files_write on storage.objects;
create policy budget_files_write on storage.objects
  for insert to authenticated with check (bucket_id = 'budget');

drop policy if exists budget_files_remove on storage.objects;
create policy budget_files_remove on storage.objects
  for delete to authenticated using (bucket_id = 'budget');

-- ---- Log aktivitas budget ----
create or replace function public.log_budget_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_email text; v_name text;
begin
  select email, full_name into v_email, v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_id, actor_email, actor_name, action, entity, entity_title, detail)
    values (auth.uid(), v_email, v_name, 'mengajukan', 'budget', new.title,
            new.category || ' · Rp' || new.amount::text);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_logs (actor_id, actor_email, actor_name, action, entity, entity_title, detail)
    values (auth.uid(), v_email, v_name, 'mengubah', 'budget', new.title, old.status || ' → ' || new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists budget_log on public.budget_requests;
create trigger budget_log
after insert or update on public.budget_requests
for each row execute function public.log_budget_change();

-- Cek: select * from budget_requests;
