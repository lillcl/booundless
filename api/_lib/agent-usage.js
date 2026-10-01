import { createHash } from 'node:crypto';

export const DAILY_QUESTION_LIMIT = 5;
const GLOBAL_KEY = 'global';
const USAGE_LOCK = 42420261001;

function boundedEnv(name, fallback, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(maximum, Math.floor(value)) : fallback;
}

export function agentLimits() {
  return {
    modelCalls: boundedEnv('AGENT_MAX_STEPS', 3, 3),
    toolCalls: boundedEnv('AGENT_MAX_TOOL_CALLS', 6, 6),
    outputTokens: boundedEnv('AI_MAX_TOKENS', 1024, 1024),
    requestTokens: boundedEnv('AGENT_REQUEST_TOKEN_LIMIT', 40000, 40000),
    dailyTokens: boundedEnv('AGENT_DAILY_TOKEN_LIMIT', 200000, 200000),
    globalTokens: boundedEnv('AGENT_GLOBAL_DAILY_TOKEN_LIMIT', 2000000, 2000000),
    globalConcurrency: boundedEnv('AGENT_GLOBAL_CONCURRENCY', 8, 8),
    // Leaves room for one format/transport recovery under the existing 40s lease.
    timeoutMs: boundedEnv('AGENT_TIMEOUT_MS', 30000, 30000),
  };
}

export class AgentUsageError extends Error {
  constructor(code, message, status = 429, retryAfter = 1, quota = null) {
    super(message);
    Object.assign(this, { code, status, retryAfter, quota });
  }
}

export function requestFingerprint(value) {
  // Stable object order makes retries independent of JSON key ordering.
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, sort(v[key])])) : v;
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function quotaFor(row, unlimited = false) {
  return { limit: unlimited ? null : DAILY_QUESTION_LIMIT, used: Number(row.questions || 0), remaining: unlimited ? null : Math.max(0, DAILY_QUESTION_LIMIT - Number(row.questions || 0)), unlimited, resets_at: new Date(row.resets_at).toISOString(), timezone: 'Asia/Macau' };
}

export async function getAgentQuota(db, userId) {
  const result = await db.query(`SELECT COALESCE(u.questions,0) AS questions, COALESCE(users.role='admin',false) AS unlimited,
    (((NOW() AT TIME ZONE 'Asia/Macau')::date + 1)::timestamp AT TIME ZONE 'Asia/Macau') AS resets_at
    FROM users LEFT JOIN app_private.agent_usage_days u
      ON u.usage_key=$1 AND u.usage_day=(NOW() AT TIME ZONE 'Asia/Macau')::date WHERE users.id=$2`, [`user:${userId}`, userId]);
  return quotaFor(result.rows[0] || {}, Boolean(result.rows[0]?.unlimited));
}

