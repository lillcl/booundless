/* Service-attachment routes (T5).
   POST /api/service-requests/:id/attachments/upload       — start upload; returns { attachment_id, signed_url }
   POST /api/service-requests/:id/attachments/:id/finalize — validate object exists, mark ready
   GET  /api/service-requests/:id/attachments/:id          — short-lived read URL

   Per spec §5.7: signed upload URLs valid 10 minutes, read URLs 5 minutes,
   JPEG/PNG/WebP only, <=5MB per file, <=20 per request. Storage adapter
   abstracts Supabase / Vercel Blob / local for development.

   This first slice ships a local-disk implementation under
   SERVICE_EVIDENCE_DIR for dev, and a stub for cloud providers that
   requires SUPABASE_STORAGE_BUCKET to be set. Production must configure
   SUPABASE_SERVICE_KEY + SUPABASE_STORAGE_BUCKET to enable uploads. */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody } from '../_lib/http.js';
import { audit } from '../_lib/auth.js';

const SIGN_SECRET = () => process.env.KC_ATTACHMENT_SIGN_SECRET || process.env.KC_JWT_SECRET || 'dev-secret-do-not-use';
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const READ_TTL_MS = 5 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_REQUEST = 20;
const VALID_PURPOSES = ['before', 'after', 'inspection', 'previous_quote', 'receipt'];
const VALID_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function signUrl(url, expiresAt) {
  const sig = createHmac('sha256', SIGN_SECRET())
    .update(`${url}|${expiresAt}`).digest('hex');
  return { url: `${url}?exp=${expiresAt}&sig=${sig}` };
}

function verifySig(url, exp, sig) {
  if (Number(exp) < Date.now()) return false;
  const expected = createHmac('sha256', SIGN_SECRET())
    .update(`${url}|${exp}`).digest('hex');
  return expected === sig;
}

