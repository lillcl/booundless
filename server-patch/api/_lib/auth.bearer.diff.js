// api/_lib/auth.js.add_bearer.diff
// Apply to api/_lib/auth.js — add Bearer token support alongside the existing
// HttpOnly cookie session. Backwards compatible.

import { jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(process.env.KC_JWT_SECRET || '')

export async function readSessionToken(req) {
  // 1) Authorization: Bearer <jwt>  (preferred for 小程序 / mobile clients)
  const authHeader = req.headers && req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim()
  }
  // 2) kc_session cookie (existing web flow)
  const cookieHeader = req.headers && req.headers.cookie
  if (cookieHeader) {
    const parts = cookieHeader.split(/;\s*/)
    for (const p of parts) {
      const eq = p.indexOf('=')
      if (eq === -1) continue
      const k = p.slice(0, eq).trim()
      const v = p.slice(eq + 1).trim()
      if (k === 'kc_session') return decodeURIComponent(v)
    }
  }
  return null
}

// readSession(req) and the rest of the file remain unchanged.