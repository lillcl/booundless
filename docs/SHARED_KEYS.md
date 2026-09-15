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

## Events
| Event | Payload Schema | Producer | Consumer |
|---|---|---|---|

## Environment Variables
| Key | Required | Scope | Secret | Description |
|---|---|---|---|---|
| `WECHAT_APPID` | Required for 小程序 login | Server | No | Mini-program AppID from 微信公众平台 |
| `WECHAT_SECRET` | Required for 小程序 login | Server | Yes | Mini-program AppSecret |
| `KC_JWT_SECRET` | Required for session issuance | Server | Yes | Signs `kc_session` JWT (HS256) |
