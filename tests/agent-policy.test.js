import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionTool, validateDecision } from '../api/_lib/agent-policy.js';
import { createAgentHandler } from '../api/agent.js';
import { callMinimax, toAnthropicContent } from '../api/_lib/agent.js';
import { agentLimits, requestFingerprint, usageTokens } from '../api/_lib/agent-usage.js';

const tools = {
  read: { input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  write: { write: true, input_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } }, additionalProperties: false } },
};
const decision = (overrides = {}) => ({ decision: 'answer', domain: 'website', reason: '網站功能', reply: '可以使用我的車輛頁面。', suggested_question: '', source_ids: [], navigation: [], calls: [], ...overrides });
const response = (args) => ({ toolCalls: [{ id: 'call-test', name: 'assistant_decision', args }] });

test('omitted unused fields normalize safely without inventing decisions or actions', () => {
  const value = validateDecision(response({ decision: 'tools', domain: 'vehicles', reason: '讀取車輛', calls: [{ tool: 'read', args: {} }] }), tools);
  assert.equal(value.reply, '');
  assert.deepEqual(value.navigation, []);
  assert.throws(() => validateDecision(response({}), tools));
  assert.throws(() => validateDecision(response({ decision: 'reject', domain: 'none', reason: '離題', reply: '不能回答' }), tools));
  const noReason = { ...decision(), reason: undefined };
  delete noReason.reason;
  assert.equal(validateDecision(response(noReason), tools).reason, 'AI 已完成範圍判斷。');
});

test('scope gate rejects raw answers and direct business calls before execution', () => {
  assert.throws(() => validateDecision({ text: 'Unvalidated answer', toolCalls: [] }, tools));
  assert.throws(() => validateDecision({ toolCalls: [{ name: 'write', args: { title: 'bad' } }] }, tools));
});

test('rejection cannot contain business actions, citations or navigation', () => {
  const reject = decision({ decision: 'reject', domain: 'none', reply: '這個問題超出服務範圍。', suggested_question: '澳車北上要準備咩文件？' });
  assert.equal(validateDecision(response(reject), tools).decision, 'reject');
  for (const overrides of [{ calls: [{ tool: 'read', args: {} }] }, { navigation: ['home'] }, { source_ids: ['qinao.compare'] }, { suggested_question: '' }]) {
    assert.throws(() => validateDecision(response({ ...reject, ...overrides }), tools));
  }
});

test('tool plans validate parameters and cannot bundle writes with other actions', () => {
  const plan = decision({ decision: 'tools', reply: '', calls: [{ tool: 'write', args: { title: 'test' } }] });
  assert.equal(validateDecision(response(plan), tools).calls.length, 1);
  assert.throws(() => validateDecision(response({ ...plan, calls: [...plan.calls, { tool: 'read', args: {} }] }), tools));
  assert.throws(() => validateDecision(response({ ...plan, calls: [{ tool: 'write', args: {} }] }), tools));
  assert.throws(() => validateDecision(response({ ...plan, calls: [{ tool: 'unregistered', args: {} }] }), tools));
});

test('omitted tool arguments normalize only when the registered schema permits an empty object', () => {
  const plan = decision({ decision: 'tools', reply: '', calls: [{ tool: 'read' }] });
  assert.deepEqual(validateDecision(response(plan), tools).calls[0].args, {});
  assert.throws(() => validateDecision(response({ ...plan, calls: [{ tool: 'write' }] }), tools));
});

test('personal answers need authorized results; knowledge citations must exist', () => {
  assert.throws(() => validateDecision(response(decision({ domain: 'vehicles' })), tools));
  assert.equal(validateDecision(response(decision({ domain: 'vehicles' })), tools, { hasPersonalResults: true }).domain, 'vehicles');
  assert.throws(() => validateDecision(response(decision({ domain: 'qinao' })), tools));
  const sourced = decision({ domain: 'qinao', source_ids: ['qinao.compare'] });
  assert.throws(() => validateDecision(response(sourced), tools));
  assert.equal(validateDecision(response(sourced), tools, { sources: [{ id: 'qinao.compare' }] }).decision, 'answer');
});

