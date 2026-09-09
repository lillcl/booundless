# Plan: Auth, Admin, and Audit Log

> **Status**: Proposed — awaiting approval before implementation.
> **Author**: Claude (assistant)
> **Created**: 2026-09-09
> **Last updated**: 2026-09-09

## 1. Goal

Add an authentication layer and an admin console to the康程 CarAI demo so that:

- A bootstrap **admin** user can sign in (`admin@example.com` / `admin123`).
- The admin can **create, read, update, and delete users** (CRUD).
- The admin can view **every user's assets** (vehicles, reminders, service history) in one place.
- Every meaningful action — login, logout, user mutation, asset mutation — is recorded in an **audit log** with a **unique action id** (UUID), actor, target, payload, and timestamp.
- The public demo (home, car list, profile) keeps working without authentication.

The work is bounded to local development + Vercel deployment; no external IdP, no email service, no production hardening beyond what's reasonable for a demo.

## 2. Non-goals

- No email verification, no password reset flow, no 2FA, no SSO.
- No fine-grained RBAC beyond a single `admin` / `user` distinction.
- No linking of `users` to `vehicles` via a foreign key — the existing `vehicles.owner` string field stays free-form for now; a future pass can introduce a `vehicle_user` mapping.
- No rate-limiting inside the app — relies on Vercel's network-edge limits.
- No deletion of historical audit rows.

## 3. Data model

All changes are **additive** to `db/schema.sql` — existing tables and seed data are untouched. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is used so the migration is safe to re-run.

### 3.1 New table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,                    -- ulid-style id
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,                       -- bcrypt
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  display_name   TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
```

The bootstrap admin is seeded idempotently:

```sql
INSERT INTO users (id, email, password_hash, role, display_name)
VALUES (
  'u-admin-bootstrap',
  'admin@example.com',
  -- bcrypt hash of 'admin123', cost factor 10
  '$2b$10$...',
  'admin',
  'Bootstrap Admin'
)
ON CONFLICT (email) DO NOTHING;
```

The bcrypt hash is computed at seed time by `db.js` (or by a one-shot script) so the plain password never appears in code or commits.

### 3.2 New table: `audit_log`

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- unique action id
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT NOT NULL,                                 -- denormalised for readability
  action        TEXT NOT NULL,                                  -- e.g. 'user.create'
  target_type   TEXT,                                           -- 'user' | 'vehicle' | 'reminder' | 'service' | null
  target_id     TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,            -- before/after diff, params
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target    ON audit_log(target_type, target_id);
```

Notes:
- `gen_random_uuid()` is built into Postgres 13+ (Supabase runs 15+). The seed migration enables `pgcrypto` only if needed; on modern Postgres the function is in the default namespace.
- `actor_email` is denormalised so the audit log remains readable after a user is deleted or renamed.

### 3.3 Optional audit columns on existing tables

These are nullable and only set when the action is performed by an authenticated user. Legacy data keeps `NULL`.

```sql
ALTER TABLE vehicles        ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vehicles        ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reminders       ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE service_history ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
```

