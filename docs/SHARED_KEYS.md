# SHARED_KEYS.md

Canonical registry for shared names across frontend, backend, database, tests, events, and integrations.

## Rules
- One concept = one canonical name.
- Do not create synonyms across layers.
- Update this file before introducing a new shared key.
- Note layer-specific serialization when unavoidable.

## Registry
| Concept | Canonical Key | DB | API | Frontend | Type | Notes |
|---|---|---|---|---|---|---|
| Workspace ID | `workspaceId` | `workspace_id` | `workspaceId` | `workspaceId` | UUID | Example |
| WeChat openid | `wechatOpenid` | `wechat_openid` | `wechat_openid` | `wechatOpenid` | text | Server-only secret; partial UNIQUE index `idx_users_wechat_openid_unique` |
| WeChat unionid | `wechatUnionid` | `wechat_unionid` | `wechat_unionid` | `wechatUnionid` | text | Cross-app; partial index `idx_users_wechat_unionid` |
| Session JWT | `kc_session` | n/a | `Authorization: Bearer` (小程序) / `kc_session` cookie (web) | storage key `kc_mp_token` | JWT HS256 | 7-day expiry, `KC_JWT_SECRET` |
| 小程序 storage prefix | `kc_mp_` | n/a | n/a | `kc_mp_token`, `kc_mp_user` | string | Local storage namespace; avoids collisions with browser `localStorage` cookies from web app |
| Terms version | `termsVersion` | `users.terms_version` | `terms_version` (request body on `POST /api/auth/register`) | `termsVersion` | text(40) | Optional; persisted silently today. Frontend sends `'v1'`. |
| Dealer status | `dealerStatus` | `dealers.status` | `dealer.status` / PATCH body `status` | n/a | enum (`draft`/`active`/`suspended`) | Status flip cascades to `users.is_active` for every member |
| Dealer member role | `dealerMemberRole` | `dealer_members.role` | `dealer.role` / PATCH body `role` | `dealer.role` | enum (`owner`/`manager`/`staff`/`viewer`) | Removing the last `owner` returns 422 `last_owner` |

## Enums
### `RequestStatus` (web, admin, 小程序)
- `new`
- `quoted`
- `accepted`
- `scheduled`
- `completed`
- `cancelled`
- `declined`

### `Currency`
- `MOP`
- `HKD`
- `CNY`

### `CompatibilityMode` (dealer_service_items)
- `unverified`
- `restricted`
- `universal`

### `NeedState` (vehicle_needs)
- `confirmed`
- `dismissed`
- `resolved`

### `NeedUrgency` (vehicle_needs)
- `routine`
- `soon`
- `urgent`

### `WearThreshold` (api/_handlers/vehicles.js#attention)
- `80` — `attention` (amber)
- `100` — `due` (red)

### `DealerStatus` (dealers.status)
- `draft` — admin-created, not yet accepting requests
- `active` — accepting requests; required by `/api/vehicles/:id/dealer-matches`
- `suspended` — admin-paused; `users.is_active` is also flipped to `false` for every member so existing sessions can no longer hit `requireUser`

### `DealerMemberRole` (dealer_members.role)
- `owner` — cannot be removed when it would leave the dealer with zero owners (handler returns 422 `last_owner`)
- `manager` — full catalog + fitment + branch-service edit
- `staff` — request workflow + history write
- `viewer` — read-only portal

## Events
| Event | Payload Schema | Producer | Consumer |
|---|---|---|---|
| `audit_log:auth.register` | `{email, display_name}` | `POST /api/auth/register` (plain) | `audit_log` table |
| `audit_log:auth.register.conflict` | `{email, reason}` | `POST /api/auth/register` (email collision) | `audit_log` table |
| `audit_log:auth.login` | `{}` | `POST /api/auth/login` | `audit_log` table |
| `audit_log:auth.failed` | `{email, reason}` | `POST /api/auth/login` (bad creds / inactive) | `audit_log` table |
| `audit_log:auth.logout` | `{}` | `POST /api/auth/logout` | `audit_log` table |
| `audit_log:dealer.self_register` | `{email, display_name, terms_version, dealer_id}` | `POST /api/auth/register` with `dealer:{}` | `audit_log` table; `target_type='dealer'` |
| `audit_log:dealer.create` | `{dealer, services}` | `POST /api/admin/dealers` | `audit_log` table |
| `audit_log:dealer.update` | `{before, after, member_flip?}` | `PATCH /api/admin/dealers/:id` (also fires on status flip; `member_flip` reports `{count,is_active}` when status changed) | `audit_log` table |
| `audit_log:dealer.member.add` | `{email, user_id, role, user_created}` | `POST /api/admin/dealers/:id/members` (existing user joined or upsert) | `audit_log` table |
| `audit_log:dealer.member.create_and_add` | `{email, user_id, role, user_created:true}` | `POST /api/admin/dealers/:id/members` (handler created a new user account because the email was unknown) | `audit_log` table; `temporary_password` is returned in the API response only — never persisted |
| `audit_log:dealer.member.remove` | `{user_id}` | `DELETE /api/admin/dealers/:id/members/:userId` | `audit_log` table |
| `audit_log:dealer.branch.create` | `{branch}` | `POST /api/admin/dealers/:id/branches` | `audit_log` table |
| `audit_log:dealer.vehicle.history.create` | `{vehicle_id, dealer_id}` | `POST /api/dealer/vehicles/:id/history` | `audit_log` table |
| `audit_log:dealer.vehicle.history.update` | `{vehicle_id, dealer_id, version}` | `PATCH /api/dealer/vehicles/:id/history/:recordId` | `audit_log` table |
| `audit_log:dealer.request.update` | `{status}` | `PATCH /api/dealer/service-requests/:id` (legacy path) | `audit_log` table |
| `audit_log:dealer.request.create` | `{dealer_id, vehicle_id, service_item_type_key}` | `POST /api/vehicles/:id/service-requests` | `audit_log` table |
| `audit_log:dealer.offer.create` | `{...}` | `POST /api/dealer/offers` | `audit_log` table |
| `audit_log:dealer.offer.update` | `{...}` | `PATCH /api/dealer/offers/:id` | `audit_log` table |

Phase 7 retired the invite flow; the following audit keys were removed and any pre-retirement rows still exist in `audit_log` but no longer have a producer: `dealer.invite.create`, `dealer.invite.accept`.

## Environment Variables
| Key | Required | Scope | Secret | Description |
|---|---|---|---|---|
| `WECHAT_APPID` | Required for 小程序 login | Server | No | Mini-program AppID from 微信公众平台 |
| `WECHAT_SECRET` | Required for 小程序 login | Server | Yes | Mini-program AppSecret |
| `KC_JWT_SECRET` | Required for session issuance | Server | Yes | Signs `kc_session` JWT (HS256) |
