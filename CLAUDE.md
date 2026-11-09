# Project rules (Meta Ads Intelligence)

Monorepo: `backend/` (NestJS API + BullMQ worker), `frontend/` (Next.js), `supabase/migrations/`, Docker Compose at the root. See `README.md`.

## Mandatory workflow after ANY code change

Run these before saying the work is finished. Do not declare completion until all are green; report failures honestly with the failing output.

1. **Lint: zero errors AND zero warnings** in every touched package (`--max-warnings 0` is built in):
   - `cd backend && npm run lint`
   - `cd frontend && npm run lint`
   - Never downgrade a rule to `warn`, never loosen `eslint.config.mjs` to make code pass, never add `eslint-disable` to hide a real problem. Fix the code.
2. **Types:** `npx tsc --noEmit` in the touched package(s) (`npm run typecheck` in the frontend).
3. **Unit tests** (they enforce coverage thresholds):
   - `cd backend && npm test`
   - `cd frontend && npm test`
4. **Integration tests** whenever integrations, scheduler, queues, storage, SQL migrations, auth/RLS or Docker files changed (needs Docker + a running Supabase and a filled `.env`):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build redis backend worker mock-meta
   docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --build test-integration
   ```
   Everything also runs in containers: `docker compose run --rm lint-backend | lint-frontend | test-backend | test-frontend`.

## Code rules

- **Every change of code must comply with the lint configuration** (`backend/eslint.config.mjs`, `frontend/eslint.config.mjs`).
- **Every function you create must have unit tests** next to the code (`*.spec.ts` in `backend/src`, `*.test.ts(x)` in `frontend/src`): services, helpers, guards, processors, hooks, components, pages, test helpers. Cover the success path and the meaningful edge/failure cases. If you touch a function that has no unit test, add one.
  - Put logic in small exported functions (pure where possible) so it is testable, instead of burying it in a large method or component.
  - Only the thin `@Controller` classes (inside `*.module.ts`, they just delegate to services) and bootstrap files (`main.ts`, `worker.ts`, `scripts/migrate.ts`) are excluded from unit coverage; they are exercised by `backend/test/integration`.
  - Backend/ frontend coverage thresholds live in `backend/package.json` (`jest.coverageThreshold`) and `frontend/vitest.config.ts`; do not lower them.
- **Variable naming:** every identifier (variable, parameter, function, class, type) must have a descriptive, fully spelled-out name saying what it holds or does.
  - No single-letter names, not even `i`, `e`, `x`, `a`, `_` in callbacks or loops (use `_unused`-style names for ignored parameters).
  - Do not abbreviate: `request` not `req`, `response` not `res`, `error` not `err`, `index` not `idx`, `configuration` not `cfg`, `context` not `ctx`, `message` not `msg`, `supabase` not `sb`, `account` not `acct`, `connection` not `conn`, `parameters` not `params`, `arguments_` not `args`.
  - Domain acronyms that are the real name of the thing are fine (`url`, `id`, `dto`, `api`, `json`, `ctr`, `cpm`, `cpc`, `roas`, `ipm`, `cpa`).
  - Enforced by `id-length` and `unicorn/prevent-abbreviations`. `eslint --fix` must NOT be used to rename: it leaves dangling references. Rename by hand and re-run tsc + tests.
- **Types:** no `any` (`@typescript-eslint/no-explicit-any` is an error). Model Meta payloads and API responses with interfaces (`backend/src/common/types.ts`, `frontend/src/lib/types.ts`).
- **Complexity:** functions stay under the lint limits (`complexity` 25, `max-depth` 4, `max-params` 6). Split big functions/components instead of raising limits.
- Missing metrics are `null`, never `0`. Never invent data. Never expose Meta tokens, the Supabase service-role key or Redis credentials to the frontend, logs or error messages (Meta messages are passed through `redactTokens`).
- **Integrations must stay testable without real credentials.** The Meta Graph base URL is configurable (`META_GRAPH_BASE_URL`, `META_DIALOG_BASE_URL`, `MEDIA_ALLOWED_HOSTS`) and the mock server in `backend/src/testing/mock-meta` implements every endpoint we call. When you call a new Meta endpoint, add it to the mock (with a unit test) and cover it in `backend/test/integration`.
