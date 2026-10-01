import { readFile } from 'node:fs/promises';
import { searchSiteKnowledge } from './site-knowledge.js';

const GRAPH_URL = new URL('../../assets/knowledge/graph.json', import.meta.url);
let cachedGraph = null;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('zh-Hant').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  const input = normalize(value);
  const result = new Set(input.match(/[a-z0-9][a-z0-9._-]*/g) || []);
  for (const run of input.match(/[\u3400-\u9fff]+/g) || []) {
    if (run.length === 1) result.add(run);
    for (let index = 0; index < run.length - 1; index += 1) result.add(run.slice(index, index + 2));
  }
  return [...result].filter((token) => token.length > 1 || /[\u3400-\u9fff]/.test(token));
}

export async function loadKnowledgeGraph() {
  if (cachedGraph) return cachedGraph;
  const graph = JSON.parse(await readFile(GRAPH_URL, 'utf8'));
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) throw new Error('Knowledge graph is invalid');
  cachedGraph = graph;
  return graph;
}

function nodeScore(node, queryTokens) {
  const label = normalize(node.label);
  const aliases = normalize((node.aliases || []).join(' '));
  let score = 0;
  for (const token of queryTokens) {
    if (label.includes(token)) score += 8;
    if (aliases.includes(token)) score += 4;
  }
  return score;
}

export async function queryKnowledgeGraph(query, { limit = 8, pageContext = {} } = {}) {
  const queryTokens = tokens(query).slice(0, 80);
  if (!queryTokens.length) return { matches: [], relations: [], documents: [], verified_at: null };
  const [graph, documentMatches] = await Promise.all([
    loadKnowledgeGraph(),
    searchSiteKnowledge(query, { limit: Math.min(4, limit), pageContext }),
  ]);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const scores = new Map();
  for (const node of graph.nodes) {
    const score = nodeScore(node, queryTokens);
    if (score > 0) scores.set(node.id, score);
  }
  for (const document of documentMatches) scores.set(document.id, (scores.get(document.id) || 0) + document.relevance + 12);

  const seeds = [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.min(12, Math.max(1, Number(limit) || 8)));
  const seedIds = new Set(seeds.map(([id]) => id));
  const relations = graph.edges
    .filter((edge) => seedIds.has(edge.from) || seedIds.has(edge.to))
    .slice(0, 40)
    .map((edge) => ({
      type: edge.type,
      label: edge.label || null,
      from: nodeById.get(edge.from),
      to: nodeById.get(edge.to),
    }));
  const connectedDocumentIds = new Set(documentMatches.map((document) => document.id));
  for (const [id] of seeds) if (nodeById.get(id)?.type === 'document') connectedDocumentIds.add(id);
  for (const relation of relations) {
    if (relation.from?.type === 'document') connectedDocumentIds.add(relation.from.id);
    if (relation.to?.type === 'document') connectedDocumentIds.add(relation.to.id);
  }
  const matchedById = new Map(documentMatches.map((document) => [document.id, document]));
  const documents = [...connectedDocumentIds]
    .map((id) => matchedById.get(id) || nodeById.get(id))
    .filter(Boolean)
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 8)));
  return {
    matches: seeds.map(([id, score]) => ({ ...nodeById.get(id), score })).filter((node) => node.id),
    relations,
    documents,
    verified_at: graph.verified_at || null,
  };
}

export function _resetKnowledgeGraphCache() {
  cachedGraph = null;
}
