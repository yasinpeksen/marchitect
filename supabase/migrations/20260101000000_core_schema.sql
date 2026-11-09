-- Meta Ads Intelligence: core schema.
-- All tables are user-owned (user_id -> auth.users) and protected by RLS.
-- The backend uses the service role and always filters by the authenticated user id.

create extension if not exists pg_trgm;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  ) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------- meta_connections
create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meta_user_id text not null,
  name text,
  token_encrypted text not null,            -- AES-256-GCM, never exposed to clients
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  graph_version text,                       -- null = use server default
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  last_validated_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_user_id)
);
create trigger trg_meta_connections_updated before update on public.meta_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ad_accounts
create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  meta_account_id text not null,            -- "act_123"
  name text,
  currency text,
  timezone_name text,
  account_status int,
  business_id text,
  business_name text,
  selected boolean not null default true,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_account_id)
);
create index ad_accounts_connection_idx on public.ad_accounts(connection_id);
create trigger trg_ad_accounts_updated before update on public.ad_accounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ campaigns
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  meta_campaign_id text not null,
  name text,
  objective text,
  status text,
  effective_status text,
  buying_type text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  stop_time timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_campaign_id)
);
create index campaigns_account_idx on public.campaigns(ad_account_id);
create index campaigns_name_trgm on public.campaigns using gin (lower(name) gin_trgm_ops);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------- ad_sets
create table public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  meta_adset_id text not null,
  name text,
  status text,
  effective_status text,
  optimization_goal text,
  billing_event text,
  daily_budget numeric,
  lifetime_budget numeric,
  start_time timestamptz,
  end_time timestamptz,
  targeting jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_adset_id)
);
create index ad_sets_campaign_idx on public.ad_sets(campaign_id);
create trigger trg_ad_sets_updated before update on public.ad_sets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ad_creatives
create table public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  meta_creative_id text not null,
  name text,
  title text,                               -- headline
  body text,                                -- primary text
  call_to_action_type text,
  link_url text,
  object_type text,
  format text check (format in ('image','video','carousel','dynamic','other')),
  image_url text,
  thumbnail_url text,
  image_hash text,
  video_id text,
  object_story_spec jsonb,
  asset_feed_spec jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_creative_id)
);
create trigger trg_ad_creatives_updated before update on public.ad_creatives
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------ ads
create table public.ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  ad_set_id uuid references public.ad_sets(id) on delete set null,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  meta_ad_id text not null,
  name text,
  status text,
  effective_status text,
  format text,
  platforms text[],
  campaign_name text,
  ad_set_name text,
  headline text,
  primary_text text,
  cta text,
  ad_created_time timestamptz,
  ad_updated_time timestamptz,
  -- denormalised lifetime sums over collected daily metrics (refresh_ad_totals)
  total_spend numeric not null default 0,
  total_impressions bigint not null default 0,
  total_link_clicks bigint not null default 0,
  total_purchases numeric not null default 0,
  total_revenue numeric not null default 0,
  first_seen_at timestamptz not null default now(),
  last_collected_at timestamptz,
  raw jsonb,
  search_text text generated always as (
    lower(coalesce(name,'') || ' ' || coalesce(campaign_name,'') || ' ' || coalesce(ad_set_name,'') || ' ' ||
          coalesce(headline,'') || ' ' || coalesce(primary_text,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meta_ad_id)
);
create index ads_user_created_idx on public.ads(user_id, ad_created_time desc);
create index ads_user_collected_idx on public.ads(user_id, last_collected_at desc);
create index ads_campaign_idx on public.ads(campaign_id);
create index ads_ad_set_idx on public.ads(ad_set_id);
create index ads_account_idx on public.ads(ad_account_id);
create index ads_creative_idx on public.ads(creative_id);
create index ads_status_idx on public.ads(user_id, effective_status);
create index ads_search_trgm on public.ads using gin (search_text gin_trgm_ops);
create trigger trg_ads_updated before update on public.ads
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- storage_assets
create table public.storage_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'ad-media',
  path text,
  kind text not null check (kind in ('image','video','thumbnail')),
  dedupe_key text not null,                 -- e.g. video:123, image:hash, thumb:creativeId
  mime_type text,
  size_bytes bigint,
  sha256 text,
  source_url text,
  source_ref text,
  status text not null default 'pending'
    check (status in ('pending','downloading','stored','failed','unavailable')),
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index storage_assets_status_idx on public.storage_assets(user_id, status);
create trigger trg_storage_assets_updated before update on public.storage_assets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- ad_assets
create table public.ad_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  storage_asset_id uuid references public.storage_assets(id) on delete set null,
  kind text not null check (kind in ('image','video','thumbnail')),
  meta_ref text not null,                   -- video id, image hash or creative id
  source_url text,
  width int,
  height int,
  duration_seconds numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, kind, meta_ref)
);
create index ad_assets_ad_idx on public.ad_assets(ad_id);
create index ad_assets_storage_idx on public.ad_assets(storage_asset_id);
create trigger trg_ad_assets_updated before update on public.ad_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- metric shape
-- Shared metric columns for ad_insights / ad_daily_metrics / ad_breakdowns.
-- Nullable on purpose: a missing metric stays NULL, never 0.

