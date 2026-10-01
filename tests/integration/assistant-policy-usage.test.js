import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import pg from 'pg';
import { applySchema, getDb, closeDb } from '../../api/_lib/db.js';
import { admitAgentRequest, finishAgentRequest, getAgentQuota, requestFingerprint, agentLimits } from '../../api/_lib/agent-usage.js';
import { runAgent, confirmAgentTool } from '../../api/_lib/agent.js';
import { createAgentHandler } from '../../api/agent.js';

const url = process.env.TEST_DATABASE_URL;
const saved = (() => { try { return parse(readFileSync(new URL('../../.env', import.meta.url))); } catch { return {}; } })();
if (url && [saved.SUPABASE_DB_URL, saved.DIRECT_URL].includes(url)) throw new Error('Integration tests refuse the app database');
let db; let other;
const users = [];
before(async () => {
  if (!url) return;
  process.env.NODE_ENV = 'test'; process.env.SUPABASE_DB_URL = url; process.env.KC_AUTO_MIGRATE = '0';
  const setup = new pg.Pool({ connectionString: url });
  await setup.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$");
  await applySchema(setup);
  await setup.end();
  db = await getDb(); other = new pg.Pool({ connectionString: url, max: 2 });
});
after(async () => { await other?.end(); await closeDb(); });
async function user(role = 'user') {
  const id = `u-agent-test-${randomUUID()}`;
  await db.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,'test-only',$3)", [id, `${id}@example.test`, role]);
  users.push(id); return { id, email: `${id}@example.test` };
}
const options = (userId, overrides = {}) => ({ userId, requestId: randomUUID(), fingerprint: requestFingerprint({ message: 'test' }), ...overrides });
async function complete(opt, tokens = 20) { await finishAgentRequest(db, { ...opt, tokens, response: { result: { text: 'done' } } }); }
const integration = (name, fn) => test(name, { skip: !url }, fn);

integration('five questions persist across pools, rejection also counts, sixth is blocked', async () => {
  const u = await user();
  for (let i = 1; i <= 5; i++) {
    const opt = options(u.id);
    const result = await admitAgentRequest(i % 2 ? db : other, opt);
    assert.equal(result.quota.remaining, 5 - i);
    await complete(opt);
  }
  await assert.rejects(admitAgentRequest(other, options(u.id)), { code: 'daily_question_limit', status: 429 });
  assert.equal((await getAgentQuota(other, u.id)).remaining, 0);
});

integration('admin accounts have no question or per-user daily-token limit', async () => {
  const u = await user('admin');
  for (let i = 1; i <= 7; i++) {
    const opt = options(u.id);
    const result = await admitAgentRequest(db, opt);
    assert.equal(result.quota.unlimited, true);
    await complete(opt, 50000);
  }
  const quota = await getAgentQuota(db, u.id);
  assert.equal(quota.unlimited, true);
  assert.equal(quota.remaining, null);
  assert.equal(quota.used, 7);
});

integration('replay does not charge again even after all five questions are consumed', async () => {
  const u = await user(); const first = options(u.id);
  await admitAgentRequest(db, first); await complete(first);
  for (let i = 0; i < 4; i++) { const opt = options(u.id); await admitAgentRequest(db, opt); await complete(opt); }
  const replay = await admitAgentRequest(other, first);
  assert.equal(replay.replay.result.text, 'done'); assert.equal(replay.quota.used, 5);
  await assert.rejects(admitAgentRequest(other, { ...first, fingerprint: 'different' }), { code: 'request_conflict' });
});

integration('concurrent requests cannot spend the last remaining question twice', async () => {
  const u = await user();
  await db.query("INSERT INTO app_private.agent_usage_days(usage_key,usage_day,questions) VALUES($1,(NOW() AT TIME ZONE 'Asia/Macau')::date,4)", [`user:${u.id}`]);
  const requests = Array.from({ length: 6 }, () => options(u.id));
  const outcomes = await Promise.allSettled(requests.map((opt, i) => admitAgentRequest(i % 2 ? other : db, opt)));
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  await complete(requests[outcomes.findIndex((r) => r.status === 'fulfilled')]);
  assert.equal((await getAgentQuota(db, u.id)).used, 5);
});

integration('confirmations can proceed at zero remaining questions without AI or another charge', async () => {
  const u = await user();
  await db.query("INSERT INTO app_private.agent_usage_days(usage_key,usage_day,questions) VALUES($1,(NOW() AT TIME ZONE 'Asia/Macau')::date,5)", [`user:${u.id}`]);
  const opt = options(u.id, { confirmation: true });
  assert.equal((await admitAgentRequest(db, opt)).reservation, 0);
  await complete(opt, 0);
  assert.equal((await getAgentQuota(db, u.id)).used, 5);
});

