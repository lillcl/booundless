import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('demo navigation stays inside the document for file previews', () => {
  assert.doesNotMatch(html, /href=["']\/demo["']/);
  assert.doesNotMatch(html, /location\.href\s*=\s*["']\/demo["']/);
  assert.match(html, /href="#\/demo"/);
  assert.match(html, /location\.hash\s*=\s*["']#\/demo["']/);
});

test('static navigation and critical assets are file-preview safe', () => {
  assert.match(html, /href="#\/landing"/);
  assert.match(html, /src="assets\/vehicle-toyota\.jpg"/);
  assert.match(html, /src="assets\/vendor\/gsap\.min\.js"/);
});

test('vehicle history resolves independently of maintenance status', () => {
  const startHistory = html.indexOf('void renderVehicleHistory(id);');
  const emptyStatusReturn = html.indexOf("listCard.innerHTML = '<div class=\"wear-row\"><span><b>尚未建立保養範圍");
  assert.ok(startHistory > 0, 'vehicle detail should start history rendering');
  assert.ok(emptyStatusReturn > startHistory, 'history must start before an empty status can return early');
  assert.match(html, /if \(name === 'demo'\) window\.renderDemoVehicleHistory\?\.\(\);/);
});

test('garage is rendered by the database-backed vehicle passport module', () => {
  assert.match(html, /\(await import\('\.\/assets\/passport\.js'\)\)\.renderVehiclePassports/);
  assert.doesNotMatch(html, /const STATIC_ROUTES = new Set\(\[[^\]]*'garage'/);
  assert.match(html, /onAddVehicle: openAddVehicleSheet/);
});

test('standalone AI function bundles database schema files required by authentication', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.functions?.['api/ai.js']?.includeFiles, 'db/*.sql');
});

test('file previews send login to the hosted API-backed application', () => {
  assert.match(html, /window\.location\.protocol === 'file:'/);
  assert.match(html, /href="https:\/\/www\.booundless\.com\/#\/login"/);
  assert.match(html, /暫時無法連接登入服務/);
});
