# Meta Ads Intelligence

Collect, store, search, monitor and analyse Meta and TikTok ads from ad accounts you are authorised to access.

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind, Recharts, SWR |
| Backend | NestJS 11, TypeScript, Swagger, pino logging, throttling |
| Auth / DB / Files | Supabase Auth, PostgreSQL (RLS), Storage (private bucket) |
| Jobs | BullMQ + Redis; separate worker process; DB-persisted schedules |
| Meta | Marketing API (Graph API, version configurable) |
| TikTok | Marketing API v1.3 (access token + advertiser ids) |

```
browser ──► frontend (Next.js :3000) ──► backend API (NestJS :3001) ──► Supabase (Postgres, Storage, Auth)
   └── Supabase Auth (sign-in, tokens)          │  enqueue                      ▲
                                                ▼                               │
                                      Redis ◄── worker (BullMQ processors + scheduler tick) ──► Meta Graph API
```

Meta access tokens are encrypted (AES-256-GCM) and only ever used by the backend/worker. The browser holds a Supabase session and talks to the API with its Bearer token. The service-role key, Meta tokens and Redis credentials are never sent to the frontend container.

## Docker setup

### Prerequisites
- Docker Desktop / Docker Engine with **Compose v2.24+**
- A Supabase project (**cloud**) or the Supabase CLI for the **local** stack (`npm i -g supabase`, scoop, or brew). The CLI is only needed for the local-Supabase option.
- No Node.js, NestJS, Next.js or Redis install is needed to run the app.

### 1. Choose a Supabase

**Option A: local Supabase (Auth + Postgres + Storage, via CLI + Docker)**
```bash
supabase start           # applies supabase/migrations automatically; first run pulls images
```
Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in your shell first if you want Google login locally (any dummy value is fine if you do not). Auth emails (confirm / reset) are caught at http://localhost:54324.

**Option B: cloud Supabase**
Create a project, then in the dashboard copy the project URL, anon key, service-role key and the Postgres connection string. Enable the Google provider under Authentication → Providers if you want Google login, and add `http://localhost:3000/auth/callback` and `/auth/reset` to the allowed redirect URLs. Note: the Free plan caps uploads at 50 MB (global storage limit); raise it under Storage settings for larger videos.

### 2. Environment
```bash
./scripts/setup-env.sh --local        # local Supabase: generates secrets and copies keys from `supabase status`
./scripts/setup-env.sh                # cloud: generates secrets, then edit the Supabase values in .env
# Windows PowerShell:  scripts\setup-env.ps1 -Local    (or without -Local)
```
Or copy `.env.example` to `.env` and fill it in by hand. Switching between cloud and local is purely a matter of changing these values — no code changes:

| Variable | Local Supabase | Cloud Supabase |
|---|---|---|
| `SUPABASE_URL` (browser) | `http://localhost:54321` | `https://<ref>.supabase.co` |
| `SUPABASE_INTERNAL_URL` (containers) | `http://host.docker.internal:54321` | *(empty)* |
| `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | from `supabase status` | project API settings |
| `DATABASE_URL` (migrations only) | `postgresql://postgres:postgres@host.docker.internal:54322/postgres` | project connection string |

### 3. Database migrations
Local `supabase start` already applied them. For cloud (or to re-apply):
```bash
docker compose run --rm migrate
```
The runner records history in `supabase_migrations.schema_migrations`, the same table the Supabase CLI uses, so both can be used interchangeably.

### 4. Run
```bash
docker compose up --build            # everything, foreground
docker compose up -d --build         # background
docker compose logs -f               # logs (add a service name: backend, worker, frontend, redis)
docker compose down                  # stop
docker compose build --no-cache      # clean rebuild
docker compose down -v               # DESTRUCTIVE: also deletes Redis data (queues, schedule ticks)
```
| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 (`/health`, `/api/v1/...`) |
| Swagger | http://localhost:3001/api/docs |
| Redis | internal only (`redis:6379`, password-protected) |

Hot reload for development (bind mounts, `next dev`, `nest start --watch`, Redis published on 127.0.0.1:6379):
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Production-style overrides (restart always, resource limits, JSON logs, Redis unpublished):
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 5. Lint and tests

Every change must pass lint with **zero warnings**, type checks and all tests (rules in [CLAUDE.md](CLAUDE.md)).
```bash
# on the host (Node 22+) ...
(cd backend && npm run lint && npx tsc --noEmit && npm test)        # ESLint + types + unit tests with coverage thresholds
(cd frontend && npm run lint && npm run typecheck && npm test)
# ... or inside containers, nothing installed on the host
docker compose run --rm lint-backend
docker compose run --rm lint-frontend
docker compose run --rm test-backend
docker compose run --rm test-frontend
docker compose up -d --build && docker compose run --rm test-e2e   # black-box checks of the running API (no Meta needed)
```

### 6. Integration tests (test/dev environments, no Meta credentials)

