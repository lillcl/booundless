import { askAI } from './ai.js';
import { consumeDailyBudget, fenceUserContext } from './agent-safety.js';
import { searchSiteKnowledge } from './site-knowledge.js';
import { queryKnowledgeGraph } from './knowledge-graph.js';
import { resolveAssistantRoute } from '../../shared/assistant-routes.js';

export async function runPublicAssistant({ message, pageContext = {}, budgetKey = 'anonymous', onEvent = () => {} }) {
  const question = String(message || '').trim().slice(0, 4000);
  if (!question) throw new Error('message is required');
  const [sources, graph] = await Promise.all([
    searchSiteKnowledge(question, { limit: 4, pageContext }),
    queryKnowledgeGraph(question, { limit: 6, pageContext }),
  ]);
  await onEvent({
    type: 'tool_activity',
    tool_name: 'search_site_knowledge',
    status: 'completed',
    output: { ok: true, count: sources.length, data: sources },
  });
  await onEvent({
    type: 'tool_activity',
    tool_name: 'query_knowledge_graph',
    status: 'completed',
    output: { ok: true, count: graph.matches.length, data: graph },
  });
  const navigation = sources[0]?.route_key ? resolveAssistantRoute(sources[0].route_key) : null;
  if (navigation) {
    await onEvent({
      type: 'tool_activity',
      tool_name: 'suggest_navigation',
      status: 'completed',
      output: { ok: true, data: { ...navigation, reason: '查看相關的 BOOUNDLESS 已核對內容' } },
    });
  }
  const system = [
    '你是無界啟程 BOOUNDLESS 的網站導覽助手「界仔」，使用繁體中文和澳門常用表達。',
    '只處理 BOOUNDLESS 網站功能、汽車維修保養及琴澳同行。與上述範圍無關的一般知識、創作、投資、醫療、法律、稅務或即時天氣問題，要簡短婉拒並提示可詢問的範圍，不可直接回答。',
    '只根據提供的 BOOUNDLESS 已核對內容回答汽車、維修及琴澳問題；沒有資料時要清楚說明，不可憑模型記憶補作事實。',
    '回答保持精簡、實用。若資料屬時效性規則，要說明核對日期並提醒出發或辦理前查看官方來源。',
    '不要聲稱已診斷車輛故障，也不要要求訪客提供 VIN、車牌、身份證或其他敏感資料。',
    '引用資料時使用來源標題，不要輸出虛構連結。登入後才能讀取個人車輛資料或修改紀錄。',
  ].join('\n');
  const context = fenceUserContext({ page_context: pageContext, reviewed_sources: sources, knowledge_graph: graph });
  const result = await askAI({ system, user: `${context}\n\n使用者問題：${question}`, maxTokens: 700 });
  const usage = result.usage || {};
  const tokens = Number(usage.total_tokens || 0)
    || (Number(usage.prompt_tokens || usage.input_tokens || 0) + Number(usage.completion_tokens || usage.output_tokens || 0));
  consumeDailyBudget(budgetKey, tokens);
  await onEvent({ type: 'text', text: result.text });
  return {
    thread_id: null,
    status: 'completed',
    text: result.text,
    model: result.model,
    public: true,
    sources,
    knowledge_graph: graph,
    navigation,
  };
}