function storage() {
  // Returns { kind, root, signPut, signGet, exists, write }
  // Local adapter only for first slice; cloud adapters added per env.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET) {
    return { kind: 'supabase-stub', exists: async () => false, write: async () => { throw new Error('cloud upload not wired in this slice'); } };
  }
  const root = process.env.SERVICE_EVIDENCE_DIR || '/tmp/kc-evidence';
  return {
    kind: 'local',
    root,
    async exists(objectKey) {
      try { await stat(join(root, objectKey)); return true; } catch { return false; }
    },
    async write(objectKey, buffer) {
      const full = join(root, objectKey);
      await mkdir(join(root, objectKey.split('/').slice(0, -1).join('/')), { recursive: true }).catch(() => {});
      await writeFile(full, buffer);
    },
  };
}

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const m = url.match(/^\/api\/service-requests\/([^/?#]+)\/attachments(?:\/([^/?#]+))?(?:\/(upload|finalize))?\/?$/);
  if (!m) return sendError(res, 404, 'not_found', 'Attachment route not found');
  const user = await requireUser(req, res); if (!user) return;
  const requestId = m[1];
  const attachmentId = m[2];
  const action = m[3];
  const db = await getDb();
  const client = await db.connect();

  try {
    const r = (await client.query(
      `SELECT * FROM dealer_service_requests WHERE id=$1`, [requestId]
    )).rows[0];
    if (!r) { await client.release(); return sendError(res, 404, 'not_found', 'Request not found'); }
    const member = (await client.query(
      `SELECT m.role FROM dealer_members m WHERE m.dealer_id=$1 AND m.user_id=$2
         AND m.role IN ('owner','manager','staff')`, [r.dealer_id, user.id]
    )).rows[0];
    const isOwner = r.user_id === user.id;
    if (!isOwner && !member) { await client.release(); return sendError(res, 403, 'forbidden', 'Access denied'); }

    if (req.method === 'POST' && action === 'upload') {
      const body = await readBody(req);
      const mime = String(body?.mime_type || '');
      if (!VALID_MIME.includes(mime)) { await client.release(); return sendError(res, 422, 'unprocessable', 'Invalid mime_type'); }
      const size = Number(body?.size_bytes);
      if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'size_bytes out of range');
      }
      const purpose = String(body?.purpose || '');
      if (!VALID_PURPOSES.includes(purpose)) { await client.release(); return sendError(res, 422, 'unprocessable', 'Invalid purpose'); }
      const count = await client.query(
        `SELECT COUNT(*)::int AS n FROM service_attachments WHERE request_id=$1`, [requestId]
      );
      if (count.rows[0].n >= MAX_PER_REQUEST) {
        await client.release(); return sendError(res, 409, 'conflict', 'Per-request attachment limit reached');
      }
      const objectKey = `requests/${requestId}/${randomUUID()}`;
      await client.query(
        `INSERT INTO service_attachments
           (request_id, uploaded_by, object_key, mime_type, size_bytes, purpose, upload_state)
         VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
        [requestId, user.id, objectKey, mime, size, purpose]
      );
      const att = (await client.query(
        `SELECT id FROM service_attachments WHERE object_key=$1`, [objectKey]
      )).rows[0];
      const expires = Date.now() + UPLOAD_TTL_MS;
      const putUrl = `/api/internal/evidence/${encodeURIComponent(objectKey)}`;
      const signed = signUrl(putUrl, expires);
      await audit({ actor: user, action: 'attachment.upload_intent',
        targetType: 'attachment', targetId: att.id, payload: { request_id: requestId, purpose, size, mime } });
      await client.release();
      return sendJSON(res, 201, { data: { attachment_id: att.id, upload_url: signed.url, expires_at: expires } });
    }

    if (req.method === 'POST' && action === 'finalize') {
      const body = await readBody(req);
      const att = (await client.query(
        `SELECT * FROM service_attachments WHERE id=$1 AND request_id=$2`, [attachmentId, requestId]
      )).rows[0];
      if (!att) { await client.release(); return sendError(res, 404, 'not_found', 'Attachment not found'); }
      if (att.uploaded_by !== user.id) { await client.release(); return sendError(res, 403, 'forbidden', 'Only uploader can finalize'); }
      if (att.upload_state !== 'pending') { await client.release(); return sendError(res, 409, 'conflict', 'Already finalized'); }
      const store = storage();
      const exists = await store.exists(att.object_key);
      if (!exists) { await client.release(); return sendError(res, 422, 'unprocessable', 'Object not present in storage'); }
      // Validate size matches declared; for local, just stat.
      let actualSize = att.size_bytes;
      if (store.kind === 'local') {
        const s = await stat(join(store.root, att.object_key));
        actualSize = s.size;
      }
      if (actualSize !== att.size_bytes) {
        await client.query(`UPDATE service_attachments SET upload_state='failed' WHERE id=$1`, [att.id]);
        await client.release();
        return sendError(res, 422, 'unprocessable', 'size mismatch');
      }
      await client.query(
        `UPDATE service_attachments SET upload_state='ready' WHERE id=$1`, [att.id]
      );
      await audit({ actor: user, action: 'attachment.finalize',
        targetType: 'attachment', targetId: att.id });
      await client.release();
      return sendJSON(res, 200, { data: { id: att.id, state: 'ready' } });
    }

    if (req.method === 'GET' && attachmentId && !action) {
      const att = (await client.query(
        `SELECT * FROM service_attachments WHERE id=$1 AND request_id=$2`, [attachmentId, requestId]
      )).rows[0];
      if (!att) { await client.release(); return sendError(res, 404, 'not_found', 'Attachment not found'); }
      if (att.upload_state !== 'ready') { await client.release(); return sendError(res, 409, 'conflict', 'Not ready'); }
      const expires = Date.now() + READ_TTL_MS;
      const getUrl = `/api/internal/evidence/${encodeURIComponent(att.object_key)}`;
      const signed = signUrl(getUrl, expires);
      await client.release();
      return sendJSON(res, 200, { data: { url: signed.url, expires_at: expires } });
    }

    await client.release();
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.release();
    return sendError(res, 500, 'internal_error', e.message);
  }
}

/* Internal endpoint to actually read / write the signed-URL target. Mounted by
   the internal router only. Not exposed under /api in production spec. */
export async function internalEvidenceHandler(req, res, objectKey, mode, exp, sig) {
  const url = `/api/internal/evidence/${encodeURIComponent(objectKey)}`;
  if (!verifySig(url, exp, sig)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  const store = storage();
  if (store.kind !== 'local') {
    res.statusCode = 503;
    return res.end('Cloud storage adapter not yet wired.');
  }
  if (mode === 'PUT') {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        await store.write(objectKey, Buffer.concat(chunks));
        res.statusCode = 200; res.end('ok');
      } catch (e) { res.statusCode = 500; res.end(e.message); }
    });
    return;
  }
  if (mode === 'GET') {
    try {
      const buf = await readFile(join(store.root, objectKey));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(buf);
    } catch (e) { res.statusCode = 404; res.end('Not found'); }
    return;
  }
  res.statusCode = 405; res.end('Method not allowed');
}