The real backend, worker, Redis and Supabase run against a **mock Meta Graph API** (`backend/src/testing/mock-meta`), selected purely by
environment (`META_GRAPH_BASE_URL`, `META_DIALOG_BASE_URL`, `MEDIA_ALLOWED_HOSTS`, see `docker-compose.test.yml`). Supabase must be running
(local CLI stack, or a **dedicated test project**: the tests create and delete users) and `.env` filled in.
```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build redis backend worker mock-meta
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --build test-integration
```
The mock implements every endpoint the app calls (profile, permissions, ad accounts incl. Business Manager, campaigns, ad sets, ads with `filtering`
and cursor pagination, creatives, ad images, videos, synchronous and **asynchronous** insights with age/gender, country, placement, device and
dynamic-creative asset breakdowns, OAuth code + long-lived token exchange, login dialog, Ad Library) plus media files, error injection
(`POST /__admin/fail`), latency (`/__admin/latency`) and a request log (`/__admin/requests`). You can run it standalone for manual development:
`docker compose -f docker-compose.yml -f docker-compose.test.yml up mock-meta`, then point a local backend at `http://localhost:4010`.
Suites in `backend/test/integration`: TikTok (connect, collect, analytics, media, scheduling, failures, isolation), Meta connections and OAuth, the full collection pipeline (search, persist, insights, media into Storage,
analytics, idempotency, async reports), resilience (retries, partial results, expired/forbidden tokens), scheduler (worker ticks, no duplicate
slots, overlap guard, pause/resume, failure notifications) and security/infrastructure (RLS, tenant isolation, private storage, Redis/BullMQ, worker health).

### Debugging
- `docker compose ps` shows health; `docker compose logs -f worker` shows collection, media and scheduler activity.
- The worker has its own health endpoint on port 3002 (container-internal) and finishes in-flight jobs on `docker compose stop` (60 s grace).
- A missing variable makes the backend exit immediately with `Missing required environment variables: …`.
- `host.docker.internal` is mapped for you (`extra_hosts: host-gateway`), including on Linux.

## Using the app
1. Register / sign in (email + password or Google). Password reset is on the login page.
2. **Connections**: connect Meta with Facebook login (needs `META_APP_ID/SECRET`) or paste a user / system-user token (required permission `ads_read`; `business_management` is recommended). Connect TikTok by pasting a Marketing API access token and the advertiser ids it may read. Select the ad accounts to use.
3. **Ad Search**: type keywords (tags). Results from your collected database appear instantly; the single **Collect ads** button queues a background run for every enabled Meta and TikTok account (or just the account you pick), with live progress and errors.
4. **Scheduler**: recurring collections every X hours/days/weeks/months in a chosen timezone, with pause/resume/run-now and execution history. Failures retry (3×, exponential backoff) then notify you; 5 consecutive failures auto-pause the schedule.
5. **Ad Library / ad page**: filters, sorting, previews and a full per-ad analytics dashboard (date ranges, breakdowns, fatigue, raw JSON).

## Meta permissions & behaviour
- Permissions: `ads_read` (required), `business_management` (lists Business-Manager-owned accounts). Standard/advanced access and app review requirements follow Meta’s rules for your use.
- Keyword search on Meta uses `CONTAIN` filters on ad, campaign and ad-set **names** (the Marketing API cannot filter by creative text). Headline / primary-text matching works on already-collected ads.
- Insights: sync requests for short ranges, **asynchronous report runs** for ≥31 days or ≥100 ads. Rate-limit headers are honoured; transient/rate-limit errors retry with exponential backoff and jitter.
- Competitor research via the Ad Library is an optional, separate endpoint (`META_AD_LIBRARY_ENABLED=true`), subject to Meta’s eligibility and without performance metrics.

## TikTok behaviour
- Auth: a TikTok for Business Marketing API access token plus the advertiser ids to read (copy them from Ads Manager). The token is checked with `advertiser/info`, stored encrypted and never returned. No OAuth flow yet.
- Search: like Meta, keywords match **names** of ads, campaigns and ad groups (`filtering.ad_name|campaign_name|adgroup_name`); headline / copy matching works on collected ads.
- Data: ad copy, call to action, landing page, cover / image URLs (stored in the private bucket), daily metrics and a range snapshot (spend, impressions, reach, clicks, video quartiles, average play time). Conversion metrics (purchases, revenue, installs) are **not requested and stay `null`**, so ROAS / CPA are empty for TikTok ads. Videos themselves are not downloaded.
- Insights run in 30-day windows (TikTok's limit for daily reports). Rate limits and transient errors retry with backoff; an invalid token marks the connection expired.
- Test / dev: the mock server also serves `/open_api/v1.3/...`; set `TIKTOK_API_BASE_URL=http://mock-meta:4010/open_api/v1.3` (already in `docker-compose.test.yml`). The behaviour follows TikTok's public docs and has **not** been verified against the live API.

## Production notes
- Terminate TLS at a reverse proxy; set `FRONTEND_URL`, `API_URL`, `CORS_ORIGINS`, `META_OAUTH_REDIRECT_URI` to public HTTPS URLs and add them to Meta and Supabase allow-lists.
- Scale workers with `docker compose up -d --scale worker=N`. Jobs are idempotent (deterministic job ids, unique `(schedule_id, scheduled_for)` slot claims, per-ad-account Redis lock), so multiple workers are safe.
- Back up Supabase Postgres (daily backups / PITR on paid plans) and the `ad-media` bucket; Redis holds only transient queue state (AOF is enabled) and can be rebuilt because schedules live in Postgres.
- Keep `TOKEN_ENCRYPTION_KEY` in a secret manager. Rotating it requires users to reconnect Meta.
- Set `SENTRY_DSN` for error monitoring; logs are structured JSON (pino) with auth headers redacted.
- Respect Meta’s platform terms, data-retention rules and copyright for stored media; the app only downloads media through authorised Graph endpoints and never works around restricted URLs.

See [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md) for the feature matrix, API list, schema, and known limitations.
