/* CSP report-uri collector (T6 / §5.7 enhancement).
   Browsers POST `application/csp-report` JSON to this endpoint when CSP is
   violated. We log every report into `_meta` so the admin team can review.
   No PII is expected (CSP reports only carry URL + violated-directive). */

import { getDb } from '../_lib/db.js';
import { sendJSON } from '../_lib/http.js';
import { audit } from '../_lib/auth.js';

let META_DDL = `
  CREATE TABLE IF NOT EXISTS csp_reports (
    id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    document_uri TEXT,
    violated_directive TEXT,
    effective_directive TEXT,
    blocked_uri TEXT,
    source_file TEXT,
    line_number INTEGER,
    column_number INTEGER,
    sample TEXT,
    raw JSONB
  );
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const report = raw ? JSON.parse(raw) : {};
    const ev = Array.isArray(report['csp-report']) ? report['csp-report'] : (report['csp-report'] || report);
    const db = await getDb();
    await db.query(META_DDL);
    await db.query(
      `INSERT INTO csp_reports (document_uri, violated_directive, effective_directive,
                               blocked_uri, source_file, line_number, column_number,
                               sample, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ev['document-uri'] || null, ev['violated-directive'] || null,
       ev['effective-directive'] || null, ev['blocked-uri'] || null,
       ev['source-file'] || null,
       Number.isInteger(ev['line-number']) ? ev['line-number'] : null,
       Number.isInteger(ev['column-number']) ? ev['column-number'] : null,
       ev['sample'] || null, report]
    );
    await audit({ actor: { id: null, email: 'csp-reporter', role: 'system' },
      action: 'csp.report', targetType: 'csp_report', targetId: '0',
      payload: { violated_directive: ev['violated-directive'], blocked_uri: ev['blocked-uri'] } });
    sendJSON(res, 204, {});
  } catch (e) {
    res.statusCode = 400;
    res.end(`CSP report failed: ${e.message}`);
  }
}