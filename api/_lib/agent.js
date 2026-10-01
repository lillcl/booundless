import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getDb } from './db.js';
import { audit } from './auth.js';
import { vehicleTools } from '../_tools/vehicles.js';
import { maintenanceTools } from '../_tools/maintenance.js';
import { tripTools } from '../_tools/trips.js';
import { profileTools } from '../_tools/profile.js';
import { knowledgeTools } from '../_tools/knowledge.js';
import { navigationTools } from '../_tools/navigation.js';
import { getResearchTools } from '../_tools/research.js';
import { fenceUserContext, fenceToolResult } from './agent-safety.js';
import { DECISION_TOOL, decisionTool, normalizeDecisionResponse, policyPrompt, validateDecision } from './agent-policy.js';
import { AgentRuntimeError } from './agent-errors.js';
import { agentLimits, estimateInputTokens, usageTokens } from './agent-usage.js';
import { searchSiteKnowledge } from './site-knowledge.js';
import { queryKnowledgeGraph } from './knowledge-graph.js';
import { resolveAssistantRoute } from '../../shared/assistant-routes.js';

const MAX_HISTORY = 8;
const MAX_MESSAGE_CHARS = 4000;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;

const applicationTools = { ...vehicleTools, ...maintenanceTools, ...tripTools, ...profileTools, ...knowledgeTools, ...navigationTools };

function providerConfig() {
  const key = String(process.env.AI_API_KEY || '').trim();
  if (!key) throw new Error('AI_API_KEY is not configured');
  const base = String(process.env.AI_BASE_URL || 'https://api.minimax.io/v1').replace(/\/+$/, '');
  return { key, base, anthropic: /\/anthropic$/i.test(base), model: process.env.AI_MODEL || 'MiniMax-M3' };
}

function imagePartToAnthropic(part) {
  const url = part?.image_url?.url || part?.url || '';
  const match = String(url).match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
  if (!match) throw new Error('Images must be data URLs');
  if (match[2].length > MAX_IMAGE_CHARS) throw new Error('Image is too large');
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
}

export function toAnthropicContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: String(part.text || '') };
    if (part.type === 'image_url') return imagePartToAnthropic(part);
    if (part.type === 'tool_use') {
      const id = String(part.id || '').slice(0, 240);
      const name = String(part.name || '').slice(0, 240);
      if (!id || !name) throw new Error('AI returned an invalid tool use block');
      const input = part.input && typeof part.input === 'object' && !Array.isArray(part.input) ? part.input : {};
      if (JSON.stringify(input).length > 120000) throw new Error('AI tool arguments are too large');
      return { type: 'tool_use', id, name, input };
    }
    if (part.type === 'tool_result') {
      const toolUseId = String(part.tool_use_id || '').slice(0, 240);
      if (!toolUseId) throw new Error('Tool result is missing its tool use id');
      return { type: 'tool_result', tool_use_id: toolUseId, content: (typeof part.content === 'string' ? part.content : JSON.stringify(part.content)).slice(0, 120000), ...(part.is_error ? { is_error: true } : {}) };
    }
    if (part.type === 'thinking' || part.type === 'redacted_thinking') return part;
    return { type: 'text', text: String(part.text || part.content || '').slice(0, MAX_MESSAGE_CHARS) };
  });
}

function toOpenAIMessage(message) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.tool_call_id, content: (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).slice(0, 120000) };
  if (message.role === 'assistant') return { ...message };
  const result = { role: message.role, content: message.content || null };
  if (message.tool_calls) result.tool_calls = message.tool_calls;
  return result;
}

