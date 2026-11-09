-- Aggregates for the main dashboard (service-role only; caller passes the verified user id).
create or replace function public.daily_totals(p_user_id uuid, p_days int default 30)
returns table(date date, spend numeric, impressions bigint, link_clicks bigint, purchases numeric, revenue numeric)
language sql stable as $$
  select m.date,
         sum(m.spend), sum(m.impressions)::bigint, sum(m.link_clicks)::bigint,
         sum(m.purchases), sum(m.revenue)
  from public.ad_daily_metrics m
  where m.user_id = p_user_id
    and m.date >= current_date - greatest(p_days, 1)
  group by m.date
  order by m.date;
$$;

revoke execute on function public.daily_totals(uuid, int) from public, anon, authenticated;
grant execute on function public.daily_totals(uuid, int) to service_role;
