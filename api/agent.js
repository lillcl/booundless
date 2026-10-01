import { readSession } from './_lib/auth.js';
import { confirmAgentTool, runAgent } from './_lib/agent.js';
import { sanitizePageContext } from './_lib/assistant-context.js';
import { readBody, sendError, sendJSON } from './_lib/http.js';
import { runPublicAssistant } from './_lib/public-assistant.js';
import { originCheckWrap } from './_lib/origin-check.js';

const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

function allowRequest(userId) {
  const now = Date.now();
  const bucket = rateBuckets.get(userId) || { started: now, count: 0 };
  if (now - bucket.started >= RATE_WINDOW_MS) { bucket.started = now; bucket.count = 0; }
  bucket.count += 1; rateBuckets.set(userId, bucket);
  if (rateBuckets.size > 1000) for (const [id, value] of rateBuckets) if (now - value.started > RATE_WINDOW_MS) rateBuckets.delete(id);
  return bucket.count <= RATE_LIMIT;
}

function lastMessage(body) {
  if (body?.message != null) return body.message;
  if (Array.isArray(body?.messages) && body.messages.length) return body.messages.at(-1);
  return null;
}

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed', 'Only POST allowed');
  const user = await readSession(req);
  const requestKey = user?.id || `anonymous:${String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()}`;
  if (!allowRequest(requestKey)) return sendError(res, 429, 'rate_limited', 'Too many AI assistant requests; please try again shortly');
  let streaming = false;
  try {
    const body = await readBody(req, { limit: '8mb' });
    const message = lastMessage(body);
    const confirmation = body?.confirmation;
    const pageContext = sanitizePageContext(body?.page_context);
    if (!confirmation && message == null) return sendError(res, 422, 'unprocessable', 'message is required');
    if (confirmation && (!body.thread_id || !confirmation.tool_call_id || typeof confirmation.approved !== 'boolean')) return sendError(res, 422, 'unprocessable', 'thread_id, confirmation.tool_call_id and confirmation.approved are required');
    if (confirmation && !user) return sendError(res, 401, 'unauthorized', 'Sign in required to confirm data changes');
    streaming = body?.stream !== false;
    if (streaming) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
    }
    const onEvent = async (event) => { if (streaming && !res.writableEnded) sse(res, event); };
    const result = confirmation
      ? await confirmAgentTool({ user, threadId: body.thread_id, toolCallId: confirmation.tool_call_id, approved: confirmation.approved, onEvent })
      : user
        ? await runAgent({ user, threadId: body.thread_id, message, pageContext, onEvent })
        : await runPublicAssistant({ message, pageContext, budgetKey: requestKey, onEvent });
    if (streaming) { sse(res, { type: 'done', result }); return res.end(); }
    return sendJSON(res, 200, result);
  } catch (error) {
    if (streaming && res.headersSent) { if (!res.writableEnded) { sse(res, { type: 'error', message: error.message }); res.end(); } return; }
    return sendError(res, 500, 'agent_error', error.message);
  }
}

export default originCheckWrap(handler);
