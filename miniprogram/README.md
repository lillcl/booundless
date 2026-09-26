# 無界啟程 BOOUNDLESS — 微信小程序

This directory contains the **WeChat Mini Program (微信小程序)** port of the [BOOUNDLESS](../) web app. Drop the folder into **微信开发者工具** to open it as a project.

## What's inside

```
miniprogram/
├── app.js / app.json / app.wxss          # 全局入口、路由表、设计 token
├── project.config.json                   # 开发者工具配置
├── sitemap.json
├── images/                               # 已复制的图片资源（场景图、车辆图、tabBar 图标）
├── constants/{enums,api-paths}.js        # 集中枚举与所有 API 路径
├── utils/
│   ├── api.js                            # wx.request 封装（Bearer Token + 错误信封）
│   ├── auth.js                           # 微信登录 / 邮箱登录 / 登出
│   ├── storage.js                        # wx.getStorageSync 包装（命名空间 kc_mp_）
│   ├── format.js                         # 日期 / 里程 / 货币 / 相对时间
│   ├── icons.js                          # 内联 SVG 图标
│   ├── image.js                          # 拍照 + 压缩 + 转 base64
│   └── sse.js                            # /api/agent 流式响应解析
├── components/                           # 8 个复用组件
│   ├── app-dialog                        # 替代 <dialog>（notice / confirm / input）
│   ├── bottom-sheet                      # 替代 openSheet
│   ├── reminder-card / vehicle-card / wear-bar
│   ├── kc-tabs / status-pill / primary-button / secondary-button / empty-state
└── pages/                                # 19 个页面（详见下表）
```

## Pages

| Path | File | 说明 |
| --- | --- | --- |
| `/pages/landing/landing` | 着陆页 | 品牌展示 + 三项功能介绍（tabBar 之外） |
| `/pages/login/login` | 登录 | 微信一键登录；开发模式支持邮箱 + 密码 |
| `/pages/home/home` | 主頁（tabBar）| 问候 + 提醒 + 车队 + 最近行程 + 快捷入口 |
| `/pages/garage/garage` | 車庫（tabBar）| 车辆列表 + 新增 / 编辑 |
| `/pages/vehicle-detail/vehicle-detail` | 车辆详情 | 损耗柱 + 维修记录 + 入口到 AI / 服务商 |
| `/pages/dealer-matches/dealer-matches` | 服务商匹配 | 按车辆 → 分店 + 服务项 + 报价区间 |
| `/pages/service/service` | 服务 | 服务目录（13 项）+ 车辆选择 |
| `/pages/qinao/qinao` | 琴澳（tabBar）| 横琴 / 澳门 / 大桥三条路线 + 自驾贴士 |
| `/pages/videos/videos` | 影片（tabBar）| 教学影片列表 |
| `/pages/profile/profile` | 我的（tabBar）| 个人信息 + 功能入口 + 登出 |
| `/pages/notifications/notifications` | 通知偏好 | 保養 / 行程 / AI 三种开关 |
| `/pages/support/support` | 客服 | 提交工单 |
| `/pages/team/team` | 家庭车队 | 共享车辆 |
| `/pages/history/history` | 维修记录 | 全车辆历史 |
| `/pages/requests/requests` | 服务请求列表 | 进行中 / 已完成 / 全部 |
| `/pages/request-detail/request-detail` | 请求详情 | 完整工作流：报价 → 接受 → 排期 → 完成 → 确认 |
| `/pages/ai-chat/ai-chat` | 车主 AI | `/api/agent` SSE 流式对话 |
| `/pages/ai-image/ai-image` | 拍照识别 | `/api/ai` vehicle-image |
| `/pages/about/about` | 关于 | 致謝 + 私隐政策（CC BY-SA 归属） |
| `/pages/404/404` | 找不到 | 模板化错误页 |

## Quick start

### 1. 注册 AppID

1. 打开 https://mp.weixin.qq.com/ → 「立即注册」 → 小程序
2. 主体认证通过后获得 **AppID** + **AppSecret**
3. 「开发 → 开发管理 → 服务器域名」加入你的 API 域名（须 HTTPS + ICP 备案）

### 2. 配置 API 地址

