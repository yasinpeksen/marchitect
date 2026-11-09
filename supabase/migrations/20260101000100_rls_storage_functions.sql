-- Row Level Security, storage bucket + policies, and server-side SQL functions.

-- ------------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','meta_connections','ad_accounts','campaigns','ad_sets','ad_creatives','ads',
    'storage_assets','ad_assets','ad_insights','ad_daily_metrics','ad_breakdowns','search_tags',
    'saved_searches','schedules','collection_runs','schedule_executions','search_results',
    'analytics','ai_creative_tags','notifications','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Read-own policy for every user-owned table (profiles are keyed by id).
do $$
declare t text;
begin
  foreach t in array array[
    'meta_connections','ad_accounts','campaigns','ad_sets','ad_creatives','ads',
    'storage_assets','ad_assets','ad_insights','ad_daily_metrics','ad_breakdowns','search_tags',
    'saved_searches','schedules','collection_runs','schedule_executions','search_results',
    'analytics','ai_creative_tags','notifications','audit_logs'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid())',
      t || '_select_own', t);
  end loop;
end $$;

create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Writes to everything else go through the backend (service role). Strip direct
-- write grants from client roles as defence in depth.
revoke insert, delete, truncate on all tables in schema public from anon, authenticated;
revoke update on all tables in schema public from anon, authenticated;
grant update (display_name, avatar_url, timezone, settings) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on all tables in schema public from anon;

-- The encrypted Meta token must never be readable by client roles.
revoke select on public.meta_connections from authenticated;
grant select (id, user_id, meta_user_id, name, token_expires_at, scopes, graph_version, status,
              last_validated_at, last_error, created_at, updated_at)
  on public.meta_connections to authenticated;

-- ---------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('ad-media', 'ad-media', false, 524288000)
on conflict (id) do nothing;

-- Objects live under "<user_id>/..."; users may read only their own folder.
create policy ad_media_select_own on storage.objects for select to authenticated
  using (bucket_id = 'ad-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------------ Functions
-- Recompute denormalised lifetime sums on ads from collected daily metrics.
create or replace function public.refresh_ad_totals(p_ad_ids uuid[]) returns void
language sql as $$
  update public.ads a set
    total_spend = coalesce(s.spend, 0),
    total_impressions = coalesce(s.impressions, 0),
    total_link_clicks = coalesce(s.link_clicks, 0),
    total_purchases = coalesce(s.purchases, 0),
    total_revenue = coalesce(s.revenue, 0)
  from (
    select a2.id as ad_id,
           sum(m.spend) as spend, sum(m.impressions) as impressions,
           sum(m.link_clicks) as link_clicks, sum(m.purchases) as purchases, sum(m.revenue) as revenue
    from public.ads a2
    left join public.ad_daily_metrics m on m.ad_id = a2.id
    where a2.id = any(p_ad_ids)
    group by a2.id
  ) s
  where a.id = s.ad_id;
$$;

-- Indexed keyword search over collected ads, with filters, sorting and paging.
-- Filters (jsonb): date_from, date_to, ad_account_id, campaign_ids[], formats[], platforms[],
--                  statuses[], min_spend, min_impressions, min_ctr, min_roas
create or replace function public.search_ads(
  p_user_id uuid,
  p_keywords text[] default '{}',
  p_match text default 'any',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'recent',
  p_dir text default 'desc',
  p_limit int default 24,
  p_offset int default 0
) returns table(ad jsonb, total_count bigint)
language plpgsql stable as $$
declare
  v_patterns text[];
  v_sort text;
  v_dir text := case when lower(p_dir) = 'asc' then 'asc' else 'desc' end;
begin
  select coalesce(array_agg('%' || replace(replace(replace(lower(trim(k)), '\', '\\'), '%', '\%'), '_', '\_') || '%'), '{}')
    into v_patterns
  from unnest(coalesce(p_keywords, '{}')) k
  where trim(k) <> '';

  v_sort := case p_sort
    when 'spend' then 'a.total_spend'
    when 'impressions' then 'a.total_impressions'
    when 'clicks' then 'a.total_link_clicks'
    when 'revenue' then 'a.total_revenue'
    when 'purchases' then 'a.total_purchases'
    when 'ctr' then '(a.total_link_clicks * 100.0 / nullif(a.total_impressions, 0))'
    when 'roas' then '(a.total_revenue / nullif(a.total_spend, 0))'
    when 'name' then 'lower(a.name)'
    else 'coalesce(a.ad_created_time, a.first_seen_at)'
  end;

  return query execute format($q$
    select to_jsonb(a) - 'raw' - 'search_text', count(*) over()
    from public.ads a
    where a.user_id = $1
      and (cardinality($2) = 0 or (
            case when $3 = 'all'
                 then not exists (select 1 from unnest($2) p where a.search_text not like p)
                 else exists (select 1 from unnest($2) p where a.search_text like p)
            end))
      and (($4->>'date_from') is null or coalesce(a.ad_created_time, a.first_seen_at) >= ($4->>'date_from')::date)
      and (($4->>'date_to') is null or coalesce(a.ad_created_time, a.first_seen_at) < ($4->>'date_to')::date + 1)
      and (($4->>'ad_account_id') is null or a.ad_account_id = ($4->>'ad_account_id')::uuid)
      and (($4->'campaign_ids') is null or a.campaign_id::text in (select jsonb_array_elements_text($4->'campaign_ids')))
      and (($4->'formats') is null or a.format in (select jsonb_array_elements_text($4->'formats')))
      and (($4->'statuses') is null or a.effective_status in (select jsonb_array_elements_text($4->'statuses')))
      and (($4->'platforms') is null or a.platforms && array(select jsonb_array_elements_text($4->'platforms')))
      and (($4->>'min_spend') is null or a.total_spend >= ($4->>'min_spend')::numeric)
      and (($4->>'min_impressions') is null or a.total_impressions >= ($4->>'min_impressions')::bigint)
      and (($4->>'min_ctr') is null or a.total_link_clicks * 100.0 / nullif(a.total_impressions, 0) >= ($4->>'min_ctr')::numeric)
      and (($4->>'min_roas') is null or a.total_revenue / nullif(a.total_spend, 0) >= ($4->>'min_roas')::numeric)
    order by %s %s nulls last, a.id
    limit $5 offset $6
  $q$, v_sort, v_dir)
  using p_user_id, v_patterns, p_match, coalesce(p_filters, '{}'::jsonb), least(greatest(p_limit, 1), 200), greatest(p_offset, 0);
end $$;

-- Server-only: the backend passes the verified user id explicitly.
revoke execute on function public.search_ads(uuid, text[], text, jsonb, text, text, int, int) from public, anon, authenticated;
revoke execute on function public.refresh_ad_totals(uuid[]) from public, anon, authenticated;
grant execute on function public.search_ads(uuid, text[], text, jsonb, text, text, int, int) to service_role;
grant execute on function public.refresh_ad_totals(uuid[]) to service_role;
