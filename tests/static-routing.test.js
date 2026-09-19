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
