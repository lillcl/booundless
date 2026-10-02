import { readFile } from 'node:fs/promises';

const KNOWLEDGE_URL = new URL('../../assets/knowledge/qinao.json', import.meta.url);
const WEBSITE_URL = new URL('../../assets/knowledge/website.json', import.meta.url);
let cachedDocuments = null;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('zh-Hant').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  const text = normalize(value);
  const result = new Set(text.match(/[a-z0-9][a-z0-9._-]*/g) || []);
  for (const run of text.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) result.add(run);
    for (let index = 0; index < run.length - 1; index += 1) result.add(run.slice(index, index + 2));
  }
  return [...result].filter((token) => token.length > 1 || /[\u3400-\u9fff]/.test(token));
}

export async function loadSiteKnowledge() {
  if (cachedDocuments) return cachedDocuments;
  const payloads = await Promise.all([KNOWLEDGE_URL, WEBSITE_URL].map(async (url) => JSON.parse(await readFile(url, 'utf8'))));
  if (payloads.some((payload) => !Array.isArray(payload?.documents))) throw new Error('Site knowledge index is invalid');
  cachedDocuments = payloads.flatMap((payload) => payload.documents);
  return cachedDocuments;
}

export function relevantExcerpt(content, query, maxChars = 1900) {
  const text = String(content || '');
  if (text.length <= maxChars) return text;
  const queryTokens = tokens(query);
  const windows = [];
  for (let start = 0; start < text.length; start += 680) {
    const excerpt = text.slice(start, start + 800);
    const normalized = normalize(excerpt);
    const score = queryTokens.reduce((total, token) => total + (normalized.includes(token) ? token.length : 0), 0);
    windows.push({ start, excerpt, score });
  }
  const selected = windows.sort((a, b) => b.score - a.score || a.start - b.start).slice(0, 2).sort((a, b) => a.start - b.start);
  // Keep the title/introduction and query-matching passages, not just the first
  // page of a long document. Never cut the enclosing context JSON/fence.
  return `${text.slice(0, 160)}\n[…]\n${selected.map((part) => part.excerpt).join('\n[…]\n')}`.slice(0, maxChars);
}

function scoreDocument(document, queryTokens, pageContext = {}) {
  const title = normalize(document.title);
  const topics = normalize((document.topics || []).join(' '));
  const content = normalize(document.content);
  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 8;
    if (topics.includes(token)) score += 5;
    if (content.includes(token)) score += 1;
  }
  const currentPath = normalize(pageContext.path || '');
  const currentSection = normalize(pageContext.section || '');
  if (currentPath === normalize(document.page_url)) score += 2;
  if (currentSection && normalize(document.anchor) === `#${currentSection.replace(/^#/, '')}`) score += 3;
  return score;
}

function matchingQueryTokens(document, queryTokens) {
  const searchable = normalize(`${document.title} ${(document.topics || []).join(' ')} ${document.content}`);
  return queryTokens.filter((token) => searchable.includes(token));
}

export async function searchSiteKnowledge(query, { limit = 4, pageContext = {} } = {}) {
  const queryTokens = tokens(query).slice(0, 80);
  if (!queryTokens.length) return [];
  const documents = await loadSiteKnowledge();
  const ranked = documents
    .map((document) => ({ document, score: scoreDocument(document, queryTokens, pageContext), matchingTokens: matchingQueryTokens(document, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));
  const relevanceFloor = Math.max(2, (ranked[0]?.score || 0) * 0.2);
  const selected = [];
  const coveredQueryTokens = new Set();
  for (const entry of ranked) {
    if (entry.score < relevanceFloor || selected.length >= Math.min(8, Math.max(1, Number(limit) || 4))) continue;
    // Same-entity pages often score well on a place name alone. Keep a later
    // page only when it adds query terms not already covered by a better match.
    if (selected.length && !entry.matchingTokens.some((token) => !coveredQueryTokens.has(token))) continue;
    selected.push(entry);
    for (const token of entry.matchingTokens) coveredQueryTokens.add(token);
  }
  return selected
    .map(({ document, score }) => ({
      id: document.id,
      source: document.source,
      kind: document.kind || (document.source === 'BOOUNDLESS 網站功能' ? 'website_function' : 'guide'),
      title: document.title,
      excerpt: relevantExcerpt(document.content, query),
      url: `${document.page_url}${document.anchor || ''}`,
      route_key: document.route_key,
      verified_at: document.verified_at,
      time_sensitive: Boolean(document.time_sensitive),
      official_sources: Array.isArray(document.official_sources) ? document.official_sources.slice(0, 8) : [],
      relevance: score,
    }));
}

export function _resetSiteKnowledgeCache() {
  cachedDocuments = null;
}