create table public.ad_insights (          -- historical snapshots per date range
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  date_start date not null,
  date_stop date not null,
  snapshot_date date not null default current_date,
  currency text,
  spend numeric,
  impressions bigint,
  reach bigint,
  frequency numeric,
  clicks bigint,
  link_clicks bigint,
  outbound_clicks bigint,
  installs numeric,
  registrations numeric,
  trials numeric,
  purchases numeric,
  revenue numeric,
  video_3s_views bigint,
  video_thruplays bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  avg_watch_seconds numeric,
  quality_ranking text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,
  raw jsonb,
  collected_at timestamptz not null default now(),
  unique (ad_id, date_start, date_stop, snapshot_date)
);
create index ad_insights_ad_idx on public.ad_insights(ad_id, collected_at desc);

create table public.ad_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  date date not null,
  currency text,
  spend numeric,
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  outbound_clicks bigint,
  installs numeric,
  registrations numeric,
  trials numeric,
  purchases numeric,
  revenue numeric,
  video_3s_views bigint,
  video_thruplays bigint,
  video_p25 bigint,
  video_p50 bigint,
  video_p75 bigint,
  video_p100 bigint,
  avg_watch_seconds numeric,
  raw jsonb,
  collected_at timestamptz not null default now(),
  unique (ad_id, date)
);
create index ad_daily_metrics_user_date_idx on public.ad_daily_metrics(user_id, date desc);

create table public.ad_breakdowns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  breakdown_type text not null
    check (breakdown_type in ('age_gender','country','placement','device',
                              'image_asset','video_asset','body_asset','title_asset',
                              'description_asset','link_url_asset','call_to_action_asset')),
  dim_key text not null,                    -- stable key, e.g. "25-34|female"
  dimensions jsonb not null,
  date_start date not null,
  date_stop date not null,
  currency text,
  spend numeric,
  impressions bigint,
  reach bigint,
  clicks bigint,
  link_clicks bigint,
  outbound_clicks bigint,
  installs numeric,
  registrations numeric,
  trials numeric,
  purchases numeric,
  revenue numeric,
  video_3s_views bigint,
  video_thruplays bigint,
  raw jsonb,
  collected_at timestamptz not null default now(),
  unique (ad_id, breakdown_type, dim_key, date_start, date_stop)
);
create index ad_breakdowns_ad_type_idx on public.ad_breakdowns(ad_id, breakdown_type);

-- ------------------------------------------------------------ search & history
create table public.search_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  usage_count int not null default 1,
  last_used_at timestamptz not null default now(),
  unique (user_id, tag)
);

create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tags text[] not null,
  match_mode text not null default 'any' check (match_mode in ('any','all')),
  filters jsonb not null default '{}'::jsonb,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_searches_user_idx on public.saved_searches(user_id, created_at desc);
create trigger trg_saved_searches_updated before update on public.saved_searches
  for each row execute function public.set_updated_at();

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  keywords text[] not null,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  interval_unit text not null check (interval_unit in ('hour','day','week','month')),
  interval_value int not null check (interval_value > 0 and interval_value <= 1000),
  timezone text not null default 'UTC',
  lookback_days int not null default 30 check (lookback_days between 1 and 1100),
  start_at timestamptz not null,
  end_at timestamptz,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  consecutive_failures int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schedules_due_idx on public.schedules(next_run_at) where enabled;
create index schedules_user_idx on public.schedules(user_id);
create trigger trg_schedules_updated before update on public.schedules
  for each row execute function public.set_updated_at();

create table public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete set null,
  trigger text not null check (trigger in ('manual','schedule')),
  keywords text[] not null,
  date_from date,
  date_to date,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','partial','failed')),
  stage text,
  progress int not null default 0,
  counters jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  error text,
  job_id text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index collection_runs_user_idx on public.collection_runs(user_id, created_at desc);
create index collection_runs_schedule_idx on public.collection_runs(schedule_id);

create table public.schedule_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  run_id uuid references public.collection_runs(id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed')),
  attempt int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, scheduled_for)       -- prevents duplicate executions of one slot
);
create index schedule_executions_schedule_idx on public.schedule_executions(schedule_id, scheduled_for desc);

create table public.search_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.collection_runs(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  keyword text not null,
  is_new boolean not null default false,
  matched_at timestamptz not null default now(),
  unique (run_id, ad_id, keyword)
);
create index search_results_ad_idx on public.search_results(ad_id);

-- ------------------------------------------------------------------- analytics
create table public.analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  range_key text not null,                  -- "lifetime" or "YYYY-MM-DD..YYYY-MM-DD"
  date_from date,
  date_to date,
  metrics jsonb not null,
  computed_at timestamptz not null default now(),
  unique (ad_id, range_key)
);

create table public.ai_creative_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id uuid not null references public.ads(id) on delete cascade,
  tag text not null,
  category text,
  confidence numeric check (confidence between 0 and 1),
  source text not null default 'manual' check (source in ('manual','ai')),
  created_at timestamptz not null default now(),
  unique (ad_id, tag)
);

-- ------------------------------------------------- notifications & audit logs
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_user_idx on public.audit_logs(user_id, created_at desc);