(The public read endpoints don't surface these — they only flow into the audit log and admin-only views.)

## 4. Auth model

### 4.1 Algorithm

- **Password storage**: bcrypt, cost factor 10 (`bcryptjs`, pure JS, works on Vercel without native build).
- **Session**: signed JWT (HS256) in an `httpOnly, SameSite=Strict, Path=/, Max-Age=7d, Secure` cookie. The cookie name is `kc_session`.
- **JWT claims**: `{ sub: userId, email, role, iat, exp }`.
- **Signing key**: `process.env.KC_JWT_SECRET` — a long random string. The dev `.env.example` documents it; production reads it from Vercel env.
- **Verification**: every request runs the JWT through `jose.jwtVerify`. Failures return 401; admin-gated routes additionally check `payload.role === 'admin'`.
- **Login throttling**: not in this pass. Brute force on a Vercel-deployed app is bounded by Vercel's edge rate limits.

### 4.2 Cookie flags (production)

```
Set-Cookie: kc_session=<jwt>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

In local dev `Secure` is dropped (HTTPS off).

## 5. API surface

All new endpoints are under `/api/`. Methods in **bold** mutate and write to `audit_log`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | public | Body: `{ email, password }` → 200 + Set-Cookie. Writes `auth.login`. |
| POST | `/api/auth/logout` | user | Clears cookie. Writes `auth.logout`. |
| GET | `/api/auth/me` | optional | Returns `{ user }` or 401 if no session. |
| GET | `/api/users` | admin | List users (without password_hash). |
| **POST** | `/api/users` | admin | Create user. Body: `{ email, password, role?, display_name? }`. Writes `user.create`. |
| **PATCH** | `/api/users/:id` | admin | Update role / password / display_name. Writes `user.update`. |
| **DELETE** | `/api/users/:id` | admin | Soft-delete (sets `is_active = false`). Writes `user.delete`. |
| GET | `/api/assets` | admin | Every vehicle + reminder + service_history row across the system, with owner labels. |
| GET | `/api/audit` | admin | Paginated audit log. Query: `?limit=50&before=<cursor>&actor=<email>&action=<code>`. |

### 5.1 Error envelope

```json
{ "error": { "code": "unauthorized", "message": "Invalid email or password" } }
```

Codes used:

| HTTP | code |
| --- | --- |
| 400 | `bad_request` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict` (e.g. email already in use) |
| 422 | `unprocessable` (validation) |
| 500 | `internal_error` |

## 6. Audit actions

Every mutating call writes one row. Read-only calls do not write.

| Action | Target type | Payload fields |
| --- | --- | --- |
| `auth.login` | — | `{ user_id }` |
| `auth.logout` | — | `{ user_id }` |
| `auth.failed` | — | `{ email, reason }` (no user_id — failed login attempts are tracked) |
| `user.create` | `user` | `{ before: null, after: { id, email, role, display_name } }` |
| `user.update` | `user` | `{ before, after, fields_changed: [...] }` |
| `user.delete` | `user` | `{ before: { id, email }, soft: true }` |
| `vehicle.create` | `vehicle` | `{ after: { id, model, plate } }` |
| `vehicle.update` | `vehicle` | `{ before, after, fields_changed }` |
| `vehicle.delete` | `vehicle` | `{ before: { id, model } }` |
| `reminder.create` | `reminder` | `{ after }` |
| `reminder.update` | `reminder` | `{ before, after }` |
| `reminder.delete` | `reminder` | `{ before }` |
| `service.create` | `service` | `{ after }` |
| `service.update` | `service` | `{ before, after }` |
| `service.delete` | `service` | `{ before }` |

The `id` column is the **action id** — a UUID printed in the audit log UI and returned in API responses for read-after-write tracking.

## 7. Frontend

All UI lives inside the existing `index.html` — no build step, no new framework. Auth is implemented as another section with screens, dispatched by the existing hash router.

### 7.1 New screens

| Anchor | Screen | Auth | Notes |
| --- | --- | --- | --- |
| `#/login` | Email + password form | public | Redirects to `#/home` on success. |
| `#/admin/users` | Users table | admin | Inline create, role select, soft-delete. |
| `#/admin/assets` | All assets table | admin | One table, three tabs (vehicles / reminders / service history). |
| `#/admin/audit` | Audit log | admin | Most-recent-first, expandable payload, filter by actor / action code. |

Existing routes (`#/home`, `#/garage`, `#/service`, `#/qinao`, `#/videos`, `#/profile`) stay public. The `/api/*` endpoints with `requireUser` / `requireAdmin` are checked server-side; the UI is a convenience.

### 7.2 Top-bar

Replaces the current status-bar approach. Contents:

- Public: `[康程] [車庫] [服務] [琴澳] [影片] [我的]   |   [Sign in]`
- Authenticated user: `[康程] [車庫] ...   |   [email · user]   [Sign out]`
- Admin: `[康程] [車庫] ... [管理]   |   [email · admin ▾]   [Sign out]`

Admin menu (under `管理`): Users · Assets · Audit log.

### 7.3 Demo home after sign-in

The existing Home hydration already fetches `/api/vehicles` and `/api/reminders`. After auth, those endpoints can require auth and scope results to the current user (or stay public — see § 5). For this pass, the public endpoints **stay public** so the demo at `booundless.vercel.app` still works without a login. Admin-only endpoints are the new ones.

## 8. Dependencies

Add to `package.json`:

```json
{
  "bcryptjs": "^2.4.3",
  "jose": "^5.9.0"
}
```

Both are pure-JS / edge-compatible.

## 9. Vercel + env

`vercel.json` rewrites to add:

```json
{ "source": "/api/auth/(.*)",      "destination": "/api/auth" },
{ "source": "/api/users/(.*)",     "destination": "/api/users" },
{ "source": "/api/assets",         "destination": "/api/assets" },
{ "source": "/api/audit",         "destination": "/api/audit" }
```

`functions.api/**/*.js.maxDuration` stays at 10 s (auth hash on a slow cold start is fine).

Vercel project env (production):

| Key | Notes |
| --- | --- |
| `KC_JWT_SECRET` | Long random string. Generated once. |
| (existing) `KC_DATABASE_URL` | unchanged |
| (existing) `AI_*`, `SUPABASE_*` | unchanged |

## 10. File plan

```
api/
  _lib/
    auth.js            NEW: bcrypt + jose, requireUser, requireAdmin, setSessionCookie, audit()
    db.js              MODIFIED: add users + audit_log seed, idempotent
  auth.js              NEW: login, logout, me
  users.js             NEW: list, create, update, delete
  assets.js            NEW: aggregated admin view
  audit.js             NEW: paginated audit log
db/
  schema.sql           MODIFIED: users + audit_log + optional created_by columns
  seed-admin.js        NEW: idempotent script to seed the admin user
index.html             MODIFIED: top-bar, login, admin pages, hydration
vercel.json            MODIFIED: new rewrites
package.json           MODIFIED: bcryptjs, jose
.env / .env.example    MODIFIED: KC_JWT_SECRET
docs/
  plan-auth-admin-audit.md   NEW: this file
```

## 11. Implementation phases

Each phase ends with a working demo on the local dev server and a smoke test before moving on.

### Phase 1 — DB + auth lib (no UI)

- `db/schema.sql`: add `users` and `audit_log` tables; `ALTER TABLE` adds `created_by_user_id` to existing tables.
- `db/seed-admin.js`: idempotent script — `INSERT ... ON CONFLICT DO NOTHING` for `admin@example.com` / `admin123` (bcrypt).
- `api/_lib/auth.js`: `hashPassword`, `verifyPassword`, `signSession`, `verifySession`, `setSessionCookie`, `clearSessionCookie`, `readSession`, `requireUser`, `requireAdmin`, `audit()`.
- Migration applied to Supabase.

Exit: `node db/seed-admin.js` succeeds; bcrypt hash present in `users` table.

### Phase 2 — Auth endpoints

- `api/auth.js`: login, logout, me.
- `vercel.json` rewrite for `/api/auth/*`.
- Login is a write action — writes `auth.login` (and `auth.failed` on bad credentials).
- Manual curl smoke test: login → cookie set → `/api/auth/me` returns the user → logout → cookie cleared → `/api/auth/me` returns 401.

Exit: all three auth endpoints green on local and Vercel.

### Phase 3 — User CRUD

- `api/users.js`: list, create, update, delete (soft).
- Each mutation calls `audit({ action, target, payload, req })` before returning.
- Bootstrap admin must already exist to call any of these.

Exit: admin can create a test user via curl; the audit_log row for `user.create` is visible.

### Phase 4 — Admin assets + audit endpoints

- `api/assets.js`: read-only aggregation of all vehicles, reminders, service history, with the human-readable owner label.
- `api/audit.js`: paginated, filterable, returns newest first.

Exit: curl smoke test returns sensible shapes.

### Phase 5 — Frontend

- Top-bar refactor: replace the current `.status-bar` markup with a `<header class="kc-topbar">` that hides/shows Sign-in vs Sign-out vs admin menu based on `/api/auth/me`.
- Login screen.
- Users screen.
- Assets screen.
- Audit log screen.
- Hydration: each screen fetches its own data; mutations refresh the list.

Exit: Playwright run-through: log in as admin → see admin pages → create a user → see the new user in audit log → log out.

### Phase 6 — Deploy + verify

- Set `KC_JWT_SECRET` on Vercel.
- Push, deploy.
- Run Playwright against `https://booundless.vercel.app`.

Exit: every step of Phase 5 also passes against the live URL.

## 12. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Forgetting to seed the admin on a fresh DB | M | `seed-admin.js` is idempotent; the schema migration runs it on first connection. |
| JWT secret committed to git | L | Never read from a file in the repo. Local dev uses a dev-only secret in `.env`; prod uses Vercel env. |
| Password stored in plain text anywhere | L | Only the bootstrap plaintext (`admin123`) is referenced at seed time. After seed, only the hash is in the DB. |
| Existing demo breaks for unauthenticated users | M | Public read endpoints (`/api/vehicles`, `/api/reminders`, etc.) stay public. Only admin endpoints require auth. |
| bcrypt cold-start adds 200-500 ms to login | L | Acceptable for a demo. Use cost 10 (≈ 80 ms on Vercel). |
| Audit log grows unbounded | L | Demo scale. Add a TTL job in a future pass. |

## 13. Open questions

None at this point — defaults are documented above. Will adjust if feedback arrives before phase 1 starts.

## 14. Definition of done

A reviewer can, on the live URL:

1. Open `https://booundless.vercel.app/` without logging in — the existing public demo still works.
2. Click **Sign in**, enter `admin@example.com` / `admin123`, get redirected to home with the top-bar showing `[email · admin]`.
3. Open `管理 → Users`, create a user, edit their role, soft-delete them. Each action produces an audit row.
4. Open `管理 → Assets`, see every vehicle, reminder, and service-history row.
5. Open `管理 → Audit log`, see every action with a unique UUID, actor, target, payload, and timestamp.
6. Log out; the public demo continues to work; admin pages become inaccessible (server returns 401/403).