export async function callMinimax({ messages, tools, system, signal, json = false, timeoutMs, accounting = { tokens: 0, modelCalls: 0 } }) {
  const config = providerConfig();
  const limits = agentLimits();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, Math.min(timeoutMs || limits.timeoutMs, Number(process.env.AI_TIMEOUT_MS || 25000))));
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const toolList = Object.values(tools).map((tool) => config.anthropic
    ? { name: tool.name, description: tool.description, input_schema: tool.input_schema }
    : { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } });
  const body = config.anthropic ? {
    model: config.model, max_tokens: limits.outputTokens, temperature: Number(process.env.AI_TEMPERATURE || 0.2), system,
    messages: messages.map((message) => ({ ...message, content: toAnthropicContent(message.content) })), tools: toolList,
    tool_choice: json ? { type: 'none' } : { type: 'tool', name: DECISION_TOOL },
    ...(config.model === 'MiniMax-M3' ? { thinking: { type: 'disabled' } } : {}),
  } : {
    model: config.model, max_tokens: limits.outputTokens, temperature: Number(process.env.AI_TEMPERATURE || 0.2),
    messages: [{ role: 'system', content: system }, ...messages.map(toOpenAIMessage)], tools: toolList,
    tool_choice: json ? 'none' : { type: 'function', function: { name: DECISION_TOOL } },
    ...(config.model === 'MiniMax-M3' ? { thinking: { type: 'disabled' } } : {}),
  };
  const url = config.anthropic ? `${config.base}/v1/messages` : `${config.base}/chat/completions`;
  const headers = config.anthropic
    ? { 'content-type': 'application/json', 'x-api-key': config.key, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${config.key}` };
  try {
    const reservation = estimateInputTokens(body) + limits.outputTokens;
    if (accounting.modelCalls >= limits.modelCalls || accounting.tokens + reservation > limits.requestTokens) throw new AgentRuntimeError('agent_request_budget', 'Agent request budget exceeded', { status: 422 });
    if (controller.signal.aborted) throw new AgentRuntimeError('agent_cancelled', 'Agent request cancelled', { status: 499 });
    accounting.modelCalls += 1;
    accounting.tokens += reservation;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json().catch((error) => { if (controller.signal.aborted) throw error; return {}; });
    const providerCode = Number(payload?.base_resp?.status_code || payload?.error?.code || 0);
    if (!response.ok || providerCode) {
      const transient = [408, 429, 500, 502, 503, 504].includes(response.status) || [1000, 1001, 1002, 1024, 1033, 1039, 1041].includes(providerCode);
      const configuration = [401, 403].includes(response.status) || [1004, 1008, 2049, 2056].includes(providerCode);
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      throw new AgentRuntimeError(configuration ? 'agent_provider_configuration' : transient ? 'agent_provider_busy' : 'agent_provider_unavailable', `AI request failed (${response.status}, ${providerCode})`, {
        retryable: transient && retryAfter <= 1, diagnostics: { provider_status: response.status, provider_code: providerCode, retry_after: Number.isFinite(retryAfter) ? retryAfter : null },
      });
    }
    // Usage belongs to this invocation, not a cumulative counter. Missing usage
    // or a transport failure keeps the conservative reservation charged.
    const actualTokens = usageTokens(payload.usage);
    if (actualTokens > 0) accounting.tokens += actualTokens - reservation;
    if (config.anthropic) {
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      return { provider: 'anthropic', model: payload.model || config.model, raw: payload, content: blocks,
        text: blocks.filter((part) => part.type === 'text').map((part) => part.text).join(''),
        toolCalls: blocks.filter((part) => part.type === 'tool_use').map((part) => ({ id: part.id, name: part.name, args: part.input || {} })), usage: payload.usage || {} };
    }
    const message = payload?.choices?.[0]?.message || {};
    return { provider: 'openai', model: payload.model || config.model, raw: payload, content: message.content || '', text: message.content || '',
      toolCalls: (message.tool_calls || []).filter((call) => call.type === 'function').map((call) => ({ id: call.id, name: call.function.name, args: parseArgs(call.function.arguments) })), assistantMessage: message, usage: payload.usage || {} };
  } catch (error) {
    if (error instanceof AgentRuntimeError) throw error;
    if (controller.signal.aborted) throw new AgentRuntimeError(timedOut ? 'agent_timeout' : 'agent_cancelled', timedOut ? 'Model request timed out' : 'Agent request cancelled', { status: timedOut ? 504 : 499, retryable: timedOut && !signal?.aborted });
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) throw new AgentRuntimeError('agent_provider_unavailable', 'AI connection failed', { retryable: true });
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function parseArgs(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  // Keep malformed output in the decision-validation path so the same bounded
  // format repair is available on OpenAI-compatible transport as Anthropic.
  try { return JSON.parse(value); } catch { return null; }
}

function safePersist(value) {
  const json = JSON.stringify(value, (_key, current) => typeof current === 'string' && current.startsWith('data:image/') ? `[image omitted: ${current.slice(0, 30)}…]` : current);
  if (json.length <= 150000) return JSON.parse(json);
  return { truncated: true, preview: json.slice(0, 150000) };
}

export function inputMessage(value) {
  const validText = (text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_CHARS) throw new Error('Message must contain 1–4000 characters');
    return text;
  };
  if (typeof value === 'string') return { role: 'user', content: validText(value) };
  if (!value || typeof value !== 'object') throw new Error('message is required');
  const content = value.content ?? value.parts;
  if (typeof content === 'string') return { role: 'user', content: validText(content) };
  if (!Array.isArray(content) || !content.length || content.length > 3) throw new Error('message content is required');
  if (content.filter((part) => part.type === 'image_url').length > 1 || content.filter((part) => part.type === 'text').map((part) => String(part.text || '')).join('').length > MAX_MESSAGE_CHARS) throw new Error('Message is too large');
  return { role: 'user', content: content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: validText(part.text) };
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      if (!/^data:image\//.test(url) || url.length > MAX_IMAGE_CHARS) throw new Error('Invalid or oversized image');
      return { type: 'image_url', image_url: { url } };
    }
    throw new Error('Unsupported message part');
  }) };
}

async function ensureThread(db, user, requestedId, title) {
  if (requestedId) {
    const r = await db.query('SELECT id,title FROM agent_threads WHERE id=$1 AND user_id=$2', [requestedId, user.id]);
    if (!r.rowCount) throw new Error('Agent thread not found');
    return r.rows[0];
  }
  const id = randomUUID(); const r = await db.query('INSERT INTO agent_threads (id,user_id,title) VALUES ($1,$2,$3) RETURNING id,title', [id,user.id,title || 'AI 助手對話']);
  return r.rows[0];
}

async function saveMessage(db, threadId, role, parts) {
  await db.query('INSERT INTO agent_messages (thread_id,role,parts) VALUES ($1,$2,$3)', [threadId, role, JSON.stringify(safePersist(parts))]);
  await db.query('UPDATE agent_threads SET updated_at=NOW() WHERE id=$1', [threadId]);
}

async function history(db, threadId) {
  const r = await db.query(`SELECT role,parts FROM agent_messages WHERE thread_id=$1 AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT $2`, [threadId, MAX_HISTORY]);
  const rows = r.rows.reverse().map((row) => ({ role: row.role, content: Array.isArray(row.parts) ? row.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : String(row.parts || '') })).filter((row) => row.content);
  let remaining = 6000;
  return rows.reverse().map((row) => { const content = row.content.slice(0, Math.min(1500, remaining)); remaining -= content.length; return { ...row, content }; }).filter((row) => row.content).reverse();
}

async function toolRecord(db, runId, name, args, status, output = null, error = null, requiresConfirmation = false) {
  const r = await db.query(`INSERT INTO agent_tool_calls (run_id,tool_name,input,output,status,error,requires_confirmation)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [runId,name,JSON.stringify(safePersist(args || {})),output == null ? null : JSON.stringify(safePersist(output)),status,error,requiresConfirmation]);
  return r.rows[0].id;
}