打开 `app.js`，把 `globalData.baseUrl` 改为你自己的后端：

```js
globalData: {
  baseUrl: 'https://api.your-domain.com',
  appId: 'wxYOUR_APPID_HERE',
  __DEV__: true   // 开发期 true 时支持邮箱登录；生产期改为 false
}
```

### 3. 开发者工具打开

1. 下载 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 「导入项目」 → 项目目录选 `miniprogram/`
3. 填入你的 AppID（或用测试号） → 「导入」
4. 工具 → 详情 → 本地设置 → 勾选「不校验合法域名」（仅开发期）
5. 点编译，即可在模拟器中运行

### 4. 体验版

工具右上角「上传」→ 填版本号（如 `1.0.0`）→ 上传。后台「版本管理」选为「体验版」，扫码即可在手机上试用。

### 5. 提审 & 发布

后台「版本管理 → 提交审核」：

- 服务类目：**汽车服务**（与「保養提醒、車主社群」匹配）
- 标签：汽车服务、车主助理、保養
- 测试账号：若部分功能需要登录，提交一个可登录的体验账号
- 截图：开发者工具 → 「二维码 → 获取更多 → 普通二维码」截图

审核一般 1–7 个工作日，通过后即可「发布」。

## 与后端的契约

小程序复用 web 端全部 API（见 `constants/api-paths.js`）。后端**必须**做以下三件事（详见 `server-patch/`）：

1. **加 `wechat_*` 字段**：`users` 表新增 `wechat_openid, wechat_unionid, wechat_appid, nickname, avatar_url, phone`（SQL 在 `server-patch/db/migrations/2026_09_wechat_columns.sql`）
2. **`Authorization: Bearer <jwt>` 支持**：在 `api/_lib/auth.js#readSessionToken` 中加一行 header 解析（diff 在 `server-patch/api/_lib/auth.bearer.diff.js`）
3. **`POST /api/auth/wechat`** 新端点：用 `wx.login` 拿到的 `code` 换 openid，upsert 用户，签发 JWT，返回 `{user, token}`（实现见 `server-patch/api/_handlers/auth.wechat.diff.js`）

环境变量：
```
WECHAT_APPID=wxXXXXXXXXXXXX
WECHAT_SECRET=your_app_secret
```

## 配置项速查

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `app.js#baseUrl` | `https://api.booundless.com` | 你的后端 API 根地址 |
| `app.js#appId` | `wxYOUR_APPID_HERE` | 微信公众平台的小程序 AppID |
| `app.js#__DEV__` | `true` | `true` 时显示邮箱+密码登录入口；上线后改为 `false` |
| `app.json#permission.scope.userLocation` | 已开启 | 距离 / 行程类功能用到 |

## 已知约束

- **主包大小**：3 张 2MB 的场景图 + 1MB 车辆图已接近 2MB 主包上限。如要发布，建议改为 CDN 远程图片（在 `app.js` 加 `globalData.imageBaseUrl`，把 `<image src>` 改成绝对 URL）。
- **AI 流式**：`utils/sse.js` 使用 `enableChunked: true` + `responseType: 'arraybuffer'` 解析 SSE。基础库 ≥ 2.18.0 可用。
- **拍照压缩**：使用 `wx.compressImage`，单边 ≤ 1200px、JPEG 质量 80，远低于后端 8MB 上限。
- **跨域 cookie**：小程序不能接收 `Set-Cookie`，所以全部走 `Authorization: Bearer`。web 端的 cookie 路径仍然有效。

## 测试建议

发布前用真机扫码体验版过一遍：

- [ ] 微信一键登录（首次注册、二次登录）
- [ ] 新增车辆（含拍照）
- [ ] 查看损耗柱
- [ ] 查找服务商 → 提交请求
- [ ] 服务请求列表 + 详情 → 接受报价 / 确认完成
- [ ] AI 文字对话（流式输出）
- [ ] AI 拍照识别
- [ ] 通知偏好持久化
- [ ] 联系客服工单
- [ ] 登出后 token 已清空

## 致謝

车辆与风景图片遵循 CC0 / CC BY-SA 4.0，归属于维基共享资源的原作者。详见 `/pages/about/about`。
