import { getDb } from './_lib/db.js';
import { requireUser } from './_lib/auth.js';
import { randomUUID } from 'node:crypto';
import { askMeteredAI } from './_lib/metered-ai.js';
import { AgentUsageError } from './_lib/agent-usage.js';
import agentHandler from './agent.js';
import { normalizeVehicleVision, VEHICLE_VISION_SYSTEM } from './_lib/vehicle-vision.js';
import { readBody, sendError, sendJSON } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readBody(req, { limit: '8mb' });
    const mode = body?.mode;
    let system = '你是無界啟程 BOOUNDLESS 的 AI 助手。使用繁體中文，回答精簡實用；不要虛構車況、法規或即時路況，並提醒使用者核實建議。';
    let prompt = '';
    if (mode === 'service') {
      const db = await getDb();
      const vehicleId = String(body.vehicle_id || '');
      const [v, s, h] = await Promise.all([
        db.query('SELECT id,model,mileage_km FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL', [vehicleId, user.id]),
        db.query('SELECT item,wear,last_done_km,last_done_at FROM vehicle_status WHERE vehicle_id=$1 ORDER BY display_order', [vehicleId]),
        db.query('SELECT title,performed_at,mileage_km FROM service_history WHERE vehicle_id=$1 ORDER BY performed_at DESC LIMIT 8', [vehicleId]),
      ]);
      if (!v.rowCount) return sendError(res, 404, 'not_found', 'Vehicle not found');
      prompt = `車輛資料：${JSON.stringify(v.rows[0])}\n狀態：${JSON.stringify(s.rows)}\n紀錄：${JSON.stringify(h.rows)}\n問題：${body.question || '我應該先處理甚麼？'}`;
    } else if (mode === 'trip') {
      prompt = `請為以下行程提供簡短路線安排、出發前車輛檢查及注意事項：${JSON.stringify(body.trip || {})}`;
    } else if (mode === 'support') {
      prompt = `使用者問題：${String(body.question || '').slice(0, 2000)}`;
    } else if (mode === 'vehicle-image') {
      if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return sendError(res, 422, 'unprocessable', 'image must be a data URL');
      if (body.image.length > 7 * 1024 * 1024) return sendError(res, 413, 'image_too_large', 'Please upload a smaller photo');
      const image = body.image;
      const result = await askMeteredAI({
        userId: user.id, requestId: body.request_id, purpose: mode,
        system: VEHICLE_VISION_SYSTEM,
        user: [{ type: 'text', text: '辨識照片中央的主體車輛，回傳指定 JSON。' }, { type: 'image_url', image_url: { url: image } }],
        model: process.env.AI_VISION_MODEL || process.env.AI_MODEL,
        maxTokens: 450,
      });
      let raw = {};
      try { raw = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, '').trim()); } catch { /* unusable model output becomes an explicit empty result */ }
      const vehicle = normalizeVehicleVision(raw);
      return sendJSON(res, 200, { vehicle, model: result.model, provider: result.provider, quota: result.quota });
    } else if (mode === 'dashboard-image') {
      if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return sendError(res, 422, 'unprocessable', 'image must be a data URL');
      if (body.image.length > 7 * 1024 * 1024) return sendError(res, 413, 'image_too_large', 'Please upload a smaller photo');
      const image = body.image;
      const result = await askMeteredAI({
        userId: user.id, requestId: body.request_id, purpose: mode,
        system: `${system} 你是汽車儀表盤讀取助手。只輸出 JSON，格式為 {"mileage_km":null,"warning_lights":[],"displayed_messages":[],"confidence":"low|medium|high"}。只讀取清楚可見的里程、警示燈與文字。看不清楚就用 null 或空陣列；絕不可猜測車況或把保養燈當故障。`,
        user: [{ type: 'text', text: '請讀取這張儀表盤照片中的可見資訊，回傳指定 JSON。' }, { type: 'image_url', image_url: { url: image } }],
        model: process.env.AI_VISION_MODEL || process.env.AI_MODEL,
        maxTokens: 300,
      });
      let dashboard = {};
      try { dashboard = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, '').trim()); } catch { /* ask user to enter it manually */ }
      const mileage = dashboard.mileage_km == null || dashboard.mileage_km === '' ? NaN : Number(dashboard.mileage_km);
      dashboard.mileage_km = Number.isInteger(mileage) && mileage >= 0 && mileage <= 3000000 ? mileage : null;
      if (!Array.isArray(dashboard.warning_lights)) dashboard.warning_lights = [];
      if (!Array.isArray(dashboard.displayed_messages)) dashboard.displayed_messages = [];
      return sendJSON(res, 200, { dashboard, model: result.model, provider: result.provider, quota: result.quota });
    } else return sendError(res, 422, 'unprocessable', 'mode must be service, trip, support, vehicle-image or dashboard-image');
    // Compatibility endpoint cannot bypass the scope decision or five-a-day cap.
    req.body = { message: prompt, stream: false, request_id: body.request_id || randomUUID() };
    return agentHandler(req, res);
  } catch (e) {
    if (e instanceof AgentUsageError) {
      if (e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
      return sendJSON(res, e.status, { error: { code: e.code, message: e.message }, quota: e.quota });
    }
    return sendError(res, 503, 'ai_error', 'AI 暫時未能完成，請稍後再試。');
  }
}
