# Task 15 — Dealer Self-Registration Refactor

## Goal
Replace the admin-invite-token onboarding flow with a hidden self-registration page so a store owner can register and immediately use their dealer workspace. Drop the activation gate; admin gains full edit + suspend (both `users.is_active=false` and `dealers.status='suspended'`).

## Priority
- P0

## Scope
### In Scope
- Hidden `#/dealer/register` page (no nav link)
- `POST /api/auth/register` extended with optional `dealer:{}` payload → wraps user + dealer + branch + member INSERTs in one transaction; dealer starts at `status='active'`
- Drop `dealer_invites` table; remove invite create / accept / register handlers
- Remove activation gate (branch / service / contact preconditions) on `PATCH /api/admin/dealers/:id`
- PATCH `status='suspended'` also flips `users.is_active=false` for every member; `status='active'` flips them back
- Add `POST /api/admin/dealers/:id/members` and `DELETE /api/admin/dealers/:id/members/:userId`
- Admin edit form (`renderAdminDealerEdit`) covering all dealer fields + member management UI
- Topbar gates `#/dealer` link on dealer membership (not just non-admin)
- Persist `users.terms_version` (silently dropped today)
- Tests + smoke rewrites; docs sync

### Out of Scope
- Multi-dealer-owner transfer workflow (covered by member-add / remove)
- Customer-facing "become a dealer" CTA anywhere in marketing copy
- WeChat / OAuth for dealer accounts (still email + password)

## Dependencies
- Required: existing `dealers`, `dealer_members`, `dealer_branches` tables; `requireAdmin`, `audit`
- Optional: none
- Can Run Parallel With: nothing in this space — backend blocks, then frontend blocks

## Contracts Affected
- Database: `users` gains `terms_version TEXT`; `dealer_invites` dropped; new migration `db/migrations/2026_09_dealer_self_register.sql`
- API: `POST /api/auth/register` gains `dealer:{}` payload; new `POST/DELETE /api/admin/dealers/:id/members[/:userId]`; removed invite endpoints; `PATCH /api/admin/dealers/:id` status change cascades to `users.is_active`
- Shared Keys: register `dealer.self_register` audit key
- Events: removal of `dealer.invite.create` and `dealer.invite.accept` action keys

## Phased Delivery
### Phase 1 — DB migration
- [ ] `db/migrations/2026_09_dealer_self_register.sql` — `ALTER TABLE users ADD COLUMN terms_version TEXT; DROP TABLE dealer_invites CASCADE`
- [ ] Register in `scripts/_lib/migrations.js` ledger
- [ ] Idempotency verified

### Phase 2 — Backend
- [ ] `api/_handlers/auth.js:48-96` — extend register with optional `dealer:{}` payload (transactional)
- [ ] `api/_handlers/dealers.js` — remove invite create / accept / register routes + `acceptInvite` function
- [ ] `api/_handlers/dealers.js:208-230` — PATCH status change cascades to `users.is_active`; remove precondition gate
- [ ] `api/_handlers/dealers.js` — add `POST/DELETE /api/admin/dealers/:id/members`
- [ ] `api/_handlers/dealers.js:78-85` — `resolveDealerForUser` filters out suspended dealers
- [ ] New audit key `dealer.self_register`

### Phase 3 — Frontend
- [ ] `index.html` — add `'dealer/register': renderDealerRegister` route
- [ ] `renderDealerRegister(host)` — hidden form
- [ ] `renderTopbar` — gate `#/dealer` link on membership (fetch `/api/dealer/me` at boot)
- [ ] Drop `sessionStorage.merchantInvite` branch in `renderDealerPortal`
- [ ] `renderAdminDealerEdit(dealerId)` — full edit + members UI
- [ ] `loadAdminDealers` adds "編輯" link per row

### Phase 4 — Tests
- [ ] Rewrite `tests/e2e/dealer-onboarding.spec.js`
- [ ] Update `tests/e2e/admin-dealers.spec.js`
- [ ] Rewrite `scripts/smoke-dealer-onboarding.js`
- [ ] Fix `tests/merchant-marketing.integration.js:77-79`
- [ ] Verify `tests/e2e/dealer-access.spec.js`, `dealer-portal.spec.js` unchanged
- [ ] Full unit + Playwright green

### Phase 5 — Docs + sign-off
- [ ] Update `docs/API.md`, `docs/DATABASE_SCHEMA.md`, `docs/SHARED_KEYS.md`
- [ ] Add Phase 7 to `docs/MASTER_PLAN.md` and `PROGRESS.md`
- [ ] Sign Phase 7

## Error / State Requirements
- [x] Loading (form submit spinner)
- [x] Empty (no fields required beyond minimum)
- [x] Success (redirect to `#/dealer`)
- [x] Validation (email / password / branch fields)
- [x] Permission (suspended dealer owner can't login → `is_active=false`)
- [x] Network / dependency failure (registration form surfaces error)
- [x] Retry / recovery (re-registration for `email_taken` returns 409)

## Acceptance Criteria
- [ ] Anonymous visits `#/dealer/register`; submits valid form; lands on `#/dealer` portal with full access
- [ ] `dealers` row created with `status='active'` immediately
- [ ] `dealer_branches` row created from form `branch_*` fields
- [ ] `dealer_members` row created with `role='owner'` for the new user
- [ ] Normal user (not a dealer, not admin) sees no `#/dealer` link in topbar
- [ ] Admin can edit any dealer field via UI; change is persisted
- [ ] Admin can add an existing user as `manager` / `staff` / `viewer` to a dealer; can remove them (except last owner)
- [ ] Admin suspends a dealer → owner `/api/auth/me` returns 401 → `/api/dealer/me` returns 403 / 404
- [ ] Admin reactivates → owner can login again
- [ ] `dealer_invites` table no longer exists; `/api/admin/dealers/:id/invites` returns 404
- [ ] No regression in `scripts/smoke-service-mvp.js` (16/16) or unit suite (48/48)

## Validation
- [x] Unit / integration (npm test green)
- [x] Playwright / E2E (dealer-onboarding, admin-dealers, dealer-portal, dealer-access specs)
- [x] Smoke (`scripts/smoke-dealer-onboarding.js` rewritten, ≥15/15)
- [x] Security review: invite token endpoints return 404; suspended users blocked at `requireUser`
- [x] Independent review: not available in this session (per Phase 1 sign-off note) — deferred to owner action
- [x] Docs synchronized

## Risks / Notes
- Existing invite-token flow is heavily tested in smoke + e2e + integration; rewrite carries non-trivial test churn.
- Removing `dealer_invites` is irreversible — confirm no production data depends on it before applying migration.
- Suspension via `users.is_active=false` cascades to all member sessions; document the forced-logout window.
- The `merchantInvite` sessionStorage branch is a small dead branch in `renderDealerPortal`; safe to drop.
- The register form must be available even when user is logged in as a regular user? Decide: only anon can self-register to avoid multi-dealer-as-one-user confusion. Document if changed.

## Ownership / Signatures
- Implementer: `Lead / Orchestrator` @ 2026-09-23
- Reviewer: `pending`