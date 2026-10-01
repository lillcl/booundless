// Public failures carry stable codes, never provider messages or private data.
export class AgentRuntimeError extends Error {
  constructor(code, message, { status = 503, retryable = false, diagnostics = {} } = {}) {
    super(message);
    Object.assign(this, { code, status, retryable, diagnostics });
  }
}

export function publicRuntimeError(error) {
  const messages = {
    agent_timeout: '界仔處理這個問題超時，未能完成核對。你可以縮短問題，或直接使用網站頁面查看資料。',
    agent_cancelled: '已停止這次回覆。',
    agent_decision_invalid: '界仔未能確認這個問題的服務範圍或操作格式，沒有執行未通過驗證的操作。請換一種問法，或直接使用網站功能。',
    agent_provider_busy: 'AI 服務目前繁忙，有限重試後仍未能完成。請稍後再試，或直接使用網站功能。',
    agent_provider_unavailable: 'AI 服務目前連線失敗，請稍後再試，或直接使用網站功能。',
    agent_provider_configuration: 'AI 服務暫時未能使用，請聯絡網站管理員。',
    agent_request_budget: '這個問題需要的處理步驟或用量超出單次上限，請拆成較短的問題。',
    agent_internal: '界仔未能完成這次處理，請使用網站頁面或聯絡管理員並提供查詢編號。',
  };
  return messages[error.code] || messages.agent_internal;
}
