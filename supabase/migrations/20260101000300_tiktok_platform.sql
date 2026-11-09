-- TikTok support. Connections, ad accounts and ads carry the platform they came from.
-- TikTok object ids are stored in the shared meta_*_id columns with a "tiktok:" prefix so they can
-- never collide with Meta ids under the existing (user_id, meta_*_id) unique constraints.

alter table public.meta_connections
  add column platform text not null default 'meta' check (platform in ('meta', 'tiktok'));
alter table public.ad_accounts
  add column platform text not null default 'meta' check (platform in ('meta', 'tiktok'));
alter table public.ads
  add column platform text not null default 'meta' check (platform in ('meta', 'tiktok'));

create index ads_platform_idx on public.ads(user_id, platform);

grant select (platform) on public.meta_connections to authenticated;
