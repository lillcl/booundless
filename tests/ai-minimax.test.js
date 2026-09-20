import test from 'node:test';
import assert from 'node:assert/strict';
import { askAI } from '../api/_lib/ai.js';

test('vision messages are sent directly to the MiniMax chat completions API', async () => {
  const originalFetch = global.fetch;
  const original = {
    key: process.env.AI_API_KEY,
    base: process.env.AI_BASE_URL,
    model: process.env.AI_VISION_MODEL,
  };
  let request;
  process.env.AI_API_KEY = 'test-only-key';
  process.env.AI_BASE_URL = 'https://api.minimax.io/v1';
  process.env.AI_VISION_MODEL = 'MiniMax-M3';
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      model: 'MiniMax-M3',
      choices: [{ message: { content: '{"model":"Corolla"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await askAI({
      system: 'Return JSON',
      user: [
        { type: 'text', text: 'Identify this vehicle' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } },
      ],
      model: process.env.AI_VISION_MODEL,
    });
    assert.equal(request.url, 'https://api.minimax.io/v1/chat/completions');
    assert.equal(request.options.headers.authorization, 'Bearer test-only-key');
    assert.equal(request.body.messages[1].content[1].type, 'image_url');
    assert.equal(request.body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AA==');
    assert.equal(result.provider, 'minimax');
  } finally {
    global.fetch = originalFetch;
    if (original.key === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = original.key;
    if (original.base === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = original.base;
    if (original.model === undefined) delete process.env.AI_VISION_MODEL; else process.env.AI_VISION_MODEL = original.model;
  }
});