integration('quota reset follows Macau midnight, not UTC midnight', async () => {
  const u = await user();
  await db.query("INSERT INTO app_private.agent_usage_days(usage_key,usage_day,questions) VALUES($1,(NOW() AT TIME ZONE 'Asia/Macau')::date-1,5)", [`user:${u.id}`]);
  const quota = await getAgentQuota(db, u.id);
  assert.equal(quota.remaining, 5);
  const reset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Macau', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(quota.resets_at));
  assert.equal(reset, '00:00');
});

integration('token budget is reserved before work and settled using actual usage', async () => {
  const u = await user(); const opt = options(u.id);
  await admitAgentRequest(db, opt);
  let row = (await db.query("SELECT * FROM app_private.agent_usage_days WHERE usage_key=$1 AND usage_day=(NOW() AT TIME ZONE 'Asia/Macau')::date", [`user:${u.id}`])).rows[0];
  assert.equal(Number(row.tokens_reserved), agentLimits().requestTokens);
  await complete(opt, 123);
  row = (await db.query("SELECT * FROM app_private.agent_usage_days WHERE usage_key=$1 AND usage_day=(NOW() AT TIME ZONE 'Asia/Macau')::date", [`user:${u.id}`])).rows[0];
  assert.equal(Number(row.tokens_reserved), 0); assert.equal(Number(row.tokens_used), 123);
  await db.query("UPDATE app_private.agent_usage_days SET tokens_used=$2 WHERE usage_key=$1", [`user:${u.id}`, agentLimits().dailyTokens]);
  await assert.rejects(admitAgentRequest(db, options(u.id)), { code: 'agent_budget_exceeded' });
  assert.equal((await getAgentQuota(db, u.id)).used, 1);
});

integration('expired requests retain a conservative budget charge and replay as failed', async () => {
  const u = await user(); const opt = options(u.id);
  await admitAgentRequest(db, opt);
  await db.query("UPDATE app_private.agent_requests SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [u.id]);
  const replay = await admitAgentRequest(other, opt);
  assert.equal(replay.replay.error.code, 'request_expired');
  const row = (await db.query('SELECT tokens_used,tokens_reserved FROM app_private.agent_usage_days WHERE usage_key=$1', [`user:${u.id}`])).rows[0];
  assert.equal(Number(row.tokens_used), agentLimits().requestTokens); assert.equal(Number(row.tokens_reserved), 0);
});

function mockedModel(decisions) {
  let count = 0;
  return { get count() { return count; }, fetch: async (_url, opts) => {
    const body = JSON.parse(opts.body); const d = decisions[count++];
    assert.equal(body.tool_choice.name, 'assistant_decision');
    if (count > 1) {
      if (typeof body.messages.at(-1).content === 'string') {
        assert.match(body.messages.at(-1).content, /伺服器格式檢查未通過/);
        assert.equal(body.messages.some((message) => message.role === 'assistant'), false);
      } else {
        const previous = body.messages.at(-1).content[0];
        assert.equal(previous.type, 'tool_result'); assert.equal(previous.tool_use_id, `call-${count - 1}`);
      }
    }
    return new Response(JSON.stringify({ model: 'test', content: [{ type: 'tool_use', id: `call-${count}`, name: 'assistant_decision', input: d }], usage: { input_tokens: 30, output_tokens: 10 } }), { status: 200 });
  } };
}
const d = (overrides = {}) => ({ decision: 'answer', domain: 'website', reason: '網站導覽', reply: '可以到我的車輛頁面。', suggested_question: '', source_ids: [], navigation: [], calls: [], ...overrides });
async function withModel(decisions, fn) {
  const previous = { fetch: global.fetch, key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL, mcp: process.env.RESEARCH_MCP_URL };
  const mock = mockedModel(decisions); global.fetch = mock.fetch; process.env.AI_API_KEY = 'test'; process.env.AI_BASE_URL = 'https://api.minimax.io/anthropic'; delete process.env.RESEARCH_MCP_URL;
  try { await fn(mock); }
  finally { global.fetch = previous.fetch; for (const [key, env] of [['key','AI_API_KEY'],['base','AI_BASE_URL'],['mcp','RESEARCH_MCP_URL']]) { if (previous[key] === undefined) delete process.env[env]; else process.env[env] = previous[key]; } }
}

integration('semantic rejection uses one model call and emits no source, navigation or business tool', async () => {
  const u = await user(); const events = [];
  await withModel([d({ decision: 'reject', domain: 'none', reply: '這個問題超出服務範圍。', suggested_question: '橫琴有咩玩？' })], async (mock) => {
    const result = await runAgent({ user: u, message: '非洲有幾大？', onEvent: (event) => events.push(event) });
    assert.equal(result.decision, 'reject'); assert.equal(mock.count, 1); assert.equal(result.usage.total_tokens, 40);
    assert.equal(events.some((event) => event.type === 'tool_activity'), false);
    assert.match(result.text, /你可以問/);
  });
});

integration('one bounded format repair cannot execute a malformed or rejected write plan', async () => {
  const u = await user();
  await withModel([d({ decision: 'reject', domain: 'none', reply: '離題', suggested_question: '點樣新增車輛？', calls: [{ tool: 'add_vehicle', args: { model: 'Must Not Exist' } }] }), d({ decision: 'reject', domain: 'none', reply: '離題', suggested_question: '點樣新增車輛？' })], async (mock) => {
    const result = await runAgent({ user: u, message: '無關問題' });
    assert.equal(result.decision, 'reject'); assert.equal(mock.count, 2);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM agent_tool_calls WHERE run_id=$1', [result.run_id])).rows[0].n, 0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM vehicles WHERE created_by_user_id=$1', [u.id])).rows[0].n, 0);
  });
  await withModel([{}, {}, d()], async (mock) => {
    await assert.rejects(runAgent({ user: u, message: '網站問題' }));
    assert.equal(mock.count, 2);
  });
});