async function finishRun(db, runId, status, usage, error = null) {
  await db.query('UPDATE agent_runs SET status=$2,completed_at=NOW(),token_usage=$3,error=$4 WHERE id=$1', [runId,status,JSON.stringify(usage || {}),error]);
}

async function executeToolWithTimeout(tool, args, user, signal, pageContext = {}) {
  const timeoutMs = Number(process.env.AGENT_TOOL_TIMEOUT_MS || 7000);
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tool timed out')), timeoutMs); });
  try { return await Promise.race([tool.execute({ args, user, signal, pageContext }), timeout]); }
  finally { clearTimeout(timer); }
}

async function persistResearchResult(db, user, query, output) {
  const run = await db.query(`INSERT INTO research_runs (user_id,query,status,completed_at)
    VALUES ($1,$2,'completed',NOW()) RETURNING id`, [user.id, String(query).slice(0, 4000)]);
  const sources = Array.isArray(output?.sources) && output.sources.length ? output.sources : [output];
  for (const source of sources.slice(0, 20)) {
    await db.query(`INSERT INTO research_sources (research_run_id,title,url,source_name,retrieved_at,content)
      VALUES ($1,$2,$3,$4,NOW(),$5)`, [run.rows[0].id, String(source?.title || output?.title || '').slice(0, 500), source?.url || output?.url || null, String(source?.source || output?.source || '').slice(0, 200), JSON.stringify({ content: String(source?.content || output?.content || '').slice(0, 120000) })]);
  }
}

