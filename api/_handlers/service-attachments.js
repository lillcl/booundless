/* Service-attachment routes (T5).
   POST /api/service-requests/:id/attachments/upload       — start upload; returns { attachment_id, signed_url }
   POST /api/service-requests/:id/attachments/:id/finalize — validate object exists, mark ready
   GET  /api/service-requests/:id/attachments/:id          — short-lived read URL

   Per spec §5.7: signed upload URLs valid 10 minutes, read URLs 5 minutes,
   JPEG/PNG/WebP only, <=5MB per file, <=20 per request. Storage adapter
   abstracts Supabase / Vercel Blob / local for development.

   Local development uses SERVICE_EVIDENCE_DIR. Production can proxy a
   private Supabase Storage bucket by configuring SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET; the service-role
   credential is never exposed to the browser. */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
  if (!/^[a-f0-9]{64}$/i.test(String(sig || ''))) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}

function detectMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function storage() {
  // Returns a private local or Supabase-backed storage adapter.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET) {
    const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket=process.env.SUPABASE_STORAGE_BUCKET;
    if(!base)throw new Error('SUPABASE_URL is required for evidence storage');
    const objectUrl=(objectKey,authenticated=false)=>`${base}/storage/v1/object/${authenticated?'authenticated/':''}${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
    const headers={Authorization:`Bearer ${key}`,apikey:key};
    return {
      kind:'supabase',
      async exists(objectKey){const response=await fetch(objectUrl(objectKey,true),{method:'HEAD',headers});return response.ok;},
      async write(objectKey,buffer,mime){const response=await fetch(objectUrl(objectKey),{method:'POST',headers:{...headers,'Content-Type':mime||detectMime(buffer)||'application/octet-stream','x-upsert':'false'},body:buffer});if(!response.ok)throw new Error(`Storage upload failed (${response.status})`);},
      async read(objectKey){const response=await fetch(objectUrl(objectKey,true),{headers});if(!response.ok)throw new Error('Not found');return Buffer.from(await response.arrayBuffer());},
    };
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
    async read(objectKey){return readFile(join(root,objectKey));},
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
      const buffer = await store.read(att.object_key);
      const actualSize = buffer.length;
      if (actualSize !== att.size_bytes) {
        await client.query(`UPDATE service_attachments SET upload_state='failed' WHERE id=$1`, [att.id]);
        await client.release();
        return sendError(res, 422, 'unprocessable', 'size mismatch');
      }
      if (detectMime(buffer) !== att.mime_type) {
        await client.query(`UPDATE service_attachments SET upload_state='failed' WHERE id=$1`, [att.id]);
        await client.release();
        return sendError(res, 422, 'unprocessable', 'File signature does not match mime_type');
      }
      await client.query(`UPDATE service_attachments SET sha256=$1 WHERE id=$2`,
        [createHash('sha256').update(buffer).digest('hex'), att.id]);
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
  if (!/^requests\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/i.test(objectKey)) {
    res.statusCode = 400;
    return res.end('Invalid object key');
  }
  const url = `/api/internal/evidence/${encodeURIComponent(objectKey)}`;
  if (!verifySig(url, exp, sig)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  const store = storage();
  if (mode === 'PUT') {
    let chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BYTES) {
        chunks = [];
        res.statusCode = 413;
        res.end('File too large');
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const buffer = Buffer.concat(chunks);
        if (!detectMime(buffer)) { res.statusCode = 415; return res.end('Unsupported image'); }
        await store.write(objectKey, buffer, detectMime(buffer));
        res.statusCode = 200; res.end('ok');
      } catch (e) { res.statusCode = 500; res.end(e.message); }
    });
    return;
  }
  if (mode === 'GET') {
    try {
      const buf = await store.read(objectKey);
      res.setHeader('Content-Type', detectMime(buf) || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(buf);
    } catch (e) { res.statusCode = 404; res.end('Not found'); }
    return;
  }
  res.statusCode = 405; res.end('Method not allowed');
}

export async function internalEvidenceRoute(req,res) {
  const url=new URL(req.url||'','http://localhost');
  const match=url.pathname.match(/^\/api\/internal\/evidence\/([^/]+)$/);
  if(!match){res.statusCode=404;return res.end('Not found');}
  let objectKey;
  try{objectKey=decodeURIComponent(match[1]);}catch{res.statusCode=400;return res.end('Invalid object key');}
  return internalEvidenceHandler(req,res,objectKey,req.method,url.searchParams.get('exp'),url.searchParams.get('sig'));
}
