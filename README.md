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

## Database

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
