# Server Patch — WeChat Mini Program Support

These are the three additive changes the **小程序** client (`miniprogram/`) needs in order to run against the existing Vercel-style backend.

They are intentionally kept **out of** the main repo so the web app continues to ship untouched. Apply each diff manually when you're ready to onboard the 小程序 to production.

## 1. Database migration — add WeChat columns

Run [`db/migrations/2026_09_wechat_columns.sql`](db/migrations/2026_09_wechat_columns.sql) against your database:

```bash
# Local dev (Postgres on 127.0.0.1:5432)
psql "$KC_DATABASE_URL" -f db/migrations/2026_09_wechat_columns.sql

# Production (Supabase / managed Postgres)
psql "$SUPABASE_DB_URL" -f db/migrations/2026_09_wechat_columns.sql
```

The migration adds six nullable columns to `users` plus two partial unique indexes (`wechat_openid` unique, `wechat_unionid` indexed). All existing rows are unaffected.

After running, also update [`docs/DATABASE_SCHEMA.md`](../../docs/DATABASE_SCHEMA.md) to document the new columns (search for `users (id, email, role, ...)` and append the six wechat fields).

## 2. Auth.js — add Bearer transport

Replace the existing `readSessionToken` in [`api/_lib/auth.js`](../../api/_lib/auth.js) with the version in [`api/_lib/auth.bearer.diff.js`](api/_lib/auth.bearer.diff.js). The new function checks `Authorization: Bearer <jwt>` first, then falls back to the existing `kc_session` cookie. Nothing else in the file changes; all downstream callers (`requireUser`, `requireAdmin`, etc.) keep working.

## 3. Auth.js — add `POST /api/auth/wechat`

Append the `wechatLogin` handler from [`api/_handlers/auth.wechat.diff.js`](api/_handlers/auth.wechat.diff.js) to [`api/_handlers/auth.js`](../../api/_handlers/auth.js) (or split into a new file `api/_handlers/auth-wechat.js` and register it in `api/index.js`).

The handler:
1. Exchanges `{code}` for `openid` via `https://api.weixin.qq.com/sns/jscode2session`.
2. Upserts the `users` row keyed on `wechat_openid`.
3. Issues the same `kc_session` JWT used by the web login (via `signSession`).
4. Returns `{ user, token }` to the 小程序, which stores `token` in `wx.setStorageSync('kc_mp_token', token)` and sends it as `Authorization: Bearer <token>` on every subsequent call.

### Required env vars

Add to `.env.example` and your production secret store:

```
WECHAT_APPID=wxXXXXXXXXXXXX
WECHAT_SECRET=...
```

You can find both in **微信公众平台 → 开发 → 开发管理 → 开发设置**.

## Verifying the patch

After applying:

1. Re-run the existing integration suite to confirm no regression:
   ```bash
   TEST_DATABASE_URL=postgres://... node tests/merchant-marketing.integration.js
   ```
2. Smoke-test the new endpoint:
   ```bash
   curl -X POST https://api.your-host.com/api/auth/wechat \
     -H 'Content-Type: application/json' \
     -d '{"code":"test-fake-code"}'
   # Should respond with wechat_rejected (422) since the code is invalid.
   ```
3. From the 小程序 (after `wx.login()` succeeds), call `loginWithWechat()` and confirm `token` is returned and stored.

## Rollback

All three changes are additive — column drops are nullable, the Bearer transport is a no-op when no `Authorization` header is sent, and the new endpoint is independent. Rollback = drop the columns / revert the two `auth.js` patches. No data migration is needed in reverse.