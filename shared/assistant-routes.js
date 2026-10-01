export const ASSISTANT_ROUTES = Object.freeze({
  'home': { label: '首頁', href: '/#/home', requires_auth: true },
  'garage': { label: '我的車輛', href: '/#/garage', requires_auth: true },
  'garage.add_vehicle': { label: '新增車輛', href: '/#/garage?assistant_action=add_vehicle', requires_auth: true },
  'service': { label: '保養與服務', href: '/#/service', requires_auth: true },
  'service.offers': { label: '服務優惠', href: '/#/service-offers', requires_auth: true },
  'service.requests': { label: '服務請求', href: '/#/requests', requires_auth: true },
  'trips': { label: '琴澳行程', href: '/#/qinao', requires_auth: true },
  'profile': { label: '帳戶設定', href: '/#/profile', requires_auth: true },
  'qinao.compare': { label: '比較跨境制度', href: '/guide#compare', requires_auth: false },
  'qinao.apply': { label: '查看申請準備', href: '/guide#apply', requires_auth: false },
  'qinao.trip': { label: '查看琴澳行程建議', href: '/guide#trip', requires_auth: false },
  'qinao.service': { label: '查看北上維修指南', href: '/guide#service', requires_auth: false },
  'qinao.check': { label: '查看出發前檢查', href: '/guide#check', requires_auth: false },
  'qinao.official': { label: '查看官方入口', href: '/guide#official', requires_auth: false },
});

export function resolveAssistantRoute(routeKey) {
  const key = String(routeKey || '');
  const route = Object.hasOwn(ASSISTANT_ROUTES, key) ? ASSISTANT_ROUTES[key] : null;
  return route ? { route_key: key, ...route } : null;
}
