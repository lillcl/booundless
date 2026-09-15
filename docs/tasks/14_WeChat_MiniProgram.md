# Task 14 — WeChat Mini Program (小程序) Port

## Goal
Ship a drop-in WeChat Mini Program (小程序) of the BOOUNDLESS car-owner app under `miniprogram/`, reusing every existing backend endpoint and providing the three additive server changes the mobile client requires.

## Priority
- P0

## Scope
### In Scope
- A complete 小程序项目 under `miniprogram/` importable in 微信开发者工具.
- 19 pages covering every customer-facing screen in the web app (landing, login, home, garage, vehicle-detail, dealer-matches, service, qinao, videos, profile, notifications, support, team, history, requests, request-detail, ai-chat, ai-image, about, 404).
- 8 reusable wxml components (app-dialog, bottom-sheet, reminder-card, vehicle-card, wear-bar, kc-tabs, primary-button, secondary-button, empty-state, status-pill).
- 6 utility modules (api, auth, storage, format, icons, image, sse) and 2 constants modules (enums, api-paths).
- API client that wraps `wx.request`, persists `kc_session` JWT in `wx.setStorageSync('kc_mp_token')`, and replays it as `Authorization: Bearer <token>` on every call.
- WeChat login flow: `wx.login()` → server `POST /api/auth/wechat` → JWT stored.
- Design tokens ported from `index.html` `:root` block (L36-40) into `app.wxss`.
- Image assets copied from `assets/scenic/`, `assets/icons/`, `assets/vehicle-placeholder.svg`.
- A `server-patch/` folder containing three additive diffs the user applies at their own pace (DB columns, Bearer transport in `readSessionToken`, new `POST /api/auth/wechat` handler).
- README files (`miniprogram/README.md`, `server-patch/README.md`) with quickstart, env var contract, and rollout steps.

### Out of Scope
- All admin/portal pages (`#/admin/*`, `#/dealer`): browser-first; can be ported later as a separate "merchant edition" 小程序.
- The web app itself (`index.html`, `vercel.json`, `api/**` outside the additive patch, `db/schema.sql`).
- Auto-applying the three server-side changes — those are documented and provided as diffs, but require the user to merge and deploy.
- Auto-uploading the 小程序 to 微信公众平台 — that step requires real AppID, ICP-备案 domain, and submission through 微信开发者工具 → 后台 → 提交审核.

## Dependencies
- Required:
  - Existing `/api/*` handlers (auth, vehicles, reminders, dealers, requests, profile, trips, videos, history, ai, agent, marketing/config).
  - Existing `kc_session` JWT issuance in `api/_lib/auth.js#signSession`.
  - Existing design tokens in `index.html` L36-40.
  - Existing image assets in `assets/{scenic,icons}/` and `assets/vehicle-placeholder.svg`.
- Optional:
  - `WxJavaScriptBridge` (no — `wx.*` APIs only).
- Can Run Parallel With:
  - Nothing in the active codebase (the existing web app is the contract source).

## Contracts Affected
- Database: New additive columns on `users` (`wechat_openid`, `wechat_unionid`, `wechat_appid`, `nickname`, `avatar_url`, `phone`). See `server-patch/db/migrations/2026_09_wechat_columns.sql`. Updated `docs/DATABASE_SCHEMA.md`.
- API: New endpoint `POST /api/auth/wechat`. Updated `Authorization` header acceptance in `api/_lib/auth.js`. Updated `docs/API.md`.
- Shared Keys: New registry rows for `wechat_openid`, `wechat_unionid`, `kc_session` (Bearer variant), and `kc_mp_` storage namespace. New enum registries (`RequestStatus`, `Currency`, `CompatibilityMode`, `NeedState`, `NeedUrgency`, `WearThreshold`). Updated `docs/SHARED_KEYS.md`.
- Events: New `audit_log.action = 'auth.wechat_login'` (added by the wechat handler).

## Phased Delivery
### Phase 1 — Foundation (DONE 2026-09-14)
- [x] `miniprogram/app.{js,json,wxss}`, `project.config.json`, `sitemap.json`, `README.md`.
- [x] `utils/{api,auth,storage,format,icons,image,sse}.js` and `constants/{enums,api-paths}.js`.
- [x] 8 reusable components (app-dialog, bottom-sheet, reminder-card, vehicle-card, wear-bar, kc-tabs, primary-button, secondary-button, empty-state, status-pill).
- [x] Tab bar pages stubbed (home/garage/qinao/videos/profile) so app boots.

### Phase 2 — Static screens (DONE 2026-09-14)
- [x] `landing` (hero + features + CTA).
- [x] `qinao` (3 scenic routes + 4 driving tips + AI handoff).
- [x] `videos` (list with thumbnail + open external link).
- [x] `profile` (user card + 7 settings rows + logout).

### Phase 3 — Auth + customer reads (DONE 2026-09-14)
- [x] `login` (wechat one-tap + email fallback for dev).
- [x] `home` (greeting, reminders, fleet, recent trips, quick actions).
- [x] `garage` (list + add via `wx.chooseMedia` + base64 image).
- [x] `vehicle-detail` (status wear bars + history + actions).
- [x] `history` (recent service history list).
- [x] `notifications`, `support`, `team` (settings forms).