integration('browser database roles cannot access quota or idempotency tables', async () => {
  for (const role of ['anon', 'authenticated']) {
    const result = await db.query("SELECT has_schema_privilege($1,'app_private','USAGE') AS schema_access, has_table_privilege($1,'app_private.agent_usage_days','SELECT') AS quota_access, has_table_privilege($1,'app_private.agent_requests','SELECT') AS receipt_access", [role]);
    assert.deepEqual(result.rows[0], { schema_access: false, quota_access: false, receipt_access: false });
  }
});

integration('personal read executes under scope gate and excludes legacy/unowned vehicles', async () => {
  const u = await user();
  await db.query("INSERT INTO vehicles(id,model,created_by_user_id) VALUES($1,'Mine',$2),($3,'Not Mine',NULL)", [randomUUID(), u.id, randomUUID()]);
  await withModel([d({ decision: 'tools', domain: 'vehicles', reply: '', calls: [{ tool: 'list_my_vehicles', args: {} }] }), d({ domain: 'vehicles', reply: '你有 1 架車：Mine。' })], async (mock) => {
    const result = await runAgent({ user: u, message: '我有幾架車？' });
    assert.equal(mock.count, 2); assert.equal(result.usage.total_tokens, 80);
    const calls = await db.query('SELECT output FROM agent_tool_calls WHERE run_id=$1', [result.run_id]);
    assert.equal(calls.rows[0].output.data.length, 1); assert.equal(calls.rows[0].output.data[0].model, 'Mine');
  });
});

integration('write waits for confirmation and concurrent approvals execute it exactly once', async () => {
  const u = await user(); let pending;
  await withModel([d({ decision: 'tools', reply: '', calls: [{ tool: 'create_support_ticket', args: { subject: 'test', message: 'test' } }] })], async () => {
    pending = await runAgent({ user: u, message: '建立支援請求' });
    assert.equal(pending.status, 'awaiting_confirmation');
    assert.equal((await db.query('SELECT id FROM support_tickets WHERE user_id=$1', [u.id])).rowCount, 0);
  });
  const args = { user: u, threadId: pending.thread_id, toolCallId: pending.confirmation.tool_call_id, approved: true };
  const approvals = await Promise.allSettled([confirmAgentTool(args), confirmAgentTool(args)]);
  assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await db.query('SELECT id FROM support_tickets WHERE user_id=$1', [u.id])).rowCount, 1);
  assert.equal(approvals.find((r) => r.status === 'fulfilled').value.usage.model_calls, 0);
});

integration('HTTP sixth question is rejected before the model; completed requests replay', async () => {
  const u = await user(); let calls = 0;
  const handler = createAgentHandler({ readSession: async () => u, runAgent: async () => { calls++; return { text: '界仔回覆', status: 'completed' }; } });
  async function request(requestId) {
    let payload; const headers = {};
    const res = { setHeader(k,v) { headers[k] = v; }, end(value) { payload = JSON.parse(value); } };
    await handler({ method: 'POST', headers: {}, body: { request_id: requestId, stream: false, message: '網站問題' } }, res);
    return { status: res.statusCode, payload, headers };
  }
  const first = randomUUID(); assert.equal((await request(first)).status, 200);
  assert.equal((await request(first)).payload.quota.used, 1);
  for (let i = 0; i < 4; i++) assert.equal((await request(randomUUID())).status, 200);
  const denied = await request(randomUUID());
  assert.equal(denied.status, 429); assert.equal(denied.payload.error.code, 'daily_question_limit');
  assert.ok(Number(denied.headers['Retry-After']) > 0); assert.equal(calls, 5);
});
