// constants/api-paths.js — 所有 API 路径集中管理

module.exports = {
  // 健康
  health: '/api/health',

  // 认证
  authLogin: '/api/auth/login',
  authLogout: '/api/auth/logout',
  authMe: '/api/auth/me',
  authWechat: '/api/auth/wechat',

  // 车辆
  vehicles: '/api/vehicles',
  vehicle: (id) => '/api/vehicles/' + id,
  vehicleStatus: (id) => '/api/vehicles/' + id + '/status',
  vehicleHistory: (id) => '/api/vehicles/' + id + '/history',
  vehicleDealerMatches: (id) => '/api/vehicles/' + id + '/dealer-matches',
  vehicleNeeds: (id) => '/api/vehicles/' + id + '/needs',
  vehicleCreateRequest: (id) => '/api/vehicles/' + id + '/service-requests',

  // 提醒
  reminders: '/api/reminders',
  reminder: (id) => '/api/reminders/' + id,

  // 行程
  trips: '/api/trips',
  trip: (id) => '/api/trips/' + id,

  // 历史
  historyRecent: '/api/history/recent',

  // 视频
  videos: '/api/videos',

  // 服务类型目录
  serviceItemTypes: '/api/service-item-types',

  // 服务请求工作流
  serviceRequests: '/api/service-requests',
  serviceRequest: (id) => '/api/service-requests/' + id,

  // 个人资料
  notifications: '/api/profile/notifications',
  teams: '/api/profile/teams',
  support: '/api/profile/support',

  // AI
  ai: '/api/ai',
  agent: '/api/agent',

  // 营销/转化（用户主动同意）
  marketingConversions: '/api/marketing/conversions',
  marketingConfig: '/api/marketing/config'
}