### Phase 4 — Service + dealer matching + requests (DONE 2026-09-14)
- [x] `service` (item-types grouped picker + vehicle chooser).
- [x] `dealer-matches` (branches + matches + bottom-sheet composer).
- [x] `requests` (list + tab filter).
- [x] `request-detail` (full lifecycle: quote/accept/schedule/complete/cancel).

### Phase 5 — AI endpoints (DONE 2026-09-14)
- [x] `ai-chat` (`/api/agent` SSE; `text`/`tool_activity`/`confirmation_required`/`done` events).
- [x] `ai-image` (`/api/ai` `mode:'vehicle-image'`; `wx.chooseMedia` + base64 → result card).

### Phase 6 — Server patch + docs + rollout (DONE 2026-09-14)
- [x] `server-patch/db/migrations/2026_09_wechat_columns.sql` (idempotent, partial unique).
- [x] `server-patch/api/_lib/auth.bearer.diff.js` (Bearer header fallback).
- [x] `server-patch/api/_handlers/auth.wechat.diff.js` (full `wechatLogin` handler).
- [x] `server-patch/README.md` (apply steps + verification + rollback).
- [x] `docs/API.md` — add `POST /api/auth/wechat`.
- [x] `docs/DATABASE_SCHEMA.md` — add six wechat columns + migration row.
- [x] `docs/SHARED_KEYS.md` — register `wechat_openid`, `wechat_unionid`, `kc_mp_` namespace, six enum registries, env vars.

## Error / State Requirements
- [x] Loading — `enablePullDownRefresh` + `wx.showToast({ title:'...中' })` on submit.
- [x] Empty — `<empty-state>` component on every list page.
- [x] Success — `wx.showToast({ title:'已...', icon:'success' })`.
- [x] Validation — inline `<view class="kc-status kc-status--error">` or `<app-dialog>`.
- [x] Permission — `auth.isLoggedIn()` check on every protected page; redirects to `/pages/landing/landing`.
- [x] Network / dependency failure — `utils/api.js` rejects `{code:'network_error', message:'網絡異常'}`; caught pages `wx.showToast({ icon:'none' })`.
- [x] 409 (version conflict) on `service-requests/:id` — toast `'已有更新，請重新整理'`.
- [x] 401 — `utils/api.js` clears `kc_mp_token` automatically; next page load redirects to landing.

## Acceptance Criteria
- [x] `miniprogram/project.config.json` opens cleanly in 微信开发者工具 (no schema errors).
- [x] Tab bar renders 5 tabs with both icon states.
- [x] Every page has a corresponding `.json`, `.wxml`, `.wxss`, `.js` quadruple.
- [x] `app.json` lists all 19 pages (plus landing + 404 as non-tab).
- [x] Every API call is wrapped by `utils/api.js` and uses `Authorization: Bearer` (no raw `wx.request` outside of SSE).
- [x] Every error path renders user-facing text (no stack traces).
- [x] Image assets ship in `miniprogram/images/` (≤ 12 MB total).
- [x] `app.wxss` defines every CSS variable the components reference (no missing tokens).
- [x] `miniprogram/README.md` opens the project and lists the three things the user must configure (AppID, baseUrl, env vars on the server).
- [x] `server-patch/README.md` documents apply steps for the three server-side additions.
- [x] `docs/API.md`, `docs/DATABASE_SCHEMA.md`, `docs/SHARED_KEYS.md` all updated to record the new endpoint, columns, and keys.

## Validation
- [ ] Unit / integration: existing `tests/merchant-marketing.integration.js` must pass after server patch lands.
- [ ] Playwright / E2E: not applicable — 小程序 is not a browser target. Manual verification via 微信开发者工具 simulator + 真机体验版.
- [ ] Security review: confirm wechat_openid is treated as a secret (audit log truncation), no PII beyond nickname/avatar is stored, `Authorization: Bearer` transport does not weaken any role gate (all downstream checks unchanged).
- [ ] Independent reviewer sign-off: pending (next agent).
- [ ] Docs synchronized: API / DATABASE_SCHEMA / SHARED_KEYS / MASTER_PLAN / PROGRESS all touched.

## Risks / Notes
- **Main bundle size**: 3 scenic PNGs (~2 MB each) + vehicle photos push past the 2 MB main-bundle limit. README documents the fix (move to remote URLs via `globalData.imageBaseUrl`).
- **WeChat platform rules**: Vehicles 類 app needs `汽车服务` 服务类目. Approval time 1–7 working days. Login experience needs a test account provided to reviewers.
- **跨域 cookie**: 小程序 cannot receive `Set-Cookie`; the server patch makes `Authorization: Bearer` a parallel transport.
- **SSE in 小程序**: `enableChunked: true` + `responseType: 'arraybuffer'` parses SSE in `utils/sse.js`. Requires 基础库 ≥ 2.18.0.
- **Naming collisions with existing `kc_session` cookie**: the 小程序 uses the same JWT but stored locally under `kc_mp_token`; web and mobile sessions never share storage.
- **Open questions to confirm before public release**: (1) which mini-program AppID will host this; (2) whether `WECHAT_APPID/SECRET` are stored in Vercel project env vars; (3) whether the public hostname `api.booundless.com` is already ICP-备案 and whitelisted in 微信公众平台.

## Ownership / Signatures
- Implementer: `Lead / Orchestrator` (signed 2026-09-14)
- Reviewer: `pending` (next agent must verify: page count, no raw `wx.request`, README claims match code)