# Release runbook — BOOUNDLESS / 康程 CarAI

This is the procedural document for shipping a new version of the production
deployment on Vercel. It assumes the post-2026-09-22 hardening baseline
(security middleware, /api/me, legal pages, custom error page).

## 0. Pre-flight checklist (T-1 day)

- [ ] All `Phase 5` tasks done or explicitly deferred in `PROGRESS.md`.
- [ ] No real secrets in `.env` (only placeholders), no `git log` mentions of `AI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DIRECT_URL`, or `KC_JWT_SECRET`.
- [ ] `npm test` green on `main`.
- [ ] Latest commit merged via PR; required reviewers per `CODEOWNERS` have signed off.
- [ ] Open a feature freeze announcement in Slack / line group.
- [ ] Confirm Supabase is on the paid plan with daily backups and PITR enabled.

## 1. Vercel environment variables (one-time per environment)

Set these under Vercel → Project → Settings → Environment Variables for the
**Production** scope. Rotate values through 1Password; never paste into chat.

| Variable | Required | Source | Notes |
| --- | --- | --- | --- |
| `KC_DATABASE_URL` | yes | Supabase dashboard → Project → Database → Connection string (Transaction pooler) | Falls back if `SUPABASE_DB_URL` is unset. |
| `SUPABASE_DB_URL` | yes (cloud) | Same as above | Cloud runtime prefers this. |
| `SUPABASE_URL` | yes | Supabase → Project URL | Used by client config endpoint. |
| `SUPABASE_ANON_KEY` | yes | Supabase → API → `anon` | Public. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → API → `service_role` | **Server only.** Never `NEXT_PUBLIC_`. |
| `SUPABASE_STORAGE_BUCKET` | yes | `cars` (default) | Bucket for vehicle photos. |
| `KC_JWT_SECRET` | yes | `openssl rand -hex 32` | Cookie session signing. |
| `KC_ALLOWED_ORIGINS` | yes | `https://booundless.vercel.app,<your-custom-domain>` | Comma-separated; required for the origin check. |
| `AI_API_KEY` | yes | MiniMax dashboard | Rotate quarterly. |
| `AI_BASE_URL` | optional | `https://api.minimax.cn/anthropic` | MiniMax Anthropic-compatible. |
| `AI_MODEL` | optional | `MiniMax-M3` | |
| `AGENT_DAILY_TOKEN_LIMIT` | optional | `200000` | Per-user daily cap on agent runs. |
| `RESEARCH_MCP_URL` | optional | (blank) | Allowlisted MCP for agent tool. |

## 2. Deploy

Production deploy is driven by `.github/workflows/deploy.yml` on push to
`main`. The workflow:

1. Runs `npm ci --omit=dev`.
2. Calls `vercel deploy --prod --yes` with `VERCEL_TOKEN`.
3. Polls `https://booundless.vercel.app/api/health` for up to 10 × 5 s.
4. Verifies `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
   `Content-Security-Policy`, `Strict-Transport-Security` are present.

A failed probe rolls back by re-running the previous git tag via
`vercel rollback`. Manual:

```bash
vercel rollback <deployment-url>
```

## 3. Post-deploy verification

```bash
# Health
curl -fsSL https://booundless.vercel.app/api/health | jq

# Security headers
curl -sI https://booundless.vercel.app/api/health \
  | grep -iE '^(x-content-type-options|x-frame-options|referrer-policy|content-security-policy|strict-transport-security):'

# Origin gate (must 403)
curl -s -X POST https://booundless.vercel.app/api/auth/login \
  -H 'Origin: https://evil.example' \
  -H 'Content-Type: application/json' \
  -d '{}' \
  -w '\nstatus=%{http_code}\n'

# Rate limit (must 429 on the 16th call)
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST https://booundless.vercel.app/api/auth/login \
    -H 'Origin: https://booundless.vercel.app' \
    -H 'Content-Type: application/json' \
    -d '{"email":"nope@example.invalid","password":"bad"}'
done

# Legal pages
curl -fsSI https://booundless.vercel.app/legal/privacy.html
curl -fsSI https://booundless.vercel.app/legal/terms.html

# Error page renders the right code
curl -fsSI 'https://booundless.vercel.app/error.html?status=429&code=rate_limited'
```

## 4. Smoke flows (manual, 5 minutes)

- [ ] Anonymous landing page renders, footer shows 隱私 / 條款.
- [ ] `/api/health` returns `{ status: 'ok' }`.
- [ ] Sign up with a fresh email, see home dashboard.
- [ ] Add a vehicle, see it appear under 我的車.
- [ ] Open CarAI chat, send a short message, observe streaming tokens.
- [ ] Profile → 下載我的資料 → JSON file downloads.
- [ ] Profile → 刪除我的帳號 → confirm twice → land on `/` and the session is gone.

## 5. Incident response

| Symptom | First action |
| --- | --- |
| 5xx spike | Check `vercel logs --prod`, then Supabase status, then MiniMax status. |
| 401 flood from one IP | Confirm rate limiter is firing (`Retry-After` header). If not, check `api/_lib/rate-limit.js` is being wrapped. |
| AI agent costs spike | Verify `AGENT_DAILY_TOKEN_LIMIT` is set; review the agent run table for high-volume users. |
| Customer reports leaked data | Rotate `KC_JWT_SECRET` (forces logout) + rotate Supabase keys. Then run `npm run` to invoke `scripts/audit-retention.js` *only if retention is shorter than the leak window*; otherwise preserve evidence. |
| Custom domain broken | Re-check DNS, then `vercel domains ls`, then refresh `KC_ALLOWED_ORIGINS`. |

## 6. Rollback

```bash
# List recent deployments
vercel ls booundless.vercel.app --prod

# Promote a previous deployment
vercel promote <deployment-id-or-alias> --prod
```

Then redeploy the next commit as a fix-forward; do **not** delete the failed
deployment until 7 days have passed (Vercel keeps logs).

## 7. Custom domain

When ready to switch from `booundless.vercel.app`:

1. Pick the domain in DNS (Cloudflare recommended).
2. `vercel domains add example.com`.
3. Add the CNAME / A records Vercel prints.
4. Wait for TLS provisioning.
5. Update `KC_ALLOWED_ORIGINS` to include `https://example.com`.
6. Update `legal/privacy.html` and `legal/terms.html` `<link rel="canonical">` to the new domain.
7. Update `sitemap.xml` and `llms.txt` URLs.
8. Verify `curl -I https://example.com/api/health` returns the same security headers.

## 8. Quarterly review

- [ ] Rotate `KC_JWT_SECRET`.
- [ ] Rotate `AI_API_KEY`.
- [ ] Review `audit_log` for unusual patterns (run a manual query).
- [ ] Run `npm audit --omit=dev` and patch criticals.
- [ ] Confirm `AGENT_DAILY_TOKEN_LIMIT` is still aligned with cost budget.
- [ ] Spot-check `legal/privacy.html` and `legal/terms.html` against current data practices.
