import { discoverResearchTools } from '../_lib/research-mcp.js';

/* Agent registry hook. The actual MCP tools are discovered per request so a
   serverless instance never exposes an unapproved tool discovered elsewhere. */
export async function getResearchTools(options = {}) {
  return discoverResearchTools(options);
}
