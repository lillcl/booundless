import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveHandler } from '../api/index.js';

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
  assert.match(html, /src="assets\/site-metadata\.js"/);
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

test('development schema bootstrap applies forward migrations after schema slices', () => {
  const dbSource = readFileSync(new URL('../api/_lib/db.js', import.meta.url), 'utf8');
  const serviceSlice = dbSource.indexOf("service-mvp-schema.sql");
  const migrationsDir = dbSource.indexOf("join(schemaDir, 'migrations')");
  assert.ok(serviceSlice >= 0, 'service schema slice is applied');
  assert.ok(migrationsDir > serviceSlice, 'forward migrations run after all schema slices');
  assert.match(dbSource, /readdirSync\(migrationsDir\).*\.sort\(\)/s);
});

test('retired dealer invite endpoints resolve to 404 instead of an auth handler', () => {
  assert.equal(resolveHandler('/api/dealer/invites/register'), null);
  assert.equal(resolveHandler('/api/dealer/invites/accept'), null);
  assert.equal(resolveHandler('/api/admin/dealers/dealer-123/invites'), null);
});

test('API guard wrappers are cached separately by limiter class', () => {
  const source = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  assert.match(source, /opts\.strict \? 'strict' : opts\.mutating \? 'mutating' : 'default'/);
  assert.match(source, /variants\.set\(variant, guarded\)/);
  assert.doesNotMatch(source, /wrapped\.set\(target, guarded\)/);
});

test('development error handler uses its request argument', () => {
  const source = readFileSync(new URL('../scripts/dev-server.js', import.meta.url), 'utf8');
  assert.match(source, /app\.use\(\(err, req, res, _next\) =>/);
  assert.doesNotMatch(source, /app\.use\(\(err, _req, res, _next\) =>[\s\S]*?req\.path/);
  assert.match(source, /err\?\.type === 'entity\.parse\.failed'/);
  assert.match(source, /code: invalidJson \? 'invalid_json'/);
});

test('development server applies rate and origin guards to every API route', () => {
  const source = readFileSync(new URL('../scripts/dev-server.js', import.meta.url), 'utf8');
  assert.match(source, /app\.use\('\/api', async \(req, res, next\) =>/);
  assert.match(source, /strict \? authLimiter : isMutating\(req\) \? mutatingLimiter : apiLimiter/);
  assert.match(source, /return originCheck\(null, null, next\)\(req, res\)/);
  assert.doesNotMatch(source, /function withLimit\(/);
  assert.doesNotMatch(source, /function protect\(/);
});

test('legal pages use root-relative assets and the canonical production host', () => {
  for (const page of ['privacy', 'terms']) {
    const source = readFileSync(new URL(`../legal/${page}.html`, import.meta.url), 'utf8');
    assert.match(source, /href="\/assets\/icons\/booundless-car\.png"/);
    assert.match(source, /src="\/assets\/icons\/booundless-car\.png"/);
    assert.match(source, new RegExp(`href="https://www\\.booundless\\.com/legal/${page}\\.html"`));
  }
});

test('file previews send login to the hosted API-backed application', () => {
  assert.match(html, /window\.location\.protocol === 'file:'/);
  assert.match(html, /href="https:\/\/www\.booundless\.com\/#\/login"/);
  assert.match(html, /暫時無法連接登入服務/);
});
