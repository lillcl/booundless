import { getDb } from './_lib/db.js';
import { requireUser } from './_lib/auth.js';
import { askAI } from './_lib/ai.js';
import { readBody, sendError, sendJSON } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const body = await readBody(req, { limit: '8mb' });
    const mode = body?.mode;
    let system = '你是康程 CarAI 助手。使用繁體中文，回答精簡實用；不要虛構車況、法規或即時路況。清楚說明這只是建議。';
    let prompt = '';
    if (mode === 'service') {
      const db = await getDb();
      const vehicleId = String(body.vehicle_id || '');
      const [v, s, h] = await Promise.all([
        db.query('SELECT id,model,mileage_km FROM vehicles WHERE id=$1', [vehicleId]),
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
      const image = body.image.slice(0, 7 * 1024 * 1024);
      const result = await askAI({
        system: `${system} 你是車輛照片辨識助手。只輸出 JSON，格式為 {"model":"","make":"","year":null,"fuel_type":"","plate":""}。看不清楚的欄位請留空，不要猜車牌。`,
        user: [{ type: 'text', text: '請辨識照片中的車輛，回傳指定 JSON。' }, { type: 'image_url', image_url: { url: image } }],
        model: process.env.AI_VISION_MODEL || process.env.AI_MODEL,
        maxTokens: 300,
      });
      let vehicle = {};
      try { vehicle = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, '').trim()); } catch { /* keep empty fields when provider returns non-JSON */ }
      return sendJSON(res, 200, { vehicle, model: result.model });
    } else if (mode === 'dashboard-image') {
      if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return sendError(res, 422, 'unprocessable', 'image must be a data URL');
      const image = body.image.slice(0, 7 * 1024 * 1024);
      const result = await askAI({
        system: `${system} 你是汽車儀表盤讀取助手。只輸出 JSON，格式為 {"mileage_km":null,"warning_lights":[],"displayed_messages":[],"confidence":"low|medium|high"}。只讀取清楚可見的里程、警示燈與文字。看不清楚就用 null 或空陣列；絕不可猜測車況或把保養燈當故障。`,
        user: [{ type: 'text', text: '請讀取這張儀表盤照片中的可見資訊，回傳指定 JSON。' }, { type: 'image_url', image_url: { url: image } }],
        model: process.env.AI_VISION_MODEL || process.env.AI_MODEL,
        maxTokens: 300,
      });
      let dashboard = {};
      try { dashboard = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, '').trim()); } catch { /* ask user to enter it manually */ }
      const mileage = Number(dashboard.mileage_km);
      if (!Number.isFinite(mileage) || mileage < 0 || mileage > 3000000) dashboard.mileage_km = null;
      if (!Array.isArray(dashboard.warning_lights)) dashboard.warning_lights = [];
      if (!Array.isArray(dashboard.displayed_messages)) dashboard.displayed_messages = [];
      return sendJSON(res, 200, { dashboard, model: result.model });
    } else return sendError(res, 422, 'unprocessable', 'mode must be service, trip, support, vehicle-image or dashboard-image');
    const result = await askAI({ system, user: prompt });
    return sendJSON(res, 200, result);
  } catch (e) { return sendError(res, 500, 'ai_error', e.message); }
}
