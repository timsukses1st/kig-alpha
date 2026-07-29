-- ============================================================
-- ALPHA — MIGRATION V15
-- Modul Lembur (input manual).
-- Semua user ajukan; manager approve; ikut tembok unit project.
-- ============================================================

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete set null,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  description text not null,               -- apa yang dikerjakan
  status text not null default 'diajukan', -- diajukan / disetujui / ditolak
  requester_id uuid references public.profiles (id),
  requester_name text,
  approver_id uuid references public.profiles (id),
  approver_name text,
  decided_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index if not exists ot_project_idx on public.overtime_requests (project_id);
create index if not exists ot_requester_idx on public.overtime_requests (requester_id);
create index if not exists ot_status_idx on public.overtime_requests (status);

alter table public.overtime_requests enable row level security;

-- Helper: apakah boleh approve lembur? (manager & superadmin)
create or replace function public.can_approve_overtime()
returns boolean language sql security definer stable set search_path = public
as $$ select public.my_role() in ('manager', 'superadmin'); $$;

-- SELECT: ikut tembok unit project. Pengaju selalu lihat miliknya sendiri.
drop policy if exists ot_select on public.overtime_requests;
create policy ot_select on public.overtime_requests
  for select to authenticated
  using (
    public.my_role() is not null
    and (requester_id = auth.uid() or public.can_see_project(project_id))
  );

-- INSERT: semua user login boleh mengajukan lembur untuk dirinya
drop policy if exists ot_insert on public.overtime_requests;
create policy ot_insert on public.overtime_requests
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and public.my_role() is not null
    and public.can_see_project(project_id)
  );

-- UPDATE: manager approve/tolak (pada project yang boleh dilihat)
drop policy if exists ot_update on public.overtime_requests;
create policy ot_update on public.overtime_requests
  for update to authenticated
  using (public.can_approve_overtime() and public.can_see_project(project_id))
  with check (public.can_approve_overtime() and public.can_see_project(project_id));

-- DELETE: pengaju sendiri (selama masih diajukan) atau superadmin
drop policy if exists ot_delete on public.overtime_requests;
create policy ot_delete on public.overtime_requests
  for delete to authenticated
  using (
    (requester_id = auth.uid() and status = 'diajukan')
    or coalesce(public.my_role() = 'superadmin', false)
  );

grant select, insert, update, delete on public.overtime_requests to authenticated;

-- ---- Log aktivitas lembur ----
create or replace function public.log_overtime_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_email text; v_name text;
begin
  select email, full_name into v_email, v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.activity_logs (actor_id, actor_email, actor_name, action, entity, entity_title, detail)
    values (auth.uid(), v_email, v_name, 'mengajukan', 'lembur',
            to_char(new.work_date, 'DD Mon YYYY'),
            new.start_time::text || '–' || new.end_time::text);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_logs (actor_id, actor_email, actor_name, action, entity, entity_title, detail)
    values (auth.uid(), v_email, v_name, 'mengubah', 'lembur',
            to_char(new.work_date, 'DD Mon YYYY'), old.status || ' → ' || new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_log on public.overtime_requests;
create trigger overtime_log
after insert or update on public.overtime_requests
for each row execute function public.log_overtime_change();

-- Cek: select * from overtime_requests;
