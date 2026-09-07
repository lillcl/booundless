/* GET /api/health — liveness probe. */
import { sendJSON } from './_lib/http.js';

export default async function handler(_req, res) {
  sendJSON(res, 200, {
    ok: true,
    service: 'kc-carai',
    version: '0.1.0',
    time: new Date().toISOString(),
  });
}