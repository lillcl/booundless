# 無界啟程 BOOUNDLESS — 車輛及保養管理

A web app for vehicle owners to manage vehicle details and service history,
review maintenance reminders, find service options, and plan 琴澳 (Hengqin/Macau) trips.

## Stack

| Layer        | Choice                                    |
| ------------ | ----------------------------------------- |
| Frontend     | Vanilla HTML / CSS / JS (no framework)    |
| API          | Vercel-style serverless functions (Node)  |
| Database     | PostgreSQL (`pg`; Supabase-compatible)    |
| Deploy       | Vercel (static + serverless functions)    |

## Project layout

```
.
├── index.html              # App shell + router mount
├── assets/                 # Frontend modules, styles, and images
├── api/
│   ├── index.js            # Main production API router
│   ├── ai.js / agent.js    # AI serverless entry points
│   ├── _handlers/          # HTTP handlers grouped by domain
│   └── _lib/
│       ├── db.js           # PostgreSQL connection + schema bootstrap
│       └── http.js         # JSON response helpers and body parsing
├── db/
│   ├── schema.sql          # Base schema
│   ├── *-schema.sql        # Additive domain schema slices
│   └── migrations/         # Ordered forward migrations
├── scripts/
│   └── dev-server.js       # Express shim for local dev
├── shared/                 # Shared constants and validation templates
├── tests/                  # Unit, integration, and Playwright E2E tests
├── reference/              # V10.4 design prototype (read-only)
├── vercel.json             # Vercel routing config
├── package.json
├── .env.example
└── README.md
```

## Local development

```bash
npm install
npm run dev
```

This starts an Express server on `http://127.0.0.1:3000` that:
- Mounts the same handler modules under `/api/*` that Vercel runs in production
- Applies `db/schema.sql` and seeds default data on first request
- Serves the static frontend at `/`

Configure a PostgreSQL database and session secret before starting:

```bash
KC_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/kc_carai \
KC_JWT_SECRET=replace-with-a-long-random-secret \
PORT=4000 npm run dev
```

See `.env.example` for the complete environment contract. The server loads a
local `.env` automatically.

## API

All responses are JSON. Errors use the envelope `{ "error": { "code", "message" } }`.

| Method | Path                        | Description                          |
| ------ | --------------------------- | ------------------------------------ |
| GET    | `/api/health`               | Liveness probe                       |
| GET    | `/api/vehicles`             | List vehicles                        |
| GET    | `/api/vehicles/:id`         | Fetch one vehicle                    |
| GET    | `/api/reminders`            | List upcoming/overdue reminders       |
| GET    | `/api/reminders/:id`        | Fetch one reminder                   |

## AI assistant access and costs

The assistant requires an active signed-in account. Chat questions, photo
recognition and AI-generated maintenance scopes share **5 uses per account
per Macau calendar day**, resetting at 00:00 Asia/Macau. Admin accounts have
no per-user question or daily-token limit; per-request and global cost guards
still apply. Rejected questions
and provider failures count once because they may incur AI cost. Invalid
requests, quota denials and confirming/cancelling an existing write do not.
Switching devices, clearing browser history or starting a new chat does not
reset the server-side quota. This is an account limit, not proof of a unique
human; account-creation abuse requires separate signup controls.

The first model response makes a semantic scope decision and either answers,
rejects with a relevant suggested question, asks for clarification, or plans
authorized tools. There is no separate classifier call or keyword gate.
Knowledge snippets, graph context and recent conversation are sent together;
private answers require authorized tool results. Writes require an explicit
confirmation card. Tool-based answers can need extra model turns.

Hard ceilings: 3 model calls, 6 business tools, 1,024 output tokens per call,
40,000 cumulative request tokens, 30-second agent deadline (each model call
is at most 25 seconds), 1 active request
per account, 8 globally, 200,000 daily tokens per account and 2,000,000 globally.
Shared database reservations enforce budgets before reaching the provider.
Missing provider usage or a crashed request is charged conservatively. The
environment settings can lower these caps, not raise them. The token ceiling
is an application-side guard using provider usage and conservative estimates,
not a provider billing guarantee or monetary spending cap.

Malformed decisions get one JSON-format recovery, with the same scope,
source, ownership and tool-schema checks. Whole JSON responses can be
validated without a recovery call; arbitrary prose is never rendered or
executed. Temporary transport/429/5xx failures get at most one retry if time,
tokens and model-call allowance remain. These recoveries share the original
quota admission and the three-call ceiling. Long Retry-After values are not
retried. There is no extra classifier on the successful path.

Failures have distinct public codes for timeout, invalid decision, provider
availability and request budget, plus a request reference in the UI. Private
run records retain attempt timing, stop reason and validation failure, not
raw provider reasoning in the public response. SSE keepalives and progress
events keep a waiting connection alive. Provider/network failures remain
possible; recovery is bounded, not a promise of 100% availability.

`GET /api/agent` returns authenticated quota. Every POST requires a UUID
`request_id`; reuse it only for an identical retry. Completed responses replay
without another model call or deduction. Quota denials return HTTP 429 and
`Retry-After`. Do not expose AI keys in the browser.

Before deploying this change, run `node scripts/migrate-assistant-usage.js` to
apply only `2026_10_assistant_policy_usage.sql`. This additive migration leaves
the existing application readiness marker and unrelated ledger entries intact,
so the old deployment remains compatible during rollout. The full migration
runner remains available for clean ledgers. Quota tables are server-only in
`app_private` with RLS and no browser-facing role access.

Run `npm run test:unit`. For shared-quota and tool tests, supply a disposable
PostgreSQL `TEST_DATABASE_URL` and run `npm run test:agent-integration`; the
suite applies schemas and inserts synthetic fixtures and refuses the app's
configured database. No live AI calls are made by these automated tests.
`scripts/test-assistant-live.js` is an opt-in real-provider 30-question regression
requiring a disposable local database, local server and isolated admin fixture.
It does not submit any confirmations or write production vehicle data.

## Database setup

The app requires PostgreSQL. It reads `SUPABASE_DB_URL` in cloud environments
or `KC_DATABASE_URL` locally. Development can apply the base schema, additive
schema slices, and ordered migrations automatically. Production releases
should run `node scripts/migrate.js` before deployment and validate readiness
using the release checklist.

## Deploy

### Vercel

```bash
npx vercel
```

Vercel reads `vercel.json`, routes most API traffic through `api/index.js`, and
keeps the AI endpoints separate for their longer execution limits. Configure
the PostgreSQL, authentication, origin, storage, and AI environment variables
listed in `RELEASE.md`; do not rely on a serverless function's local filesystem
for persistent data.

## Design reference

The `reference/kangcheng_v10_4/` directory contains the V10.4 visual prototype
that the current implementation is derived from. The prototype is a single
HTML file with inline SVG icons and CSS, kept for design comparison only —
the running app uses the modular sources at the repo root.

## Conventions

- **Source of truth:** `db/schema.sql`, additive schema slices and migrations
  for tables; `api/` for HTTP contracts.
- **No build step.** Frontend ships as authored files; `index.html` loads
  ES modules directly.
- **Serverless parity.** The same handler module is used by Vercel in
  production and the local Express shim in development — no behaviour drift.
- **API envelope.** Successful responses return the resource directly; lists
  return `{ data, count }`. Errors return `{ error: { code, message } }`.
