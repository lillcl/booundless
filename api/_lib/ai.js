const DEFAULT_TIMEOUT_MS = 15000;

export async function askAI({ system, user, temperature = 0.2, maxTokens = 700 }) {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error('AI_API_KEY is not configured');
  const base = String(process.env.AI_BASE_URL || 'https://api.minimax.io/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'MiniMax-M3';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ] }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `AI request failed (${response.status})`);
    return { text: payload?.choices?.[0]?.message?.content || '', model };
  } finally {
    clearTimeout(timer);
  }
}
