import { searchSiteKnowledge } from '../_lib/site-knowledge.js';
import { queryKnowledgeGraph } from '../_lib/knowledge-graph.js';
import { text, toolResult } from '../_lib/tool-utils.js';

export const knowledgeTools = {
  search_site_knowledge: {
    description: 'Search reviewed BOOUNDLESS first-party content about vehicles, maintenance, repairs, and 琴澳 travel. Use it before answering those topics and cite the returned page and verification date.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    async execute({ args, pageContext }) {
      const query = text(args.query, 'query', { required: true, max: 1000 });
      const data = await searchSiteKnowledge(query, { limit: args.limit, pageContext });
      return toolResult(data, { count: data.length });
    },
  },
  query_knowledge_graph: {
    description: 'Traverse the reviewed BOOUNDLESS knowledge graph to connect topics, guide sections, and official sources. Use it for relationship or multi-topic questions.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    async execute({ args, pageContext }) {
      const query = text(args.query, 'query', { required: true, max: 1000 });
      const data = await queryKnowledgeGraph(query, { limit: args.limit, pageContext });
      return toolResult(data, { count: data.matches.length });
    },
  },
};
