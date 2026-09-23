# Security

## Reporting a vulnerability

Email **security@booundless.example** (replace with the real address once
configured). Please include reproduction steps and impact. We acknowledge
within 2 business days and aim for a fix within 14 days for critical issues.

Do not file a public GitHub issue for security-sensitive reports.

## Supported versions

| Branch  | Supported |
| ------- | --------- |
| main    | yes       |
| older   | no        |

---

## Pre-prod hardening landed 2026-09-22

- **Security headers middleware** (`api/_lib/security-headers.js`): HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP, COOP. Applied in `api/index.js` and the dev shim.
- **Origin / Referer allowlist** (`api/_lib/origin-check.js`): rejects cross-origin mutating requests when `KC_ALLOWED_ORIGINS` (or `ORIGIN`) is set. **Fails closed** in production. Allow `curl`/scripts with `KC_ALLOW_NO_ORIGIN=1` (dev only).
- **Per-IP and per-user rate limit** (`api/_lib/rate-limit.js`):
  - `/api/auth/*` and `/api/me/*` — 15 req / minute / bucket.
  - Other mutating routes — 60 req / minute.
  - Other reads — 120 req / minute.
  In-memory Map; reset on cold start. Swap store for Upstash Redis / Vercel KV to enforce across instances.
- **Agent safety** (`api/_lib/agent-safety.js`):
  - User-controlled context fenced with `<<<USER_DATA_UNTRUSTED_BEGIN>>>` / `_END>>>` before being injected into the agent system prompt.
  - Per-user daily token budget (default 200 000 tokens / 24 h, override via `AGENT_DAILY_TOKEN_LIMIT`).
- **`/api/me`** — user self-service:
  - `GET /api/me` — current user row.
  - `GET /api/me/export` — JSON download.
  - `DELETE /api/me` (requires `X-Confirm-Delete: yes`) — soft-delete + anonymise audit log + clear session cookie.
- **Custom error page** (`error.html`) — supports `?status=...&code=...` for 401/403/404/413/429/500/502/503/504.
- **Legal pages** — `legal/privacy.html`, `legal/terms.html` under 無界啟程 BOOUNDLESS (Macau).

---

## Secrets rotation (2026-09-22 — owner action required)

The following credentials were previously committed to `.env` (now scrubbed from working tree; the file is listed in `.gitignore` but real values still live in git history):

| Key | Action | Owner |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in Supabase dashboard → Settings → API → `service_role` secret. Update Vercel production env. | DB owner |
| `SUPABASE_ANON_KEY` | Rotate (anon key is public but rotating invalidates leaked JWTs). | DB owner |
| `DIRECT_URL` (Postgres password) | Reset via Supabase → Database → Settings. Update Vercel env. | DB owner |
| `AI_API_KEY` | Rotate with MiniMax. Update Vercel env. | AI owner |
| `KC_JWT_SECRET` | Generate 64+ random bytes (`openssl rand -hex 32`). Update Vercel env. This invalidates every existing session — schedule a short maintenance window. | Backend |

### History scrub

```bash
brew install bfg
bfg --replace-text secrets.txt   # one key per line
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

After scrubbing, **all deploys must rotate again** because any cache, log, or image built before the scrub still contains the old values.

Enable GitHub secret scanning (`Settings → Code security → Push protection`) before the next push to `main`.

---

## What is NOT yet done

- Multi-instance rate-limit store (Upstash / KV)
- `npm audit` in CI (Dependabot weekly updates enabled, but no audit step)
- External penetration test
- CSP report-uri collector
- Audit-log retention policy

---

## Operational checklist (before every prod release)

1. `npm test` green (unit + Playwright).
2. No real secrets in `.env` — only placeholders.
3. `git log --all -p | grep -E 'AI_API_KEY|SUPABASE_SERVICE' | head` returns no hits.
4. After deploy, `curl -I https://app.example/api/health` returns HSTS + CSP + X-Frame-Options.
5. After deploy, cross-origin POST returns 403.
6. After deploy, 16th rapid `/api/auth/login` from one IP returns 429.