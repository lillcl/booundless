/* Sends one supplied vehicle photo through the same vision prompt and
   normalization used by /api/ai. Does not create or edit a vehicle. */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { config as loadDotenv } from 'dotenv';
import { askAI } from '../api/_lib/ai.js';
import { normalizeVehicleVision, VEHICLE_VISION_SYSTEM } from '../api/_lib/vehicle-vision.js';

loadDotenv({ quiet: true });
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/test-real-vehicle-vision.mjs /absolute/path/to/photo');
const bytes = readFileSync(path);
const mime = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const original = `data:${mime};base64,${bytes.toString('base64')}`;
const browser = await chromium.launch({ headless: true });
let image;
try {
  const page = await browser.newPage();
  image = await page.evaluate(async (dataUrl) => {
    const photo = new Image();
    photo.src = dataUrl;
    await photo.decode();
    const scale = Math.min(1, 1800 / Math.max(photo.width, photo.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.width * scale));
    canvas.height = Math.max(1, Math.round(photo.height * scale));
    canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }, original);
} finally {
  await browser.close();
}
if (image.length > 7 * 1024 * 1024) throw new Error('Compressed image exceeds the API limit');

const started = Date.now();
const result = await askAI({
  system: VEHICLE_VISION_SYSTEM,
  user: [{ type: 'text', text: '辨識照片中央的主體車輛，回傳指定 JSON。' }, { type: 'image_url', image_url: { url: image } }],
  model: process.env.AI_VISION_MODEL || process.env.AI_MODEL,
  maxTokens: 450,
});
let raw;
try { raw = JSON.parse(result.text.replace(/^```json\s*|\s*```$/g, '').trim()); }
catch { raw = { unparseable_response: result.text }; }
console.log(JSON.stringify({ provider: result.provider, model: result.model, duration_ms: Date.now() - started, image_bytes: Math.round(image.length * 0.75), raw, normalized: normalizeVehicleVision(raw) }, null, 2));