async function transaction(db, operation) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2s'");
    // Admission and settlement serialize across processes, not just this server.
    await client.query('SELECT pg_advisory_xact_lock($1)', [USAGE_LOCK]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function recoverExpired(client) {
  const expired = await client.query(`UPDATE app_private.agent_requests SET status='failed',completed_at=NOW(),
    response='{"error":{"code":"request_expired","message":"上次請求未能完成，請重新提問。"}}'::jsonb
    WHERE status='processing' AND lease_expires_at <= NOW() RETURNING user_id,usage_day,reserved_tokens`);
  for (const row of expired.rows) {
    // A crashed process may have reached the provider. Charge its reservation
    // conservatively instead of refunding potentially consumed model usage.
    await client.query(`UPDATE app_private.agent_usage_days SET tokens_reserved=tokens_reserved-$3,
      tokens_used=tokens_used+$3 WHERE usage_day=$1 AND usage_key=ANY($2::text[])`, [row.usage_day, [GLOBAL_KEY, `user:${row.user_id}`], row.reserved_tokens]);
  }
}

export async function admitAgentRequest(db, { userId, requestId, fingerprint, confirmation = false }) {
  const limits = agentLimits();
  return transaction(db, async (client) => {
    await recoverExpired(client);
    const identity = await client.query('SELECT role FROM users WHERE id=$1 AND is_active=true', [userId]);
    const isAdmin = identity.rows[0]?.role === 'admin';
    if (!identity.rowCount) throw new AgentUsageError('unauthorized', '登入狀態已失效，請重新登入。', 401);
    const previous = await client.query('SELECT fingerprint,status,response FROM app_private.agent_requests WHERE user_id=$1 AND request_id=$2', [userId, requestId]);
    const prior = previous.rows[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new AgentUsageError('request_conflict', '這個請求編號已用於另一個操作。', 409);
      if (prior.status === 'processing') throw new AgentUsageError('request_in_progress', '界仔正在處理這個問題，請稍候。', 409);
      return { replay: prior.response, quota: await getAgentQuota(client, userId) };
    }
    const active = await client.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE user_id=$1)::int AS mine,
      EXTRACT(EPOCH FROM MIN(lease_expires_at)-NOW()) AS wait_seconds
      FROM app_private.agent_requests WHERE status='processing'`, [userId]);
    if (active.rows[0].mine > 0 || active.rows[0].total >= limits.globalConcurrency) {
      throw new AgentUsageError('agent_busy', '界仔正在處理問題，請稍後再試。', 429, Math.max(1, Math.ceil(Number(active.rows[0].wait_seconds) || 1)));
    }
    const key = `user:${userId}`;
    await client.query(`INSERT INTO app_private.agent_usage_days(usage_key,usage_day)
      SELECT key,(NOW() AT TIME ZONE 'Asia/Macau')::date FROM UNNEST($1::text[]) key ON CONFLICT DO NOTHING`, [[GLOBAL_KEY, key]]);
    const rows = await client.query(`SELECT usage_key,questions,tokens_used,tokens_reserved,
      (((usage_day+1)::timestamp) AT TIME ZONE 'Asia/Macau') AS resets_at
      FROM app_private.agent_usage_days WHERE usage_key=ANY($1::text[]) AND usage_day=(NOW() AT TIME ZONE 'Asia/Macau')::date`, [[GLOBAL_KEY, key]]);
    const mine = rows.rows.find((row) => row.usage_key === key);
    const global = rows.rows.find((row) => row.usage_key === GLOBAL_KEY);
    const quota = quotaFor(mine);
    const resetWait = Math.max(1, Math.ceil((Date.parse(quota.resets_at) - Date.now()) / 1000));
    if (!confirmation && !isAdmin && mine.questions >= DAILY_QUESTION_LIMIT) throw new AgentUsageError('daily_question_limit', '今日 5 次 AI 提問已用完，澳門時間凌晨 00:00 後可再使用。', 429, resetWait, quota);
    const reservation = confirmation ? 0 : limits.requestTokens;
    if (reservation && ((!isAdmin && Number(mine.tokens_used) + Number(mine.tokens_reserved) + reservation > limits.dailyTokens)
      || Number(global.tokens_used) + Number(global.tokens_reserved) + reservation > limits.globalTokens)) {
      throw new AgentUsageError('agent_budget_exceeded', '今日 AI 用量已達上限，請明日再試。', 429, resetWait, quota);
    }
    await client.query(`UPDATE app_private.agent_usage_days SET questions=questions+$2,tokens_reserved=tokens_reserved+$3
      WHERE usage_key=ANY($1::text[]) AND usage_day=(NOW() AT TIME ZONE 'Asia/Macau')::date`, [[GLOBAL_KEY, key], confirmation ? 0 : 1, reservation]);
    await client.query(`INSERT INTO app_private.agent_requests(user_id,request_id,fingerprint,kind,usage_day,reserved_tokens,lease_expires_at)
      VALUES($1,$2,$3,$4,(NOW() AT TIME ZONE 'Asia/Macau')::date,$5,NOW()+INTERVAL '40 seconds')`, [userId, requestId, fingerprint, confirmation ? 'confirmation' : 'question', reservation]);
    return { quota: await getAgentQuota(client, userId), reservation };
  });
}

export async function finishAgentRequest(db, { userId, requestId, tokens, response, failed = false }) {
  return transaction(db, async (client) => {
    const result = await client.query(`UPDATE app_private.agent_requests SET status=$3,response=$4,completed_at=NOW()
      WHERE user_id=$1 AND request_id=$2 AND status='processing' RETURNING usage_day,reserved_tokens`, [userId, requestId, failed ? 'failed' : 'completed', JSON.stringify(response)]);
    if (!result.rowCount) return;
    const row = result.rows[0];
    await client.query(`UPDATE app_private.agent_usage_days SET tokens_reserved=tokens_reserved-$3,tokens_used=tokens_used+$4
      WHERE usage_day=$1 AND usage_key=ANY($2::text[])`, [row.usage_day, [GLOBAL_KEY, `user:${userId}`], row.reserved_tokens, Math.max(0, Math.ceil(tokens || 0))]);
  });
}

export function usageTokens(usage) {
  return Number(usage?.total_tokens) || Number(usage?.prompt_tokens || usage?.input_tokens || 0) + Number(usage?.completion_tokens || usage?.output_tokens || 0);
}

export function estimateInputTokens(body) {
  let images = 0;
  const json = JSON.stringify(body, (_key, value) => {
    if (typeof value === 'string' && value.startsWith('data:image/')) { images += 1; return '[image]'; }
    return value;
  });
  // UTF-8 bytes are a conservative text-token bound. No additional model call.
  return Buffer.byteLength(json, 'utf8') + 512 + images * 16000;
}
