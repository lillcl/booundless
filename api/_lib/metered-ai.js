import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { askAI } from './ai.js';
import { admitAgentRequest, finishAgentRequest, requestFingerprint, AgentUsageError } from './agent-usage.js';

// Fixed-purpose vision and maintenance generation share the same account quota
// as chat. Generic questions must instead use the semantic agent decision gate.
export async function askMeteredAI({ userId, requestId = randomUUID(), purpose, ...options }) {
  if (!userId) throw new AgentUsageError('unauthorized', '登入後才可使用 AI。', 401);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) throw new AgentUsageError('invalid_request_id', 'Invalid request_id', 422);
  const db = await getDb();
  const admission = await admitAgentRequest(db, { userId, requestId, fingerprint: requestFingerprint({ purpose, ...options }) });
  if (admission.replay) {
    if (admission.replay.error) throw new AgentUsageError(admission.replay.error.code, admission.replay.error.message, admission.replay.status || 503);
    return { ...admission.replay.result, quota: admission.quota };
  }
  const accounting = { tokens: 0, modelCalls: 0 };
  try {
    const result = await askAI({ ...options, accounting });
    result.quota = admission.quota;
    await finishAgentRequest(db, { userId, requestId, tokens: accounting.tokens, response: { result } });
    return result;
  } catch (error) {
    await finishAgentRequest(db, { userId, requestId, tokens: accounting.tokens, failed: true, response: { error: { code: 'ai_error', message: 'AI 暫時未能完成，請稍後再試。' }, status: 503 } }).catch(() => {});
    throw error;
  }
}
