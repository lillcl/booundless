import { resolveAssistantRoute } from '../../shared/assistant-routes.js';
import { text, toolResult } from '../_lib/tool-utils.js';

export const navigationTools = {
  suggest_navigation: {
    description: 'Offer a safe BOOUNDLESS navigation action. Select only a registered route key; the user chooses whether to open it.',
    input_schema: {
      type: 'object',
      required: ['route_key'],
      properties: {
        route_key: { type: 'string' },
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    readOnly: true,
    async execute({ args }) {
      const routeKey = text(args.route_key, 'route_key', { required: true, max: 80 });
      const route = resolveAssistantRoute(routeKey);
      if (!route) throw new Error('Navigation route is not allowed');
      return toolResult({ ...route, reason: text(args.reason, 'reason', { max: 240 }) });
    },
  },
};
