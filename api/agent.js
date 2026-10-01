import { readSession } from './_lib/auth.js';
import { confirmAgentTool, inputMessage, runAgent } from './_lib/agent.js';
import { getDb } from './_lib/db.js';
import { admitAgentRequest, finishAgentRequest, getAgentQuota, requestFingerprint, AgentUsageError } from './_lib/agent-usage.js';
import { sanitizePageContext } from './_lib/assistant-context.js';
import { readBody, sendError, sendJSON } from './_lib/http.js';
import { originCheckWrap } from './_lib/origin-check.js';
import { publicRuntimeError } from './_lib/agent-errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lastMessage(body) {
  if (body?.message != null) return body.message;
  if (Array.isArray(body?.messages) && body.messages.length) return body.messages.at(-1);
  return null;
}

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function publicAgentError(error) {
  if (error instanceof AgentUsageError) return error.message;
  return publicRuntimeError(error);
}

// Dependency injection keeps the route contract testable without live AI usage.
export function createAgentHandler(dependencies = {}) {
  const services = { readSession, getDb, runAgent, confirmAgentTool, admitAgentRequest, finishAgentRequest, getAgentQuota, ...dependencies };
  return async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return sendError(res, 405, 'method_not_allowed', 'Only GET or POST allowed');
  let streaming = false; let user; let db; let admitted = false; let requestId; let heartbeat;
  const accounting = { tokens: 0, modelCalls: 0 };
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  const events = [];
  try {
    user = await services.readSession(req);
    if (!user) return sendJSON(res, 401, { error: { code: 'unauthorized', message: '登入後才可使用界仔，每個帳戶每日最多 5 次提問。' } });
    db = await services.getDb();
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return sendJSON(res, 200, { user_id: user.id, quota: await services.getAgentQuota(db, user.id) });
    const body = await readBody(req, { limit: '8mb' });
    const message = lastMessage(body);
    const confirmation = body?.confirmation;
    const pageContext = sanitizePageContext(body?.page_context);
    requestId = body?.request_id || req.headers?.['idempotency-key'];
    if (typeof requestId !== 'string' || !UUID.test(requestId)) return sendError(res, 422, 'unprocessable', 'A UUID request_id is required');
    if (!confirmation && message == null) return sendError(res, 422, 'unprocessable', 'message is required');
    if (confirmation && (!body.thread_id || !confirmation.tool_call_id || typeof confirmation.approved !== 'boolean')) return sendError(res, 422, 'unprocessable', 'thread_id, confirmation.tool_call_id and confirmation.approved are required');
    if (confirmation && !UUID.test(String(confirmation.tool_call_id))) return sendError(res, 422, 'unprocessable', 'Invalid confirmation id');
    if (!confirmation) {
      try { inputMessage(message); } catch { return sendError(res, 422, 'unprocessable', '問題須為 1 至 4000 字，並符合圖片大小限制。'); }
    }
    if (body.thread_id) {
      if (typeof body.thread_id !== 'string' || body.thread_id.length > 120) return sendError(res, 422, 'unprocessable', 'Invalid thread_id');
      const thread = await db.query('SELECT id FROM agent_threads WHERE id=$1 AND user_id=$2', [body.thread_id, user.id]);
      if (!thread.rowCount) return sendError(res, 404, 'thread_not_found', '找不到這個對話，請開始新對話。');
    }
    const admission = await services.admitAgentRequest(db, { userId: user.id, requestId, fingerprint: requestFingerprint({ thread_id: body.thread_id || null, message: confirmation ? null : message, confirmation: confirmation || null, page_context: pageContext }), confirmation: Boolean(confirmation) });
    admitted = !admission.replay;
    streaming = body?.stream !== false;
    if (streaming) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      heartbeat = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': keepalive\n\n'); }, 5000);
    }
    const onEvent = async (event) => {
      events.push(event);
      if (streaming && !res.writableEnded && !res.destroyed) sse(res, event);
    };
    if (admission.replay) {
      const replay = admission.replay;
      if (replay.error) {
        if (streaming) { sse(res, { type: 'error', ...replay.error }); return res.end(); }
        return sendJSON(res, replay.status || 500, { error: replay.error, quota: admission.quota });
      }
      const result = { ...replay.result, quota: admission.quota };
      if (streaming) { sse(res, { type: 'quota', quota: admission.quota }); for (const event of replay.events || []) if (event.type !== 'quota') sse(res, event); sse(res, { type: 'done', result }); return res.end(); }
      return sendJSON(res, 200, result);
    }
    res.on?.('close', disconnect);
    await onEvent({ type: 'quota', quota: admission.quota });
    const result = confirmation
      ? await services.confirmAgentTool({ user, threadId: body.thread_id, toolCallId: confirmation.tool_call_id, approved: confirmation.approved, onEvent })
      : await services.runAgent({ user, threadId: body.thread_id, message, pageContext, onEvent, signal: controller.signal, accounting });
    result.quota = admission.quota;
    result.request_id = requestId;
    await services.finishAgentRequest(db, { userId: user.id, requestId, tokens: accounting.tokens, response: { result, events } });
    if (res.destroyed) return;
    if (streaming) { sse(res, { type: 'done', result }); return res.end(); }
    return sendJSON(res, 200, result);
  } catch (error) {
    const code = error instanceof AgentUsageError ? error.code : typeof error.code === 'string' && error.code.startsWith('agent_') ? error.code : 'agent_internal';
    const payload = { code, message: publicAgentError(error), ...(requestId && UUID.test(requestId) ? { request_id: requestId } : {}), ...(error.runId ? { run_id: error.runId, thread_id: error.threadId } : {}) };
    if (!(error instanceof AgentUsageError)) console.error(JSON.stringify({ event: 'assistant_request_failed', code, request_id: payload.request_id, run_id: error.runId || null }));
    if (admitted) await services.finishAgentRequest(db, { userId: user.id, requestId, tokens: accounting.tokens, failed: true, response: { error: payload, status: error.status || 503 } }).catch(() => {});
    if (streaming && res.headersSent) { if (!res.writableEnded && !res.destroyed) { sse(res, { type: 'error', ...payload }); res.end(); } return; }
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    return sendJSON(res, error.status || 503, { error: payload, ...(error.quota ? { quota: error.quota } : {}) });
  } finally {
    clearInterval(heartbeat);
    res.off?.('close', disconnect);
  }
  };
}

export default originCheckWrap(createAgentHandler());
