# Implementation report

Status date: 2026-11-07. **Read “Verification status” first: the Meta integration and the full runtime path have not been exercised against real credentials.**

## Verification status

| Check | Result |
|---|---|
| ESLint, zero warnings (backend + frontend; naming, no `any`, complexity, floating promises, react-hooks, Next rules) | Pass |
| TypeScript compile (backend, frontend) and `next build` | Pass |
| Backend unit tests (527, incl. mock Meta server) with coverage thresholds (97% statements / 95% functions) | Pass |
| Frontend unit tests (278: lib, components, every page) with coverage thresholds (95% statements / 90% functions) | Pass |
| Integration tests against the real stack (local Supabase, Redis, backend, worker) with a **mock Meta Graph API** (87 tests: connections/OAuth/Ad Library, full collection pipeline incl. media in Storage and async insights, resilience, scheduler, security/RLS/Redis/worker) | Pass |
| `docker compose run --rm test-e2e` black-box API checks | Pass |
| Browser smoke of the UI (earlier run, before the naming/lint refactor) | Pass; re-run recommended |
| Anything calling the **real** Meta Graph API | **Not verified**: no Meta credentials and no Meta API JSON specification were supplied. Behaviour is verified against the mock, which follows Meta's public documentation |

How integrations are made testable: the Graph base URL (`META_GRAPH_BASE_URL`), login dialog URL (`META_DIALOG_BASE_URL`) and extra media hosts
(`MEDIA_ALLOWED_HOSTS`) are environment settings, so the same code runs against Meta or the mock. In test/dev stacks `SCHEDULER_TICK_MS` and
`META_RETRY_BASE_MS` shorten waits. See README → “Integration tests”.

Bugs found and fixed by this validation: optional DTO fields were present as `undefined` own properties (ES2022 class fields) and broke schedule
edit/pause (`useDefineForClassFields: false`); Meta error messages echoed the access token into stored run errors (now redacted); label-wrapped chip
buttons had the wrong accessible name (now role=group). Known gap found: `POST /search/collect` checks for an in-flight identical run before
inserting, so two truly simultaneous requests can create two runs (harmless: collection is idempotent and serialised per ad account by a lock).

**Missing input:** the “supplied Meta API JSON specification” was not present in the workspace. Endpoints, fields and parsing follow Meta’s public Graph/Marketing API documentation from knowledge (field names such as `inline_link_clicks`, `video_thruplay_watched_actions`, `quality_ranking`, async `report_run_id` flow). Field lists live in `backend/src/meta/meta-api.client.ts` and `backend/src/analytics/parse-insights.ts`; reconcile them against the spec when available.

## Completed features
- **Auth**: Supabase email/password, Google, password reset; protected routes (cookie check) + API guard validating the Bearer token with Supabase; RLS on every table.
- **Meta integration**: token connect and OAuth (long-lived exchange), permission check, encrypted token storage, ad-account sync (personal + Business Manager), campaigns/ad sets/ads/creatives/ad images/video endpoints, insights (sync + async reports), pagination, retries with exponential backoff + jitter, usage-header throttling, `appsecret_proof`, configurable Graph version, optional Ad Library endpoint.
- **Collection pipeline**: validate keywords → report existing matches → Meta lookup (ad/campaign/ad-set name filters) → upsert hierarchy + creatives → daily metrics, range snapshot, breakdowns → media planning → analytics recalculation; live progress in `collection_runs`; partial-success accounting; results queryable as soon as ads are saved.
- **Instant search**: indexed (`pg_trgm`) SQL function with multi-keyword any/all, filters (date, campaign, format, platform, status, spend/impressions/CTR/ROAS), sorting, pagination; tags with suggestions; saved searches; history.
- **Scheduler**: persisted schedules, every X hours/days/weeks/months, timezone-aware (DST-safe, month-anchored), start/end, pause/resume/edit/delete/run-now, execution history, duplicate prevention (unique slot claim + overlap guard + deterministic job ids), BullMQ retries, failure notifications, auto-pause after 5 consecutive failures.
- **Media**: dedicated private `ad-media` bucket, dedupe keys + content-addressed paths, status/error tracking, host allow-list (SSRF guard), size cap, signed URLs, unavailable media recorded (never bypassed).
- **Analytics engine**: all requested formulas, null-safe (no invented metrics), non-additive reach handling, video hook/hold/completion, rankings, fatigue (first/last 7-day CTR, drop %, trend slope), daily series, per-ad dashboard with date range, breakdowns (age/gender, country, placement, device, dynamic-creative assets), creative variations, targeting, raw JSON viewer.
- **UI**: login/register/reset, dashboard, search, library, ad analytics, saved searches, scheduler, collection history, Meta connections, settings, notifications bell; responsive.
- **Ops**: structured logs with redaction, Sentry hook, rate limiting, audit log table + writes for key actions, global error format, Swagger.
- **Docker**: multi-stage images, compose (base/dev/prod), health checks, volumes, restart policies, tools profile (migrate/tests), env templates and setup scripts.