export async function createAgentThread({ user, threadId, title }) {
  return ensureThread(await getDb(), user, threadId, title);
}

export async function runAgent({ user, threadId, message, pageContext = {}, onEvent = () => {}, signal, accounting = { tokens: 0, modelCalls: 0 } }) {
  if (!user?.id) throw new Error('Sign in required');
  const db = await getDb();
  const thread = await ensureThread(db, user, threadId, typeof message === 'string' ? message.slice(0, 80) : 'AI 助手對話');
  const config = providerConfig();
  const run = await db.query('INSERT INTO agent_runs (thread_id,user_id,model,status) VALUES ($1,$2,$3,$4) RETURNING id', [thread.id,user.id,config.model,'running']);
  const runId = run.rows[0].id;
  const started = Date.now(); const limits = agentLimits();
  const deadline = started + limits.timeoutMs;
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, limits.timeoutMs);
  let research = { tools: [], close: async () => {} };
  const attempts = [];
  try {
    const currentMessage = inputMessage(message);
    const priorMessages = await history(db, thread.id);
    await saveMessage(db, thread.id, 'user', typeof currentMessage.content === 'string' ? [{ type: 'text', text: currentMessage.content }] : currentMessage.content);
    const question = typeof currentMessage.content === 'string' ? currentMessage.content : currentMessage.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const query = question;
    const [sources, graph] = await Promise.all([searchSiteKnowledge(query, { limit: 3, pageContext }), queryKnowledgeGraph(query, { limit: 5, pageContext })]);
    const context = { page_context: pageContext, reviewed_sources: sources.map((source) => ({ ...source, official_sources: source.official_sources.slice(0, 2) })), knowledge_graph: { matches: graph.matches.map(({ id, type, label }) => ({ id, type, label })), relations: graph.relations.slice(0, 8).map((edge) => ({ type: edge.type, from: edge.from?.id, to: edge.to?.id })), verified_at: graph.verified_at } };
    research = await getResearchTools({ signal: controller.signal });
    const tools = Object.fromEntries([
      ...Object.entries(applicationTools).map(([name, tool]) => [name, { ...tool, name }]),
      ...research.tools.map((tool) => [tool.name, tool]),
    ]);
    const wrapped = { role: 'user', content: [{ type: 'text', text: fenceUserContext(context) }, ...(typeof currentMessage.content === 'string' ? [{ type: 'text', text: currentMessage.content }] : currentMessage.content)] };
    const messages = [...priorMessages, wrapped];
    let toolCount = 0; let hasPersonalResults = false;
    const knownSources = new Map(sources.map((source) => [source.id, source]));
    let formatRepairUsed = false; let transportRetryUsed = false; let pendingTransportError = null;
    const usage = () => ({ total_tokens: accounting.tokens, model_calls: accounting.modelCalls, tool_calls: toolCount });
    for (let step = 0; step < limits.modelCalls; step += 1) {
      if (controller.signal.aborted) throw new AgentRuntimeError(signal?.aborted ? 'agent_cancelled' : 'agent_timeout', 'Agent request cancelled or timed out', { status: signal?.aborted ? 499 : 504 });
      let response;
      const attemptStarted = Date.now();
      try {
        response = normalizeDecisionResponse(await callMinimax({ messages, tools: { [DECISION_TOOL]: decisionTool(tools) }, system: policyPrompt(tools, { json: formatRepairUsed }), json: formatRepairUsed, timeoutMs: deadline - Date.now(), signal: controller.signal, accounting }));
      } catch (error) {
        attempts.push({ status: 'failed', code: error.code || 'agent_internal', elapsed_ms: Date.now() - attemptStarted, ...error.diagnostics });
        // A timeout with unknown usage retains its reservation. If that leaves
        // no safe retry budget, report the real transport failure, not blame a
        // short user question for exceeding the budget. No second fetch occurs.
        if (error.code === 'agent_request_budget' && pendingTransportError) throw pendingTransportError;
        const retryDelay = Math.max(0, Number(error.diagnostics?.retry_after || 0)) * 1000;
        if (!transportRetryUsed && error.retryable && !controller.signal.aborted && step + 1 < limits.modelCalls && deadline - Date.now() >= 3000 + retryDelay) {
          transportRetryUsed = true;
          pendingTransportError = error;
          await onEvent({ type: 'progress', message: 'AI 服務剛才連線不穩，正在重試一次…' });
          if (retryDelay) await delay(retryDelay, undefined, { signal: controller.signal });
          continue;
        }
        throw error;
      }
      pendingTransportError = null;
      let decision;
      try { decision = validateDecision(response, tools, { sources: [...knownSources.values()], hasPersonalResults }); }
      catch (error) {
        attempts.push({ status: 'invalid', elapsed_ms: Date.now() - attemptStarted, reason: error.message.slice(0, 300), stop_reason: response.raw?.stop_reason || response.raw?.choices?.[0]?.finish_reason || null, tool_calls: response.toolCalls?.length || 0, text_chars: response.text?.length || 0 });
        // A single bounded repair, not a second classifier on every request.
        // Do not append unmatched tool calls or execute unvalidated plans.
        if (formatRepairUsed || step + 1 >= limits.modelCalls || deadline - Date.now() < 3000) throw new AgentRuntimeError('agent_decision_invalid', error.message, { status: 502 });
        formatRepairUsed = true;
        await onEvent({ type: 'progress', message: '正在重新核對回覆格式，尚未執行任何未驗證操作…' });
        messages.push({ role: 'user', content: `伺服器格式檢查未通過：${error.message.slice(0, 300)}。沒有執行該回應的工具。改用完整 JSON 決策物件，填齊 decision、domain、reply、tool_name、tool_arguments；不得自由文字回答或呼叫 assistant_decision。知識不足用 insufficient_data，final 不可包含工具。` });
        continue;
      }
      attempts.push({ status: 'validated', format: response.decisionFormat || 'tool', elapsed_ms: Date.now() - attemptStarted });
      await db.query('UPDATE agent_runs SET scope_decision=$2,latency_ms=$3 WHERE id=$1', [runId, JSON.stringify(decision), Date.now() - started]);
      if (decision.decision !== 'tools') {
        const selected = decision.source_ids.map((id) => knownSources.get(id));
        if (selected.length) await onEvent({ type: 'tool_activity', tool_name: 'search_site_knowledge', status: 'completed', output: { ok: true, data: selected } });
        for (const key of decision.navigation) await onEvent({ type: 'tool_activity', tool_name: 'suggest_navigation', status: 'completed', output: { ok: true, data: resolveAssistantRoute(key) } });
        const text = decision.decision === 'reject' ? `${decision.reply}\n你可以問：「${decision.suggested_question}」` : decision.reply;
        await onEvent({ type: 'text', text });
        await saveMessage(db, thread.id, 'assistant', [{ type: 'text', text }]);
        await finishRun(db, runId, 'completed', { ...usage(), attempts });
        return { thread_id: thread.id, run_id: runId, status: 'completed', decision: decision.decision, text, model: response.model, usage: usage() };
      }
      if (toolCount + decision.calls.length > limits.toolCalls || step + 1 >= limits.modelCalls && !decision.calls.some((call) => tools[call.tool]?.write)) throw new AgentRuntimeError('agent_request_budget', 'Agent reached its tool or model limit', { status: 422 });
      if (response.provider === 'anthropic') messages.push({ role: 'assistant', content: response.content });
      else messages.push({ ...response.assistantMessage, role: 'assistant' });
      const write = decision.calls.find((call) => tools[call.tool].write);
      if (write) {
        if (controller.signal.aborted) throw new Error('Agent request cancelled');
        const callId = await toolRecord(db, runId, write.tool, write.args, 'awaiting_confirmation', null, null, true);
        const text = '請核對以下資料，確認後我才會寫入。';
        await saveMessage(db, thread.id, 'assistant', [{ type: 'text', text: `${text}\n${JSON.stringify(write.args)}` }]);
        await finishRun(db, runId, 'awaiting_confirmation', { ...usage(), attempts });
        await onEvent({ type: 'text', text });
        await onEvent({ type: 'confirmation_required', tool_call_id: callId, tool_name: write.tool, input: safePersist(write.args), message: text });
        return { thread_id: thread.id, run_id: runId, status: 'awaiting_confirmation', text, usage: usage(), confirmation: { tool_call_id: callId, tool_name: write.tool, input: safePersist(write.args) } };
      }
      const outputs = await Promise.all(decision.calls.map(async (call) => {
        if (controller.signal.aborted) throw new Error('Agent request cancelled');
        const tool = tools[call.tool];
        let output; let status = 'completed'; let error = null;
        try { output = await executeToolWithTimeout(tool, call.args, user, controller.signal, pageContext); } catch (e) { status = 'failed'; error = e.message; output = { ok: false, error: e.message }; }
        toolCount += 1;
        await toolRecord(db, runId, call.tool, call.args, status, output, error);
        if (status === 'completed' && call.tool.startsWith('research.')) await persistResearchResult(db, user, JSON.stringify(call.args), output);
        if (status === 'completed' && ['list_my_vehicles', 'get_vehicle_status', 'get_service_history', 'get_upcoming_reminders', 'get_recent_trips', 'get_user_preferences'].includes(call.tool)) hasPersonalResults = true;
        if (status === 'completed' && call.tool === 'search_site_knowledge') for (const source of output.data || []) knownSources.set(source.id, source);
        await audit({ actor: user, action: `agent.tool.${status}`, targetType: 'agent_tool', targetId: runId, payload: { tool_name: call.tool, input: safePersist(call.args), output: safePersist(output) } });
        // Navigation and citations appear only after a validated final decision.
        if (!['search_site_knowledge', 'suggest_navigation'].includes(call.tool)) await onEvent({ type: 'tool_activity', tool_name: call.tool, status, output: safePersist(output) });
        return { tool: call.tool, status, output: safePersist(output) };
      }));
      const boundedOutputs = outputs.map((output) => JSON.stringify(output).length > 10000 ? { tool: output.tool, status: output.status, output: { ok: output.output?.ok, truncated: true, message: 'Result exceeds the answer context budget; request a narrower query.' } } : output);
      const fencedOutput = fenceToolResult(boundedOutputs);
      const decisionCall = response.toolCalls[0];
      if (response.decisionFormat === 'json') messages.push({ role: 'user', content: fencedOutput });
      else if (response.provider === 'anthropic') messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: decisionCall.id, content: fencedOutput }] });
      else messages.push({ role: 'tool', tool_call_id: decisionCall.id, content: fencedOutput });
    }
    throw new AgentRuntimeError('agent_request_budget', 'Agent reached its step limit', { status: 422 });
  } catch (error) {
    if (controller.signal.aborted) error = new AgentRuntimeError(signal?.aborted ? 'agent_cancelled' : 'agent_timeout', error.message, { status: signal?.aborted ? 499 : 504 });
    error.runId = runId; error.threadId = thread.id;
    await db.query('UPDATE agent_runs SET latency_ms=$2 WHERE id=$1', [runId, Date.now() - started]);
    await finishRun(db, runId, 'failed', { total_tokens: accounting.tokens, model_calls: accounting.modelCalls, attempts, failure_code: error.code || 'agent_internal' }, error.message);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); await research.close().catch(() => {}); }
}

