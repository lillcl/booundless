# Dirty edits snapshot — 2026-09-23 (Asia/Macau)

This file lists the uncommitted edits that exist on disk before T0 / T1 of
the service MVP plan. Per spec §3.7: "先保存 diff 清單和檔案 ownership;不得覆
蓋、reset 或自行清理。"

Ownership rules (per PROGRESS.md / CODEOWNERS):

| File | Owner | Action during T0–T9 |
| --- | --- | --- |
| `index.html` | Lead / Orchestrator | DO NOT edit. Route mounts only after T8 by integrator. |
| `api/index.js` | Lead / Orchestrator | DO NOT edit during T0–T7. T8 may add new route mappings. |
| `scripts/migrate.js` | Lead / Orchestrator | DO NOT edit during T0–T1 except adding the new ledger call. |
| `db/service-mvp-schema.sql` | Service MVP author | Append-only T1+ slices. |
| `db/schema.sql` | Lead / Orchestrator | No edits during MVP work. |
| `db/shop-catalog.js` | Shop author (parallel) | Touch only for catalog data, no schema change. |
| `db/seed.js` | Lead / Orchestrator | No edits during MVP work. |
| `assets/shop*` | Shop author | Do not touch during MVP work. |
| `assets/request-flow.js` | Service MVP author (extend) | Preserve existing selectors; add new mounts only. |
| `assets/passport.js` | Service MVP author | Extend; preserve existing selectors. |
| `tests/e2e/shop.spec.js` | Shop author | Do not edit during MVP work. |

## Uncommitted files (current `git status --short`, 2026-09-23)

```
 M .env.example
 M 404.html
 M PROGRESS.md
 M api/_handlers/dealers.js
 M api/_handlers/history.js
 M api/_handlers/requests.js
 M api/_handlers/trips.js
 M api/_lib/agent.js
 M api/_lib/db.js
 M api/_lib/service-records.js
 M api/index.js
 M assets/request-flow.js
 M assets/shop.css
 M assets/shop.js
 M db/shop-catalog.js
 M docs/API.md
 M index.html
 M playwright.config.js
 M scripts/dev-server.js
 M scripts/migrate.js
 M tests/e2e/shop.spec.js
 M tests/merchant-marketing.test.js
 M tests/shop.test.js
 M vercel.json
?? .github/
?? RELEASE.md
?? SECURITY.md
?? api/_handlers/me.js
?? api/_lib/agent-safety.js
?? api/_lib/origin-check.js
?? api/_lib/rate-limit.js
?? api/_lib/security-headers.js
?? assets/error-state.js
?? assets/shop-catalog/
?? assets/vehicle-placeholder-ai.png
?? db/service-mvp-schema.sql
?? docs/PRODUCTION_MVP_IMPLEMENTATION_PLAN.md
?? error.html
?? legal/
?? scripts/audit-retention.js
?? secrets.txt
?? tests/audit-retention.test.js
?? tests/e2e/prod-hardening.spec.js
?? tests/prod-hardening.test.js
```

## Per-file disposition during MVP execution

| File | Pre-existing change | Will MVP touch? | If yes, what |
| --- | --- | --- | --- |
| `api/_handlers/history.js` | owner scope + `voided_at` filter | NO (already aligned with T0.1) | — |
| `api/_handlers/trips.js` | owner scope | NO (already aligned with T0.6) | — |
| `api/_handlers/requests.js` | workflow_version-aware complete; service_order_lines; service_changes | YES | T2 — add v2 actions, slot integration, completion→history transaction, commission hook |
| `api/_lib/service-records.js` | `createServiceRecordTx` exported | NO (already aligned with T0.3) | — |
| `api/_handlers/dealers.js` | existing | YES | T2 — offer CRUD + booking slot CRUD |
| `api/_lib/db.js` | schema auto-apply gated | YES | T0.5 — alias `DB_AUTO_MIGRATE` + `DEMO_SEED_ENABLED`, readiness check uses SCHEMA_VERSION |
| `assets/request-flow.js` | existing quote/accept UI | YES | T7 — extend selectors; never remove existing ones |
| `assets/passport.js` | existing | YES | T7 — show "history unknown" CTA when vehicle_status.last_done_at IS NULL AND no service_history exists |
| `index.html` | bulk modifications (shop, error-state, legal links) | YES (T8) | Only add route mounts + script tags; never delete existing selectors |

## Hard rules

- Never run `git reset --hard` or `git checkout -- <file>` on any file in this list.
- Never amend a commit that contains MVP code.
- Never `git stash drop` after a stash that held MVP work.
- Shop and MVP commits land on the same branch; both may exist but the MVP
  ship gate requires the dirty file list above to be reviewed by the
  integrator before merge.