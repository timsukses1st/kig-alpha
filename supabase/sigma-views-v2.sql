-- ============================================================
-- SIGMA — VIEW untuk integrasi Alpha (JALANKAN DI SUPABASE SIGMA)
-- Sudah dijalankan sebelumnya; disertakan sebagai arsip.
-- ============================================================

-- 1) Feed tracker: metrik post + nama & unit project
create or replace view public.alpha_tracker_feed as
select
  p.id, p.project_id, p.url, p.category, p.account, p.platform, p.ig_type,
  p.followers, p.upload_date, p.last_scraped, p.cover_url,
  p.views, p.likes, p.comments, p.saves, p.shares, p.reposts, p.is_manual,
  pr.name as project_name,
  pr.unit as project_unit
from public.posts p
left join public.projects pr on pr.id = p.project_id;

grant select on public.alpha_tracker_feed to anon, authenticated;
alter view public.alpha_tracker_feed set (security_invoker = false);

-- 2) Feed project: daftar project KC/GME/KIG non-arsip (untuk auto-sync)
create or replace view public.alpha_project_feed as
select id, name, unit
from public.projects
where archived = false
  and unit in ('KC', 'GME', 'KIG');

grant select on public.alpha_project_feed to anon, authenticated;
alter view public.alpha_project_feed set (security_invoker = false);
