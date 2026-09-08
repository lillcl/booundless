/* Smoke-test the AI connection against MiniMax (anthropic-compatible).
   Reads AI_API_KEY + AI_BASE_URL from .env, fires one minimal messages
   request, and prints the model's first response. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

const API_KEY = process.env.AI_API_KEY;
const BASE_URL = (process.env.AI_BASE_URL || 'https://api.minimax.cn/anthropic')
  .replace(/\/+$/, '');
const MODEL = process.env.AI_MODEL || 'MiniMax-M3';

if (!API_KEY) {
  console.error('AI_API_KEY not set in .env');
  process.exit(1);
}

const body = {
  model: MODEL,
  max_tokens: 200,
  messages: [
    { role: 'user', content: 'Reply with exactly: PONG. Do not add anything else.' },
  ],
};

const t0 = Date.now();
let res;
try {
  res = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
} catch (e) {
  console.error('Network error:', e.message);
  process.exit(2);
}

const ms = Date.now() - t0;
const text = await res.text();
console.log(`HTTP ${res.status} in ${ms}ms`);
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }

if (!res.ok) {
  console.error('AI error body:', JSON.stringify(parsed, null, 2));
  process.exit(3);
}

const content = parsed?.content?.[0]?.text ?? '(no text)';
const usage = parsed?.usage ?? {};
const model = parsed?.model ?? MODEL;

console.log('---');
console.log('model:', model);
console.log('reply :', content);
console.log('usage :', JSON.stringify(usage));
console.log('---');
console.log('OK');
