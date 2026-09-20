const DEFAULT_TIMEOUT_MS = 25000;

export async function askAI({ system, user, temperature = 0.2, maxTokens = 700, model: requestedModel = null }) {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error('AI_API_KEY is not configured');
  const base = String(process.env.AI_BASE_URL || 'https://api.minimax.io/v1').replace(/\/$/, '');
  const model = requestedModel || process.env.AI_MODEL || 'MiniMax-M3';
  const provider = (() => {
    try { return new URL(base).hostname.toLowerCase().includes('minimax') ? 'minimax' : 'custom'; }
    catch { return 'custom'; }
  })();
  const anthropic = /\/anthropic$/i.test(base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const messages = [{ role: 'user', content: anthropic ? toAnthropicContent(user) : user }];
    const response = await fetch(anthropic ? `${base}/v1/messages` : `${base}/chat/completions`, {
      method: 'POST',
      headers: anthropic
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
        : { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(anthropic
        ? { model, max_tokens: maxTokens, temperature, system, messages }
        : { model, temperature, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `AI request failed (${response.status})`);
    const text = anthropic
      ? (payload?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('')
      : payload?.choices?.[0]?.message?.content || '';
    return { text, model: payload?.model || model, provider, usage: payload?.usage || {} };
  } finally {
    clearTimeout(timer);
  }
}

function toAnthropicContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return String(value ?? '');
  return value.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text || '' };
    if (part.type === 'image_url') {
      const match = String(part.image_url?.url || '').match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
      if (!match) throw new Error('Images must be data URLs');
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    }
    return { type: 'text', text: String(part.text || part.content || '') };
  });
}
