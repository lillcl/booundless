import { readFile } from 'node:fs/promises';

const KNOWLEDGE_URL = new URL('../../assets/knowledge/qinao.json', import.meta.url);
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
  const payload = JSON.parse(await readFile(KNOWLEDGE_URL, 'utf8'));
  if (!Array.isArray(payload?.documents)) throw new Error('Site knowledge index is invalid');
  cachedDocuments = payload.documents;
  return cachedDocuments;
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

export async function searchSiteKnowledge(query, { limit = 4, pageContext = {} } = {}) {
  const queryTokens = tokens(query).slice(0, 80);
  if (!queryTokens.length) return [];
  const documents = await loadSiteKnowledge();
  const ranked = documents
    .map((document) => ({ document, score: scoreDocument(document, queryTokens, pageContext) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));
  const relevanceFloor = Math.max(2, (ranked[0]?.score || 0) * 0.2);
  return ranked
    .filter((entry) => entry.score >= relevanceFloor)
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 4)))
    .map(({ document, score }) => ({
      id: document.id,
      source: document.source,
      title: document.title,
      excerpt: String(document.content || '').slice(0, 2400),
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
