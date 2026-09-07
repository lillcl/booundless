# 康程 CarAI — Service V10

A web app for vehicle owners to track maintenance reminders, browse service
options, and plan 琴澳 (Hengqin/Macau) self-driving trips.

## Stack

| Layer        | Choice                                    |
| ------------ | ----------------------------------------- |
| Frontend     | Vanilla HTML / CSS / JS (no framework)    |
| API          | Vercel-style serverless functions (Node)  |
| Database     | SQLite via `better-sqlite3`               |
| Deploy       | Vercel / Netlify (static + functions)     |

## Project layout

```
.
├── index.html              # App shell + router mount
├── css/
│   ├── tokens.css          # Design tokens (colour, type, spacing)
│   ├── base.css            # Reset + chrome (header, bottom-nav)
│   ├── components.css      # Reusable primitives (card, action, reminder)
│   └── views.css           # View-specific layout
├── js/
│   ├── app.js              # Entry: hash router + nav sync
│   ├── api.js              # API client
│   ├── icons.js            # Inline SVG icon library
│   └── views/
│       ├── home.js         # Home (greeting, reminders, fleet, trip)
│       └── stubs.js        # Placeholders for Garage/Service/琴澳/Videos/Profile
├── api/
│   ├── health.js           # GET /api/health
│   ├── vehicles.js         # GET /api/vehicles, /api/vehicles/:id
│   ├── reminders.js        # GET /api/reminders, /api/reminders/:id
│   └── _lib/
│       ├── db.js           # SQLite connection + auto-seed
│       └── http.js         # JSON response helpers
├── db/
│   ├── schema.sql          # Canonical schema (auto-applied)
│   └── seed.js             # Manual seed script (optional)
├── scripts/
│   └── dev-server.js       # Express shim for local dev
├── assets/
│   ├── icons/              # Inline SVG icons, favicon
│   └── scenic/             # Scenic photos used in cards
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

Override defaults with environment variables:

```bash
KC_DB_PATH=/tmp/kc.db PORT=4000 npm run dev
```

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

SQLite database file lives at `db/dev.db` (per-developer, gitignored).
Schema is in `db/schema.sql` and is auto-applied by `api/_lib/db.js` on first
connection. On an empty database, three vehicles and two reminders are seeded
so the Home view has something to show immediately.

To re-seed from scratch:

```bash
rm db/dev.db
npm run dev   # schema applied + auto-seed on first request
```

## Deploy

### Vercel

```bash
npx vercel
```

Vercel reads `vercel.json` and deploys:
- `api/*.js` as Node 20 serverless functions
- everything else as static assets
- `/api/*` paths routed to the matching handler

For persistent SQLite in production, point `KC_DB_PATH` at a Vercel Persistent
Volume or external database. For ephemeral/demo deployments, leave the default
file path — the function's local filesystem is writable for the duration of
the cold start.

### Netlify

Add `netlify.toml` with equivalent function routing. The same handler modules
in `api/*.js` will run unchanged.

## Design reference

The `reference/kangcheng_v10_4/` directory contains the V10.4 visual prototype
that the current implementation is derived from. The prototype is a single
HTML file with inline SVG icons and CSS, kept for design comparison only —
the running app uses the modular sources at the repo root.

## Conventions

- **Source of truth:** `db/schema.sql` for tables, `css/tokens.css` for design
  tokens, `api/` for HTTP contracts.
- **No build step.** Frontend ships as authored files; `index.html` loads
  ES modules directly.
- **Serverless parity.** The same handler module is used by Vercel in
  production and the local Express shim in development — no behaviour drift.
- **API envelope.** Successful responses return the resource directly; lists
  return `{ data, count }`. Errors return `{ error: { code, message } }`.