## Incomplete / partial, and why
| Item | State | Reason |
|---|---|---|
| AI creative tagging | Table + manual tag API only; no AI generation | Out of the specified scope beyond the table; needs a model/provider decision |
| Email / push notifications | In-app only | No mail provider specified |
| Resumable (TUS) uploads for very large videos | Single multipart upload from a file-backed Blob | Marked with a `ponytail:` note in `media.service.ts`; add TUS if videos regularly exceed ~100 MB |
| Meta creative-text search on Meta’s side | Name filters only | Marketing API cannot filter by headline/body; handled locally on collected ads |
| Validation against the real Meta API | Not done | No credentials/spec supplied; mock-based integration tests instead |
| Playwright/browser E2E, RLS policy tests, load tests | Not written | Time; RLS verified only by migration applying cleanly |
| Storage object clean-up on ad deletion | Not implemented | Objects are content-addressed and may be shared |
| Redis TLS / ACLs, secret-manager integration | Documented only | Deployment-specific |

## Implemented API endpoints (`/api/v1`, Bearer auth unless noted)
- `GET /health` (public, no prefix) · `GET /auth/me`
- `GET|PATCH /users/me`
- `GET /meta/status` · `GET|POST /meta/connections` · `POST /meta/connections/:id/sync` · `DELETE /meta/connections/:id` · `GET /meta/oauth/url` · `GET /meta/oauth/callback` (public) · `GET /meta/ad-library/search`
- `GET /ad-accounts` · `PATCH /ad-accounts/:id`
- `GET /campaigns` · `GET /ad-sets` · `GET /creatives/:id`
- `GET /ads` (instant search/library) · `GET /ads/:id` · `GET /ads/:id/raw` · `POST /ads/:id/tags` · `DELETE /ads/:id/tags/:tagId`
- `GET /ads/:id/analytics?from&to` · `GET /ads/:id/snapshots` · `POST /insights/refresh` · `POST /analytics/recalculate` · `GET /dashboard`
- `POST /search/collect` · `GET /search/tags` · `GET /search/history` · `GET /collection-runs` · `GET /collection-runs/:id`
- `GET|POST /saved-searches` · `PATCH|DELETE /saved-searches/:id` · `POST /saved-searches/:id/run`
- `GET|POST /schedules` · `PATCH|DELETE /schedules/:id` · `POST /schedules/:id/run` · `GET /schedules/:id/executions`
- `POST /media/retry` · `GET /notifications` · `POST /notifications/read`

Meta endpoints called: `GET /me`, `/me/permissions`, `/me/adaccounts`, `/me/businesses`, `/{business}/owned_ad_accounts|client_ad_accounts`, `/act_{id}`, `/act_{id}/campaigns|adsets|ads|adcreatives|adimages|insights` (+ async `POST` and `/{report_run_id}`), `/{video_id}`, `/?ids=`, `/debug_token`, `/oauth/access_token`, `/ads_archive` (optional).

## Database schema
Migrations in `supabase/migrations/` (core schema, RLS + storage + SQL functions, dashboard functions). All tables carry `user_id → auth.users` and RLS “select own”; writes go through the backend service role (client write grants revoked; `meta_connections.token_encrypted` is column-revoked from client roles).

Relationships: `meta_connections 1─* ad_accounts 1─* campaigns 1─* ad_sets 1─* ads *─1 ad_creatives`; `ads 1─* ad_assets *─1 storage_assets`; `ads 1─* ad_insights | ad_daily_metrics | ad_breakdowns | analytics | ai_creative_tags | search_results`; `saved_searches`, `schedules 1─* schedule_executions *─1 collection_runs 1─* search_results`; plus `profiles`, `search_tags`, `notifications`, `audit_logs`. Uniqueness: `(user_id, meta_ad_id)` etc. for every Meta object, `(ad_id, date)` for daily metrics, `(schedule_id, scheduled_for)` for executions, `(user_id, dedupe_key)` for media. Raw Meta payloads are kept as JSONB next to normalised columns. Search uses a generated `search_text` column with a trigram GIN index; SQL functions: `search_ads`, `refresh_ad_totals`, `daily_totals` (service-role only).

## Required Meta permissions
`ads_read` (required), `business_management` (recommended). Ad Library access additionally depends on Meta’s identity-verification/eligibility.

## Environment variables
See `.env.example` (documented inline). Required: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `REDIS_PASSWORD`, and `DATABASE_URL` for the migrate tool. Optional: `META_APP_ID/SECRET` (OAuth), `META_GRAPH_VERSION`, collection/worker tuning, `SENTRY_DSN`, `META_AD_LIBRARY_ENABLED`.

## Known limitations
- Reach/frequency are unique-people metrics and are shown only when the selected range covers all collected data (otherwise `—`), never summed from days.
- Video completion rates are measured against 3-second views; average watch time is a 3s-view-weighted mean of daily averages.
- Conversion event mapping uses the first present action type in a priority list (omni → pixel → app); custom events need mapping changes in `parse-insights.ts`.
- Breakdowns cover the range of the last collection, independent of the dashboard date picker; the picker filters daily metrics only.
- Missed scheduled slots (downtime) collapse into a single catch-up run.
- Instant search is substring matching, not stemming/ranking.
- Meta budgets are stored in the account currency’s minor units as returned by the API.
- Docker Desktop must be running; local Supabase requires the Supabase CLI on the host.
