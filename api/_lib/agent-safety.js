/* Agent safety wrappers.
   Two responsibilities:
   1. Fence user-controlled data before it lands inside the system prompt so
      it cannot be interpreted as instructions by the model.
   2. Track a per-user daily token budget so a single user cannot run the
      account dry. In-memory only (one Vercel instance); for production-wide
      enforcement, swap `usageToday` for Upstash Redis or KV. */

const USER_DATA_OPEN = '<<<USER_DATA_UNTRUSTED_BEGIN>>>';
const USER_DATA_CLOSE = '<<<USER_DATA_UNTRUSTED_END>>>';
const TOOL_RESULT_OPEN = '<<<TOOL_RESULT_UNTRUSTED_BEGIN>>>';
const TOOL_RESULT_CLOSE = '<<<TOOL_RESULT_UNTRUSTED_END>>>';

export function fenceUserContext(context) {
  // JSON.stringify + explicit delimiters — model must treat content inside
  // as data, never as instructions. The system prompt should reference these
  // markers and tell the model to ignore any "ignore previous instructions"
  // text inside.
  return `${USER_DATA_OPEN}\n${JSON.stringify(context)}\n${USER_DATA_CLOSE}`;
}

export function fenceToolResult(payload) {
  return `${TOOL_RESULT_OPEN}\n${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n${TOOL_RESULT_CLOSE}`;
}

export const SAFETY_DELIMITERS = {
  userData: { open: USER_DATA_OPEN, close: USER_DATA_CLOSE },
  toolResult: { open: TOOL_RESULT_OPEN, close: TOOL_RESULT_CLOSE },
};

/* Daily token budget. Defaults: 200_000 tokens per user per rolling 24h.
   The agent runtime calls `consumeDailyBudget(userId, tokens)` after each LLM
   step. When the budget is exceeded, the next call throws `BudgetExceeded`. */
const usageToday = new Map(); // userId -> { tokens, resetAt }
function dailyLimit() { return Number(process.env.AGENT_DAILY_TOKEN_LIMIT || 200_000); }

function resetIfStale(bucket, now) {
  if (now >= bucket.resetAt) {
    bucket.tokens = 0;
    bucket.resetAt = now + 24 * 60 * 60 * 1000;
  }
}

export class BudgetExceeded extends Error {
  constructor(userId, used, limit) {
    super(`Daily token budget exceeded for user ${userId} (${used}/${limit})`);
    this.code = 'agent_budget_exceeded';
    this.userId = userId;
    this.used = used;
    this.limit = limit;
  }
}

export function consumeDailyBudget(userId, tokens = 0) {
  const limit = dailyLimit();
  const now = Date.now();
  let bucket = usageToday.get(userId);
  if (!bucket) {
    bucket = { tokens: 0, resetAt: now + 24 * 60 * 60 * 1000 };
    usageToday.set(userId, bucket);
  }
  resetIfStale(bucket, now);
  if (bucket.tokens + tokens > limit) {
    throw new BudgetExceeded(userId, bucket.tokens, limit);
  }
  bucket.tokens += tokens;
  return { used: bucket.tokens, limit };
}

export function peekDailyBudget(userId) {
  const now = Date.now();
  const bucket = usageToday.get(userId);
  if (!bucket) return { used: 0, limit: dailyLimit() };
  resetIfStale(bucket, now);
  return { used: bucket.tokens, limit: dailyLimit() };
}

/* Test-only: clear the in-memory budget table. */
export function _resetAgentSafetyState() {
  usageToday.clear();
}