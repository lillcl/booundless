import { readFileSync } from 'node:fs';
import { getDb } from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { readBody, sendJSON, sendError } from '../_lib/http.js';
import { ORIGIN, validateMetadata, renderMetadata } from '../_lib/marketing.js';

const template = () => readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

export async function publicPage(req, res) {
  const path = new URL(req.url, ORIGIN).pathname;
  if (!['/', '/demo'].includes(path)) return sendError(res,404,'not_found','Page not found');
  let html = template();
  try {
    const db = await getDb();
    const result = await db.query('SELECT published FROM marketing_pages WHERE path=$1', [path]);
    html = renderMetadata(html, path, result.rows[0]?.published);
    res.setHeader('Cache-Control','public, max-age=0, s-maxage=60');
  } catch {
    // Static application remains available while database configuration is unavailable.
    res.setHeader('Cache-Control','no-store');
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.statusCode = 200; res.end(html);
}

export default async function marketing(req,res) {
  res.setHeader('Cache-Control','no-store');
  const admin = await requireAdmin(req,res);
  if (!admin) return;
  const url = new URL(req.url, ORIGIN);
  if (!['GET','PATCH','POST'].includes(req.method)) return sendError(res,405,'method_not_allowed','Use GET, PATCH or POST');
  if (req.method !== 'GET' && req.headers.origin && ![ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000'].includes(req.headers.origin)) return sendError(res,403,'forbidden','Invalid origin');
  try {
    const db = await getDb();
    if (req.method === 'GET') {
      const pages = await db.query('SELECT * FROM marketing_pages ORDER BY path');
      const revisions = await db.query('SELECT * FROM marketing_revisions ORDER BY id DESC LIMIT 50');
      return sendJSON(res,200,{pages:pages.rows,revisions:revisions.rows});
    }
    const body = await readBody(req);
    if (!['/','/demo'].includes(body.path) || !Number.isInteger(body.version)) return sendError(res,422,'unprocessable','Valid path and version required');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT * FROM marketing_pages WHERE path=$1 FOR UPDATE',[body.path])).rows[0];
      if (!row || row.version !== body.version) {
        await client.query('ROLLBACK');
        return sendError(res,409,'conflict','Page changed; reload before saving');
      }
      let content;
      if (req.method === 'PATCH') {
        content = validateMetadata(body.content || {});
        await client.query('UPDATE marketing_pages SET draft=$1,version=version+1,updated_at=NOW(),updated_by=$3 WHERE path=$2',[content,body.path,admin.id]);
      } else {
        if (body.revision_id) {
          content = (await client.query('SELECT content FROM marketing_revisions WHERE id=$1 AND page_path=$2',[body.revision_id,body.path])).rows[0]?.content;
          if (!content) throw new Error('Revision not found');
        } else content = row.draft;
        content = validateMetadata(content);
        await client.query('INSERT INTO marketing_revisions(page_path,content,actor_id) VALUES($1,$2,$3)',[body.path,content,admin.id]);
        await client.query('UPDATE marketing_pages SET draft=$1,published=$1,version=version+1,updated_at=NOW(),updated_by=$3 WHERE path=$2',[content,body.path,admin.id]);
      }
      const updated = (await client.query('SELECT * FROM marketing_pages WHERE path=$1',[body.path])).rows[0];
      await client.query('COMMIT');
      return sendJSON(res,200,{page:updated});
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } catch(error) { return sendError(res,422,'unprocessable',error.message); }
}