test('anonymous requests stop before DB, model, quota or tools', async () => {
  let called = false;
  const handler = createAgentHandler({ readSession: async () => null, getDb: async () => { called = true; throw new Error('must not execute'); } });
  let payload;
  const res = { setHeader() {}, end(value) { payload = JSON.parse(value); } };
  await handler({ method: 'POST', headers: {}, body: { message: 'hello' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(payload.error.code, 'unauthorized');
  assert.equal(called, false);
});

test('idempotency fingerprints ignore key order but preserve intent', () => {
  assert.equal(requestFingerprint({ a: 1, b: { c: 2 } }), requestFingerprint({ b: { c: 2 }, a: 1 }));
  assert.notEqual(requestFingerprint({ message: 'one' }), requestFingerprint({ message: 'two' }));
});

test('both provider usage formats count each call independently', () => {
  assert.equal(usageTokens({ input_tokens: 100, output_tokens: 20 }), 120);
  assert.equal(usageTokens({ prompt_tokens: 100, completion_tokens: 20 }), 120);
  assert.equal(usageTokens({ total_tokens: 120 }), 120);
});

test('configured limits cannot raise the hard per-request caps', () => {
  const previous = process.env.AGENT_MAX_STEPS;
  process.env.AGENT_MAX_STEPS = '100';
  try { assert.equal(agentLimits().modelCalls, 3); }
  finally { if (previous === undefined) delete process.env.AGENT_MAX_STEPS; else process.env.AGENT_MAX_STEPS = previous; }
});

test('forced decision works on both protocols without an extra classifier call', async () => {
  const previous = { fetch: global.fetch, key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL };
  process.env.AI_API_KEY = 'test-key';
  try {
    for (const anthropic of [true, false]) {
      process.env.AI_BASE_URL = anthropic ? 'https://api.minimax.io/anthropic' : 'https://api.minimax.io/v1';
      let called = 0;
      global.fetch = async (_url, options) => {
        called += 1;
        const body = JSON.parse(options.body);
        assert.equal(anthropic ? body.tool_choice.name : body.tool_choice.function.name, 'assistant_decision');
        return new Response(JSON.stringify(anthropic
          ? { content: [{ type: 'tool_use', id: 'call-test', name: 'assistant_decision', input: decision() }], usage: { input_tokens: 10, output_tokens: 5 } }
          : { choices: [{ message: { tool_calls: [{ type: 'function', id: 'call-test', function: { name: 'assistant_decision', arguments: JSON.stringify(decision()) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
      };
      const accounting = { tokens: 0, modelCalls: 0 };
      const result = await callMinimax({ messages: [{ role: 'user', content: 'test' }], system: 'test', tools: { assistant_decision: decisionTool(tools) }, accounting });
      assert.equal(result.toolCalls[0].name, 'assistant_decision');
      assert.equal(called, 1);
      assert.equal(accounting.tokens, 15);
      assert.equal(accounting.modelCalls, 1);
    }
  } finally {
    global.fetch = previous.fetch;
    for (const name of ['key', 'base']) { const env = name === 'key' ? 'AI_API_KEY' : 'AI_BASE_URL'; if (previous[name] === undefined) delete process.env[env]; else process.env[env] = previous[name]; }
  }
});

test('Anthropic continuation preserves reasoning and tool identifiers unchanged', () => {
  const parts = [{ type: 'thinking', thinking: 'opaque', signature: 'signature' }, { type: 'redacted_thinking', data: 'opaque' }, { type: 'tool_use', name: 'assistant_decision', id: 'call-scope', input: {} }];
  assert.deepEqual(toAnthropicContent(parts), parts);
});

test('flat wire plans validate JSON and registered arguments before any action', () => {
  const flat = { decision: 'tools', domain: 'vehicles', reply: '', tool_name: 'read', tool_arguments: '{}' };
  assert.deepEqual(validateDecision(response(flat), tools).calls, [{ tool: 'read', args: {} }]);
  for (const invalid of [{ tool_arguments: 'null' }, { tool_arguments: '[]' }, { tool_arguments: '{bad}' }, { tool_name: 'write' }, { decision: 'reject', domain: 'none', reply: '離題', suggested_question: '點樣新增車輛？' }]) assert.throws(() => validateDecision(response({ ...flat, ...invalid }), tools));
  assert.equal(validateDecision(response({ ...flat, decision: 'answer', domain: 'website', reply: '開啟我的車輛。', tool_name: '' }), tools).calls.length, 0);
  const plan = validateDecision(response({ ...flat, reply: 'Unrendered explanation', source_ids: ['not-a-source'], navigation: ['not-a-route'] }), tools);
  assert.equal(plan.reply, ''); assert.deepEqual(plan.source_ids, []); assert.deepEqual(plan.navigation, []);
  assert.throws(() => validateDecision(response({ ...flat, domain: 'none', reply: 'Unrendered explanation' }), tools));
});

test('internal context text is not truncated into invalid JSON at 4000 characters', () => {
  const text = JSON.stringify({ sources: ['資料'.repeat(3000)], end: 'USER_DATA_UNTRUSTED_END' });
  assert.equal(toAnthropicContent([{ type: 'text', text }])[0].text, text);
});

test('a related missing-data response can safely link to reviewed sources and routes', () => {
  const value = decision({ decision: 'insufficient_data', domain: 'maintenance', source_ids: ['known'], navigation: ['service'] });
  assert.equal(validateDecision(response(value), tools, { sources: [{ id: 'known' }] }).decision, 'insufficient_data');
  assert.throws(() => validateDecision(response(value), tools));
});

test('website feature descriptions cannot ground physical repair advice', () => {
  const value = decision({ domain: 'maintenance', source_ids: ['website.services'] });
  const sources = [{ id: 'website.services', kind: 'website_function' }];
  const guarded = validateDecision(response(value), tools, { sources });
  assert.equal(guarded.decision, 'insufficient_data');
  assert.match(guarded.reply, /未提供可靠/);
  assert.equal(guarded.reply.includes(value.reply), false);
  assert.equal(validateDecision(response({ ...value, decision: 'insufficient_data' }), tools, { sources }).decision, 'insufficient_data');
});

test('OpenAI continuation retains opaque reasoning and the original tool id', async () => {
  const previous = { fetch: global.fetch, key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL };
  process.env.AI_API_KEY = 'test'; process.env.AI_BASE_URL = 'https://api.minimax.io/v1';
  const assistant = { role: 'assistant', content: null, reasoning_content: 'opaque', tool_calls: [{ id: 'original-id', type: 'function', function: { name: 'assistant_decision', arguments: '{}' } }] };
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages[1], assistant);
    assert.equal(body.messages[2].tool_call_id, 'original-id');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { total_tokens: 10 } }), { status: 200 });
  };
  try { await callMinimax({ system: 'test', messages: [assistant, { role: 'tool', tool_call_id: 'original-id', content: '{}' }], tools: { assistant_decision: decisionTool(tools) } }); }
  finally {
    global.fetch = previous.fetch;
    for (const [name, env] of [['key', 'AI_API_KEY'], ['base', 'AI_BASE_URL']]) { if (previous[name] === undefined) delete process.env[env]; else process.env[env] = previous[name]; }
  }
});
