// api/_handlers/auth.js.add_wechat.diff
// Apply to api/_handlers/auth.js — adds POST /api/auth/wechat endpoint.
//
// 1) Add new env vars to .env.example (or your secret store):
//    WECHAT_APPID=wxXXXXXXXXXXXX
//    WECHAT_SECRET=your_app_secret
//
// 2) Append the following export to api/_handlers/auth.js (or create
//    api/_handlers/auth-wechat.js and route it in api/index.js):
//
// See full implementation below.

import { sendJSON, sendError, readBody } from '../_lib/http.js'
import { signSession, setSessionCookie } from '../_lib/auth.js'

const WECHAT_APPID = process.env.WECHAT_APPID || ''
const WECHAT_SECRET = process.env.WECHAT_SECRET || ''

// POST /api/auth/wechat
// Body: { code, nickname?, avatar_url?, phone?, unionid? }
// Returns: { user, token }
export async function wechatLogin(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST')
  if (!WECHAT_APPID || !WECHAT_SECRET) {
    return sendError(res, 500, 'wechat_not_configured', 'WECHAT_APPID/WECHAT_SECRET missing')
  }

  const body = await readBody(req, { limit: 4096 }).catch(() => ({}))
  const code = body && body.code
  if (!code) return sendError(res, 422, 'unprocessable', 'Missing code')

  // Exchange code for openid + session_key
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + '?appid=' + encodeURIComponent(WECHAT_APPID)
    + '&secret=' + encodeURIComponent(WECHAT_SECRET)
    + '&js_code=' + encodeURIComponent(code)
    + '&grant_type=authorization_code'

  let wxRes
  try {
    wxRes = await fetch(url).then(r => r.json())
  } catch (e) {
    return sendError(res, 502, 'wechat_unreachable', 'Cannot reach jscode2session')
  }

  if (!wxRes || !wxRes.openid) {
    return sendError(res, 422, 'wechat_rejected', (wxRes && wxRes.errmsg) || 'jscode2session failed')
  }

  const openid = wxRes.openid
  const unionid = wxRes.unionid || body.unionid || null

  // Upsert user by openid
  const now = new Date().toISOString()
  const userId = 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)

  const upsert = await req.db.query(
    `INSERT INTO users (id, email, role, display_name, is_active, wechat_openid, wechat_unionid, wechat_appid, nickname, avatar_url, created_at, updated_at)
       VALUES ($1, $2, 'user', $3, true, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (wechat_openid) DO UPDATE SET
       wechat_unionid = COALESCE(EXCLUDED.wechat_unionid, users.wechat_unionid),
       nickname       = COALESCE(EXCLUDED.nickname,       users.nickname),
       avatar_url     = COALESCE(EXCLUDED.avatar_url,     users.avatar_url),
       phone          = COALESCE(EXCLUDED.phone,          users.phone),
       updated_at     = EXCLUDED.updated_at
     RETURNING id, email, role, display_name, nickname, avatar_url, is_active`,
    [
      userId,
      'wx_' + openid + '@wechat.local',
      body.nickname || '微信車主',
      openid,
      unionid,
      WECHAT_APPID,
      body.nickname || null,
      body.avatar_url || null,
      now
    ]
  ).catch((e) => {
    // email conflict (unique): fall back to update by openid
    if (e && e.code === '23505') {
      return req.db.query(
        `UPDATE users SET
            nickname       = COALESCE($2, nickname),
            avatar_url     = COALESCE($3, avatar_url),
            wechat_unionid = COALESCE($4, wechat_unionid),
            updated_at     = $5
          WHERE wechat_openid = $1
          RETURNING id, email, role, display_name, nickname, avatar_url, is_active`,
        [openid, body.nickname || null, body.avatar_url || null, unionid, now]
      )
    }
    throw e
  })

  const row = upsert.rows && upsert.rows[0]
  if (!row) return sendError(res, 500, 'wechat_upsert_failed', 'Could not persist user')

  const sessionUser = {
    id: row.id,
    email: row.email,
    role: row.role,
    display_name: row.display_name,
    nickname: row.nickname,
    avatar_url: row.avatar_url,
    is_active: row.is_active
  }

  const token = await signSession(sessionUser)
  setSessionCookie(res, token)

  // Audit
  try {
    await req.db.query(
      `INSERT INTO audit_log (id, actor_user_id, actor_email, action, target_type, target_id, payload, ip, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'auth.wechat_login', 'user', $1, $3, $4, $5, NOW())`,
      [sessionUser.id, sessionUser.email, JSON.stringify({ openid: openid.slice(0, 6) + '***' }), req.ip || null, req.headers['user-agent'] || null]
    )
  } catch (e) {}

  sendJSON(res, 200, { user: sessionUser, token: token })
}

// 3) Register the route in api/index.js — add to the resolveHandler switch:
//    case path === '/api/auth/wechat': return wechatLogin
// Or if you mount handlers by file name (api/_handlers/auth.js), the existing
// `handlers.auth` object should expose wechatLogin at /api/auth/wechat.