export async function confirmAgentTool({ user, threadId, toolCallId, approved, onEvent }) {
  const db = await getDb();
  const r = await db.query(`UPDATE agent_tool_calls tc SET status='running'
    FROM agent_runs ar JOIN agent_threads t ON t.id=ar.thread_id
    WHERE tc.run_id=ar.id AND tc.id=$1 AND t.id=$2 AND t.user_id=$3 AND tc.status='awaiting_confirmation'
    RETURNING tc.id,tc.tool_name,tc.input,tc.run_id`, [toolCallId,threadId,user.id]);
  if (!r.rowCount) throw new Error('Pending confirmation not found or already handled');
  const pending = r.rows[0]; const tool = applicationTools[pending.tool_name]; if (!tool?.write) throw new Error('Tool cannot be confirmed');
  if (!approved) {
    await db.query(`UPDATE agent_tool_calls SET status='failed',output=$2 WHERE id=$1`, [toolCallId, JSON.stringify({ ok: false, cancelled: true })]);
    await db.query("UPDATE agent_runs SET status='completed',completed_at=NOW() WHERE id=$1", [pending.run_id]);
    await onEvent?.({ type: 'cancelled', tool_name: pending.tool_name });
    return { thread_id: threadId, status: 'cancelled', text: '已取消，沒有修改任何資料。' };
  }
  let output;
  try { output = await executeToolWithTimeout(tool, pending.input, user); }
  catch (error) {
    await db.query(`UPDATE agent_tool_calls SET status='failed',error=$2 WHERE id=$1`, [toolCallId,error.message]);
    await db.query("UPDATE agent_runs SET status='failed',error=$2,completed_at=NOW() WHERE id=$1", [pending.run_id, error.message]);
    throw error;
  }
  await db.query(`UPDATE agent_tool_calls SET status='completed',output=$2,confirmed_at=NOW() WHERE id=$1`, [toolCallId, JSON.stringify(safePersist(output))]);
  await db.query("UPDATE agent_runs SET status='completed',completed_at=NOW() WHERE id=$1", [pending.run_id]);
  await audit({ actor: user, action: 'agent.write.confirmed', targetType: 'agent_tool', targetId: toolCallId, payload: { tool_name: pending.tool_name, input: safePersist(pending.input), output: safePersist(output) } });
  const text = '已按你確認的內容儲存資料。';
  await saveMessage(db, threadId, 'assistant', [{ type: 'text', text: `${text}\n${JSON.stringify(safePersist(output.data)).slice(0, 1500)}` }]);
  await onEvent?.({ type: 'text', text });
  return { thread_id: threadId, run_id: pending.run_id, status: 'completed', text, tool_result: safePersist(output), usage: { total_tokens: 0, model_calls: 0 } };
}
