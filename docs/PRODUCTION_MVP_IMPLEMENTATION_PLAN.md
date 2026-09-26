# 無界啟程 BOOUNDLESS：三角色生產 MVP 實作計劃

編寫日期：2026-09-22。目標：2026-09-23（Asia/Hong_Kong）上線受控試點。

## 1. 交付定義與時間限制

明天的可交付目標是：一間已確認合作的車行、真實車主、三個服務入口，能完成預約、檢查、報價批准、施工、追加批准、交付、護照更新及人工結算。採用現有 Vanilla JS + Node API + PostgreSQL；不重寫框架、不建立另一套帳號／訂單系統。

這是一份實作規格，不代表已部署或已驗證生產環境。程式核對包含未提交檔案；未執行現有測試或讀取生產資料。此前「完成百分比」沒有測量依據，不作排程依據。

明天只承諾經驗收通過的受控試點，不承諾一天完成全自動支付、退款、結算、排班及保固裁決平台。下面每項需求都有第一版實作或明確人工操作方案；核心批准／資料隔離／紀錄真確性不作時間上的妥協。

預設試點：MOP、澳門車行、Asia/Macau 顯示時區、最多 30 單、Admin 邀請車商、車行現場收款、Admin 人工對帳。MOP 280／45 分鐘只是待車行確認的商品設定，不能未確認便發布。佣金率預設 0 bps；8–12% 是待確認商業條款，不能自行啟用。

## 2. 已有基礎：必須重用

| 範圍 | 現有實作 | 實作決策 |
|---|---|---|
| 身份 | users.role=user/admin；dealer_members=owner/manager/staff/viewer | 保留。一個 user 可同時是車主與車商成員；介面提供工作區切換 |
| 邀請 | Admin 建立車商、啟用／停用、邀請、接受邀請及註冊 | 加入可操作的 onboarding checklist、重新發邀請，不重建 auth |
| 護照 | assets/passport.js；vehicles、vehicle_status、service_history | 增加檢查報告及已驗證完成紀錄 |
| 授權 | vehicle_dealer_grants；車主授權／撤回；車商讀寫紀錄 | 保留長期授權，新增訂單限定授權，不自動授予永久全車資料權限 |
| 配對 | dealer-matcher.js；分店服務及 fitments | 保留適配／需求覆蓋排序；增加價格、可約時間的明示資訊 |
| 服務請求 | dealer_service_requests、dealer_request_items | 此表繼續作整宗服務的主聚合，不新建平行 service_orders 主表 |
| 報價／預約 UI | assets/request-flow.js 已有報價、接受、排期、完成、確認按鈕 | 擴充表單及詳情頁，不能再標記為「完全未有前端」 |
| 流程 API | requests.js 已有 quote/accept_quote/schedule/complete/confirm_completion/cancel/decline | 保留路徑與既有動作，新流程使用 workflow_version=2 |
| 紀錄共用服務 | service-records.js | 改成支援傳入 transaction client；所有已確認施工寫入走同一服務 |
| 測試 | service-requests、pipeline、dealer-access、history 等 E2E 已存在 | 延用並補實際 UI 點擊流程；現有 request 測試多以 fetch 推進，不能當成完整 UI 驗收 |

現有 index.html 中舊 PATCH listener 目前掛在沒有對應 select 的清單上，屬清理項，不足以推論整個報價流程失效。現有 requests.js 才是有效流程。

## 3. P0：開發開始先處理的實際衝突

1. `api/_handlers/history.js` 最近紀錄查詢沒有 requireUser／owner filter。加上登入、車輛 ownership、archived_at、voided_at 篩選；跨帳號及匿名不能讀取。
2. `requests.js confirm_completion` 直接 INSERT history，欠缺 service_keys、dealer/source attribution，且把全部 request items 當完成。改成只使用已批准且實際完成的 order lines，透過共用 transaction helper 寫入。檢查結果不得重置 last_done。
3. `service-records.js` 現在自行 connect/BEGIN，不能嵌入訂單 transaction。拆出 `createServiceRecordTx(client, args)`；原 public helper 保留 wrapper。
4. 目前 vehicle_status 的 wear 與 last_done 不足以表示「剛檢查正常，但更換歷史未知」。檢查 observation 與 maintenance history 分開，禁止把「正常」轉成「剛更換」。
5. `getDb()` 冷啟動會跑多份 schema／seed；`scripts/migrate.js` 卻只跑 schema.sql。統一 migration manifest，生產不在 request path 執行 DDL／seed。新增 migration ledger、advisory lock、schema readiness check；資料回填各自可重跑。
6. 目前試點以外 API 亦需檢查，例如 trips 目前沒有 owner scope。未能完成隔離的路由在生產 pilot 模式明確關閉（服務端拒絕），不能只隱藏按鈕。
7. 有大量未提交商城、index.html、E2E 改動。先保存 diff 清單和檔案 ownership；不得覆蓋、reset 或自行清理。index.html、路由 dispatcher、migration manifest 只由整合者修改。

## 4. 三角色與權限規則

| 操作 | 車主 | 車商 owner/manager | 車商 staff | viewer | Admin |
|---|---|---|---|---|---|
| 自己車輛／護照 | 讀寫 | 依車主授權或訂單範圍 | 同左 | 範圍內唯讀 | 有原因且有 audit 的支援查看 |
| 建立服務請求 | 自己車輛 | 不冒充車主 | 不冒充車主 | 否 | 可協助建立草稿，車主自行確認 |
| 報價／追加 | 批准或拒絕 | 發布 | 第一版可發布，與現況一致 | 唯讀 | 查看，不代車主批准 |
| 檢查／完工資料 | 查看、確認、提出問題 | 填寫／提交 | 填寫／提交 | 唯讀 | 查看、處理爭議 |
| 排班／服務／員工 | 否 | 管理 | 查看預約 | 唯讀 | 管理車商及啟停 |
| 佣金／結算 | 自己最終收據 | 自己車行 | 不顯示 | 不顯示 | 管理、匯出、記錄結算 |

所有 API 從 session 解出 user；dealer_id/vehicle_id 僅為篩選值，不能作授權證據。禁止車商成員批准自己車行對自己車輛的交易；轉人工處理。停用車行禁止新交易及寫入，但車主仍可查看歷史。撤回長期授權不刪除已同意的訂單快照；新存取依訂單所需最小資料處理，並向車主顯示。

## 5. 資料模型與完整欄位規格

約定：新 ID 使用 UUID，既有 FK 沿用 TEXT。時間為 TIMESTAMPTZ、DB 存 UTC；本地日期顯示 Asia/Macau。金額全部 BIGINT minor units、非負，API 回傳安全範圍整數；MOP 280 = 28000。所有外部輸入都驗證長度、enum、範圍、跨車行關聯。所有可變業務 entity 有 version、created_at、updated_at；作者由 session 取得。下列 `?` 為 nullable，其餘 required，default 特別註明。

### 5.1 服務商品及車行設定

新增 `service_offers`：id、dealer_id、branch_id、kind(enum baseline/maintenance/second_opinion)、name(varchar120)、description(text2000)、currency(default MOP)、price_minor?、pricing_mode(fixed/quote_required)、duration_minutes(int 15–480)、checklist_version?、active(bool default false)、version、timestamps。

新增 `service_offer_items`：offer_id、dealer_service_item_id，複合 PK。直接重用現有 dealer_service_items／branch services／fitments。只有實際分店服務才可加入。

baseline / second_opinion 必須有 checklist_version；固定價必須 price_minor 非空。maintenance 採 quote_required。檢查服務本身對應 inspection service key，不把七個被檢查部件當作七項更換施工。

在 `dealers` 加 pilot_enabled(bool false)；在 `dealer_branches` 加 timezone(varchar64 default Asia/Macau)。聯絡資料、地址、opening_hours 延用現有欄位。公開 offer 要求車商 active、pilot_enabled、分店 active、價格／時間／檢查內容已填。

### 5.2 既有請求升級為 Service Order

`dealer_service_requests` 加：workflow_version(int default 1)、order_number?(unique)、offer_id?、service_kind?(baseline/maintenance/second_opinion)、parent_request_id?、accepted_quote_id?、contact_name?、contact_phone?、customer_note?、vehicle_snapshot?(JSONB)、offer_snapshot?(JSONB)、terms_version?、consented_at?、customer_origin?(platform_new/dealer_existing/unknown)、origin_evidence?、origin_locked_at?、started_at?、work_state?(not_started/in_progress/awaiting_approval/completion_submitted)、completed_at?、cancel_reason?、cancelled_by?、currency?、approved_total_minor?、final_total_minor?、payment_state(default unpaid: unpaid/paid/partially_refunded/refunded)、payment_method?(cash/bank_transfer/other)、paid_at?、payment_reference?、payment_recorded_by?。

workflow_version=2 在接受報價時產生 order_number（DB sequence 格式 KC-YYYY-NNNNNN，不能用 COUNT+1）。保留原 status enum，不以 work_state 製造第二套互相矛盾的狀態。work_state 只可在 scheduled/completed 階段使用，API 控制合法組合。

新單建立即保存身份／offer snapshot；批准後不可直接修改 vehicle、dealer、currency、approved lines。parent_request_id 用於由 inspection 建立後續 maintenance，不把檢查費混進後續維修單。

`dealer_quotes` 保留 items JSONB 和現有欄位，增加 schema_version(default 1)。v2 每行：line_id(UUID)、service_keys(TEXT[])、description(max200)、quantity(int 1–100)、parts_brand?、parts_spec?、part_number?、parts_unit_minor(int >=0)、labour_minor(int >=0)、amount_minor(server calculated)、work_type(inspect/replace/repair/service)、warranty_text?(max1000)。line total = quantity × parts_unit_minor + labour_minor；檢查費可用 labour_minor。沒有零件時 quantity=1、parts_unit_minor=0。服務 key 必須合法且屬於該車可適用 scope；未知映射不可重置部件狀態。

報價全部不可變；修改建立新 version。車主提交 quote_id、selected_line_ids；伺服器只接受最新未過期版本且至少一項。未選項視為拒絕。拒絕全部可用 reject_quote 動作，保留事件並回到 new。

新增 `service_order_lines`：id、request_id、quote_id、quote_line_id、change_id?、description、service_keys、work_type、quantity、parts_brand?、parts_spec?、part_number?、parts_unit_minor、labour_minor、amount_minor、warranty_text?、approved_by、approved_at、execution_state(default pending: pending/completed/not_performed)、not_performed_reason?。UNIQUE(request_id,quote_id,quote_line_id)。所有價格及描述從批准報價複製，不能信任 browser 傳值。

### 5.3 Baseline／第二意見報告

第一版 checklist 寫成版本化程式設定 `shared/inspection-templates.js`（baseline-v1、second-opinion-v1）。Admin 可啟停 offer，不能直接修改已發出的 checklist。可視化模板編輯器放後續。

七個檢查範圍：機油及機油隔、波箱油、煞車皮、煞車油、冷卻液、火花塞、濾芯。濾芯拆明 air_filter / cabin_filter，避免「塵格」語意不清；機油組可對應 engine_oil + oil_filter，報告仍顯示一個範圍。純 EV 不適用項目標 N/A，不能硬套燃油模板。

新增 `inspection_reports`：id、request_id(unique)、template_key、template_version、status(draft/published)、revision(int default1)、vehicle_snapshot(JSONB)、mileage_km(int 0–10000000)、inspected_by、started_at、finished_at?、summary?(max3000)、customer_question?(max2000)、previous_quote_attachment_id?、published_at?、supersedes_report_id?、version、timestamps。

新增 `inspection_results`：id、report_id、check_key、service_keys(TEXT[])、result(unknown/normal/recommended/urgent/not_applicable)、measurement_value?(numeric)、measurement_unit?(mm/percent/other)、measurement_method?、notes?(max2000)、recommended_action?(max1000)、next_due_km?、next_due_date?。UNIQUE(report_id,check_key)。N/A 要有原因；百分比要標量測／估計，不能把剩餘 60% 填入 wear=60。無法檢查時 unknown 並說明原因；發布要求所有模板項目都有結果及必要說明。

發布報告產生已觀察需求；inspection_result 的 normal 不清除舊 maintenance history，不代表零件新換。需求保存 provenance(report/result ID)；遇到與車主 existing needs 衝突保留雙方證據、要求確認，不能直接覆蓋 dismissed。報告發布後只可建立修訂，原版保留。沒有維修要求的檢查可直接交付，不能強迫加購。

### 5.4 預約與 availability

新增 `booking_slots`：id、branch_id、starts_at、ends_at、capacity(int 1–20 default1)、active(bool true)、version、timestamps。明天用車行手動開放具體時段，不做重複排班引擎。時段跨度須 >= offer duration；車主只能選未來時段。

新增 `service_bookings`：id、request_id、slot_id、status(confirmed/cancelled)、booked_by、created_at、cancelled_at?。每單最多一筆 confirmed（partial unique）。使用 transaction 鎖 slot，再 count confirmed 並驗容量；reschedule 按 ID 固定順序鎖新舊 slot。同步舊 scheduled_at，供既有 UI／小程序顯示。沒有時段時顯示「聯絡車行安排」，不能顯示假 availability。

### 5.5 追加工程

新增 `service_changes`：id、request_id、status(draft/proposed/approved/rejected/withdrawn)、reason(max2000)、quote_lines(JSONB，與 v2 quote 同 schema)、total_minor(server)、created_by、proposed_at?、decided_by?、decided_at?、decision_note?、version、timestamps。

一次只批准／拒絕整份追加方案；要部分批准，車商分開提案或重發。批准時生成 order lines，唯一 change_id+line_id 防重複。待批准行不能填入施工完成資料。原已批准工程可繼續，完工提交前所有 pending changes 必須拒絕或撤回。需要額外工時則先提出改期，不能偷偷更改預約。

### 5.6 完工、證據與護照

新增 `service_completions`：id、request_id、revision、status(draft/submitted/confirmed/disputed)、mileage_km、started_at、finished_at、duration_minutes(derived)、technician_name、notes?、final_total_minor(server)、submitted_by、submitted_at?、confirmed_by?、confirmed_at?、version、timestamps。UNIQUE(request_id,revision)；每單最多一份 active submitted/confirmed report。

新增 `service_completion_lines`：completion_id、order_line_id、outcome(completed/not_performed)、actual_parts_brand?、actual_parts_spec?、actual_part_number?、notes?、next_due_km?、next_due_date?。PK(completion_id,order_line_id)。只能引用本單已批准行；換零件品牌／規格／價格會改變車主批准內容時需新追加或替代提案。未施工行須原因，不計費、不重置 scope；第一版不支援拆分部分数量，改報價後批准。

`service_history` 加 request_id?、completion_id?、record_type(default maintenance: maintenance/inspection)、structured_total_minor?、currency?。completion_id unique。已確認成交紀錄 immutable；修正建立具原因的 correction／void event，不能經既有 history PATCH 改價或更改成交證據。歷史手動紀錄保持原本編輯功能但標示未經訂單核實。

completion confirm 同一 transaction：鎖 order → 檢查 owner／version／report → 建立 history → 更新實際完成 keys → resolve 對應 needs → 更新下次提醒 → 寫 commission ledger／event／notification。任一步失敗全部 rollback。inspection lines 不走 last_done 重置；維修日期用 finished_at、里程用報告讀數，不能用按下確認當天時間或舊車輛里程。

提醒沿用 reminders，新增 service_key?、due_at?、due_mileage_km?、source_completion_id?、resolved_at?。UNIQUE(vehicle_id,service_key,source_completion_id)。日期／里程任一達到即到期；只對有明確週期或車商填寫建議的項目生成，沒有資料就顯示未知。

### 5.7 圖片與附件

新增 `service_attachments`：id、request_id、uploaded_by、object_key(unique)、mime_type、size_bytes、sha256?、purpose(before/after/inspection/previous_quote/receipt)、inspection_result_id?、order_line_id?、upload_state(pending/ready/failed)、created_at。

採私有 object storage adapter；若現有 Supabase 專案有 storage，使用 private bucket `service-evidence`，不把相片放 public assets 或 Postgres base64。簽名上傳有效 10 分鐘、讀取 URL 5 分鐘；授權檢查後才簽名。JPEG/PNG/WebP，每張 <=5MB，每單 <=20 張；瀏覽器壓縮、移除 EXIF；server finalize 檢查物件存在、大小、MIME、檔案 signature，再標 ready。待上傳附件不能發報告。孤兒物件清理只針對 expired pending 上傳。

檢查報告至少一張證據照；實際施工至少 before/after 各一張（可關聯多項）；無法拍攝須明確原因並給 Admin review，不能默默跳過。部件照片不可作 AI 自動判定施工完成的唯一證據。

### 5.8 售後／通知／佣金

新增 `service_cases`：id、request_id、opened_by、kind(workmanship/warranty/billing/other)、description、status(open/in_review/resolved/closed)、assigned_dealer_id、resolution?、resolved_by?、resolved_at?、version、timestamps。以 attachments 保存證據。保固文字從批准行保存，不生成未承諾保固。

新增 `notifications`：id、user_id、request_id?、event_id、type、title、body、read_at?、created_at；UNIQUE(user_id,event_id,type)。每次報價、批准、拒絕、預約／改期、追加、完工、爭議都在 transaction 建站內通知。UI 每 30 秒可見頁面輪詢，頁面隱藏暫停。明天站內通知必須可用；Email 可經现有 Resend 發送並記錄 queued/sent/failed，不能在 transaction 內等待網絡。車行營運人員試點期間人工電話提醒重要待辦，明確寫入交接表。

新增 `dealer_commercial_terms`：id、dealer_id、version、starts_at、ends_at?、commission_bps(0–10000)、free_completed_orders(int >=0)、accepted_by?、accepted_at?、created_by。第一次 pilot 預設 0%；只有雙方確認才發布非零版本。

新增 `commission_entries`：id、request_id、completion_id、dealer_id、terms_id、origin、basis_minor、rate_bps、commission_minor、entry_type(accrual/reversal)、reverses_entry_id?、status(pending/settled/waived)、settled_at?、settlement_reference?、created_at。同 completion 的 accrual 唯一；退款新增 reversal，保留原流水。計佣按 owner confirmed 完成單，結算須 payment_state=paid。dealer_existing 0%、unknown 暫緩計佣；平台來源新客有證據才套用條款，不能只讓車行任意切換免佣。

fee = round(basis_minor × rate_bps /10000)，使用整數計算；basis 是實際完成批准行、未含已退金額。免佣額度計數及佣金入帳鎖該 dealer terms，避免併發超額。Admin CSV 匯出／手動記錄收款，明天不做自動扣佣或自動退款。退款人工處理後新增 `service_payment_events`：id/request_id/type(payment/refund)/amount_minor/currency/reference/actor_id/created_at/idempotency_key，重算 payment_state 及 reversal，不能只改狀態而無金額證據。

## 6. API 合約與一致性

新增路由仍接入 `api/index.js`；本地 dev server 與 production 使用同一 dispatcher。所有 mutating calls 帶 version 及 Idempotency-Key；新增 request_actions 記錄 actor_id/request_id/key/payload_hash/response/status，唯一(actor_id,request_id,key)。同 key 同 payload 回原結果，異 payload 409。DB unique／鎖為最終保障，不能只靠前端 disabled。

| Endpoint | 權限／輸入 | 結果 |
|---|---|---|
| GET /api/service-offers | 登入；vehicle_id?,kind | active offer、價格、適配、duration、可用時段摘要 |
| POST/PATCH /api/dealer/offers[/id] | owner/manager；5.1 欄位＋version | 建立 draft／發布前驗證 |
| POST /api/vehicles/:id/service-requests | 車主；原欄位＋offer_id/contact/consent/origin evidence | v2 request，舊 payload 保持 v1 |
| GET /api/service-requests[/:id] | owner／所屬 dealer；cursor/status/dealer_id | 原 data envelope 保留，增加 order/report/actions；limit<=50，新 cursor |
| POST /api/service-requests/:id | 原 action 路由擴充 | quote、accept_quote(selected_line_ids)、reject_quote、schedule(slot_id)、start、complete(completion_id)、confirm_completion、cancel、decline |
| GET/POST /api/dealer/booking-slots | 成員讀；owner/manager 寫 | 明確 starts/ends/capacity；只屬於所屬分店 |
| GET /api/service-offers/:id/slots | 車主 | 未來可用 slots，booking 成功仍以 transaction 結果為準 |
| POST /api/service-requests/:id/reschedule | owner/operator；slot_id/version | 原預約尚未 start，原子移動，通知雙方 |
| GET/PUT /api/service-requests/:id/inspection | owner 讀已發布；operator 草稿讀寫 | 報告與逐項結果，保存 revision |
| POST /api/service-requests/:id/inspection/publish | operator；version | checklist 檢查、發布、更新有來源 needs |
| POST /api/service-requests/:id/follow-up | owner；report_id/selected_result_ids/offer_id | maintenance 子請求，不自動同意维修 |
| POST /api/service-requests/:id/changes | operator；5.5 提案 | proposed；不立即變更 order lines |
| POST /api/service-requests/:id/changes/:changeId/decision | owner；approve/reject/version | 生成批准行或記錄拒絕 |
| GET/PUT /api/service-requests/:id/completion | operator 草稿寫；owner 讀已提交 | 5.6 報告及完成行 |
| POST /api/service-requests/:id/attachments/upload | 相關 owner/operator；type/size/purpose | attachment ID＋signed upload URL |
| POST /api/service-requests/:id/attachments/:id/finalize | uploader＋訂單權限 | 驗證後 ready |
| GET /api/service-requests/:id/attachments/:id | 訂單授權 | 短效 signed read URL |
| POST /api/service-requests/:id/cases | owner | 售後／驗收異議，凍結 disputed 單結算 |
| GET/PATCH /api/dealer/cases/:id | 該車行 operator | 回覆／處理進度；不得消除車主原陳述 |
| GET /api/notifications；POST /api/notifications/:id/read | 本人 | 未讀及已讀 |
| GET /api/admin/service-orders | admin；filter/cursor | 全部流程、失敗／待辦／爭議 |
| PATCH /api/admin/service-cases/:id | admin；reason/version | 有理由的處理紀錄，不代車主批准施工 |
| POST /api/dealer/service-orders/:id/payment | owner/manager；amount/reference/key | 記錄線下付款，不能改施工價格 |
| GET /api/admin/commissions；POST /api/admin/settlements | admin | 匯出／手動對帳 |
| POST /api/admin/service-orders/:id/refund | admin；已人工退款證據、amount/key | payment reversal＋佣金沖回，非調用銀行退款 |

共同錯誤：401 未登入、403 無權限、404 不存在或不屬本人的資源、409 stale version/已滿/重複異 payload、422 欄位錯誤（fieldErrors）、503 必要依賴未配置。未知 internal errors 不回傳 SQL／連線資訊。

## 7. 狀態機：不能有跳步或假完成

主流程：new → quoted → accepted → scheduled → completed → completion_confirmed_at。

- quote：operator，new/quoted；新報價失效舊報價但保存原內容。
- accept_quote：owner；鎖單＋quote；驗有效期；生成 approved order lines；status=accepted。
- schedule：owner 或 operator 選可用 slot；原子預約；status=scheduled。
- start：operator；scheduled、work_state=not_started；記錄 started_at，work_state=in_progress。
- inspection publish：只可已 start 的檢查／第二意見；發布 findings；不將 findings 當完成更換。
- complete：operator；必須已 start、有完整 completion、證據、所有施工行已批准；檢查單須已發布 report；status=completed、work_state=completion_submitted。
- confirm_completion：owner；確認提交報告，單一 transaction 同步 history、reminders、commission；重試不重複。
- dispute：owner；submitted/confirmed 可開 case；保留原報告，未確認的不算成功完成，已確認的佣金先 freeze/review。
- cancel：未 start 可取消並釋放 slot；start 後不能用普通 cancel，須 case／停工流程由車主確認已完成項及費用，禁止以取消掩蓋施工。
- decline：operator；new/quoted。未接受報價不可以施工。

v1 未完成單不自動升級：已批准自由文字 quote 無 canonical keys，保留原價與批准證據；要求車行提交明確完成項目並讓車主確認映射後才同步 scope。無法可靠映射的只保存歷史，不清除提醒。v1 已完成單只讀，不能事後宣稱經 v2 驗證。

## 8. 三端畫面與必要欄位

| 畫面／位置 | 內容及操作 | 必備狀態 |
|---|---|---|
| 車主護照 | 歷史未知 CTA、最近檢查結果、下次建議、服務記錄來源 | unknown/inspection normal/maintenance done 分別顯示 |
| 三種服務入口 | 名稱、適用情境、內容、MOP、時間、車行、可約時段 | 無資料／不適用／需確認，不顯示假價錢 |
| 建立請求 | 車輛、服務、車行分店、姓名電話、備註、授權內容 | 提交中／重試／成功導向詳情 |
| 車主訂單詳情 | 時間軸、逐行報價／選擇、批准總額、slot、report、changes、照片、完成及售後 | 已拒／待批／已批准清楚區分 |
| 車商工作台 | 新請求、待報價、今日預約、施工中、待批准、待交付 | role=viewer 無寫按鈕；只取所選 dealer |
| 車商檢查表 | 七項結果、讀數單位、說明、照片、實際里程、發布 | 自動保存草稿提示；離頁未存警告；version conflict |
| 車商施工單 | order number、車輛、已批准項、追加、開始／完成 | 未批准行不可施工提交 |
| 車商完工表 | 完成／未做、零件、人工價顯示、里程、時間、照片、下次建議、保固 | 缺欄位定位；總價 server 算 |
| 車商設定 | 邀請／服務／分店／時段 | draft/active/incomplete setup |
| Admin | 車行啟停、成員邀請、全部單、案件、線下收款、佣金匯出／結算 | 所有介入有 actor/reason/time |

以新 `assets/service-*.js/css` 模組承載；index.html 只加 route mount/import，保留現有 selector 降低測試衝突。先做好 390px 手機和 desktop；不新增框架。表單每個 input 有 label，錯誤可讀、操作可鍵盤、按鈕不重複提交。商城 order routes 和 service order routes 不能共用 ID 或命名混淆。

## 9. 分工、依賴與可以直接照做的任務

| 任務 | 檔案 ownership | 前置 | 完成定義 |
|---|---|---|---|
| T0 基線／隔離 | history.js、trips.js、auth/authorization tests | 無 | scope leak 修復；dirty edits 清單確認；測試 DB 隔離 |
| T1 migration | 新 db/service-mvp-schema.sql、scripts/migrate.js、db.js | T0 | 單一 runner、ledger、舊 schema fixtures migration 通過；prod request 不 DDL |
| T2 order domain | requests.js、service-records.js、新 _lib/service-orders.js | schema 合約確定 | 原流程保留；逐行批准／開始／完成／重試／v1 相容 |
| T3 inspections | 新 _handlers/inspections.js、shared/inspection-templates.js | T1/T2 合約 | 三種 offer、報告、follow-up、分清 inspection 與 replacement |
| T4 booking/change | 新 _lib/bookings.js、_handlers/service-changes.js | T1/T2 | slot race／改期／追加批准全測通過 |
| T5 evidence/completion | 新 _lib/evidence.js、completion 模組 | T2/storage | 真圖片 upload/download ACL；完成只寫批准實作 keys |
| T6 financial/support | 新 _handlers/service-operations.js | T2 完成 hook | 線下付款、來源、0% pilot、CSV、refund ledger、cases、站內通知 |
| T7 owner/dealer UI | assets/request-flow.js、新 service UI modules、passport.js | T2–T6 API 合約 | 全程用表單操作可成交，手機可用 |
| T8 integration | index.html、api/index.js、dev-server.js、route tests、docs/API.md | 各模組輸出 | dev/prod 路由一致；各端角色正確 |
| T9 release | runbook、staging verification、production smoke | 所有硬門檻 | 一宗 staging 全 UI 成交＋production 小量人工驗收 |

平行工作只在不同檔案，shared types/schema/API payload 先固定。資料庫／order domain／整合由同一負責人控制。每個 commit 能獨立 review；不得把商城現有修改混入 service MVP commit。若只有一名執行者，按 T0→T1→T2→T3→T4→T5→T6→T7→T8→T9 執行，無法假設表格的平行時數仍成立。

## 10. 明天上線排程與取捨

下面是有兩名以上實作者＋一名整合／驗收者時的積極排程，並非保證。使用開始後相對時間，H+24 必須落在 9/23 已確認的上線窗口；不足 24 小時就縮小試點範圍，不縮減安全門檻。

| 時間 | 交付／決策 |
|---|---|
| H0–H2 | 讀現有未提交變更、P0 修復、確認車行／價格／收款／測試環境／private storage；固定 schema/API 合約 |
| H2–H6 | additive migration、v2 order/quote approval、共用 history transaction；UI 同步按固定合約開工 |
| H6–H10 | baseline/second opinion checklist、follow-up、slots、追加審批 |
| H10–H14 | 私有圖片、completion、護照／reminders、基本 payment/commission/cases/notifications |
| H14–H18 | 三端接通，實際手機表單流程；Admin onboarding、案件及匯出 |
| H18–H21 | staging 真實 DB／storage、並發與權限測試、migration/rollback 演練 |
| H21 | go/no-go；必須全部核心驗收通过 |
| H21–H24 | production migration、部署 pilot flag 關閉→smoke→只開指定車行，車主與車行一起完成一次受控驗收 |

超時時可以延後的自動化：循環排班→手動具體 slots；Email→站內通知＋人工電話；結算→CSV＋人工；退款→人工退款後記錄金額證據；checklist 編輯器→versioned config；車行公開申請→Admin 邀請；AI 報告→確定性摘要；複雜推薦→既有 fitment＋透明價格／時間顯示。三個服務入口共享同一引擎，第二意見僅多原報價附件／問題欄位，避免建立第三套流程。

不可延期的項目：資料隔離、批准範圍、追加禁止未批施工、完整檢查報告、私有證據、真實完成映射、付款狀態與工程狀態區分、交易重試安全、實際 UI 驗收、可停止新接單。若任何一项未通過，9/23 只能交付可演示 staging，不宣稱 production ready。

## 11. 測試與驗收資料

不直接在 `.env` 指向的未知 DB 跑現有 E2E：部分 helper 會 seed/delete。先新增 TEST_DATABASE_URL，驗證測試 project/host 與 production 不同，測試用唯一 run_id fixture；不刪既有資料。現有測試仍屬回歸基線，先保存結果再修改。

必要測試：

1. Admin UI 建車行→邀請→車商建立帳號→publish offer→開 slots；一般 user 不能自訂 admin／dealer membership。
2. 車主 UI 新建 Corolla Cross、歷史未知→28000/45min 的已配置 baseline→接受檢查費→選 slot→車商填七項→發布報告→完工→車主確認。normal 檢查不得改 last_done。
3. 報告建議三項→車主選兩項→maintenance 報價→只批准兩項→第三項追加被拒→車商不能把第三項寫 completed／計費。
4. 完工含 42680 km、before/after、實際零件、時間、parts/labour；車主確認後只有實作 keys 更新、history 有 source/dealer/service_keys，未做項保持待處理。
5. 第二意見上傳原報價、檢查結果可「暫不需要維修」，仍可完成檢查訂單。
6. 兩個車主搶 capacity=1 slot：只有一人成功；改期失敗舊預約仍有效。
7. 雙擊接受／完成／付款：各只有一筆批准、history、commission、payment event；同 key 異 payload 409。
8. expired quote／stale version／跨車行附件／已撤回 grant／停用 dealer／viewer 寫入／自買自批均被拒。
9. 免費期、dealer_existing、unknown origin、正常佣金、退款沖回、重複結算，金額全部正確。
10. owner A 無法從 recent history/list/detail/images/notifications 讀 B 資料；匿名亦不可。
11. 已有 v1 requests、手動 history、vehicle-sharing、shop、register/login 回歸；無 selector/route break。
12. Email/AI 失敗不阻止保存已批准訂單；storage finalize 失敗不得發布缺照片報告；DB transaction 失敗不得留下半筆完工。

UI 主流程一定用 click/fill/submit 推進，不以 page.evaluate(fetch) 取代所有關鍵動作。API test 驗 concurrency/ownership；unit test 驗 money/state/template。測試附 trace、run ID、migration version、commit SHA，不能用未執行的測試檔存在充當驗證通過。

## 12. 生產部署與回復操作

1. 確認 host/project、Node runtime、DB/Storage 與 secret 配置；只輸出變數名稱／是否存在，不輸出值。重用現有 auth secret；新增 SERVICE_MVP_ENABLED=false、SERVICE_MVP_DEALER_IDS、DB_AUTO_MIGRATE=false、DEMO_SEED_ENABLED=false 及 storage adapter 設定。名稱為新規格，須實作後才生效。
2. 建立可還原 DB backup／確認 PITR 能力，在 staging 用同基線演練 migration。新表只 additive，不 DROP 既有資料；既有 SQL 重跑的 constraint 影響也要驗證。
3. 部署具明確 migration 支援的版本，離線跑 migration runner，readiness 檢查 expected schema version；production handler 不會因缺 schema 自動建表。
4. 加入 orders、attachments、slots 等路由於同一 API entry，檢查 Vercel packaging 包含 shared template/config，local/serverless 一致。
5. smoke：登入三身份、建立／讀回 draft、私人圖片、報價批准、slot、完成紀錄；用經同意的 pilot 測試資料，清楚標測試且免佣，不向真客寄試驗訊息。
6. 開指定車行 feature flag，先 1–3 位受控車主，再最多 30 單。新 request 帶 workflow_version=2；其餘維持原流程。
7. 監控 server error、transaction rollback、attachment failure、卡在待批准/待確認的單、double booking、history/commission reconciliation。每宗 confirmed request 必須有唯一 completion/history；每日對帳由 Admin 看缺漏列表。
8. 回復：先關新接單 flag，但保留已接 v2 單讀寫支援及歷史；如錯誤影響寫入，切 maintenance/read-only 並人工聯絡進行中單。不能直接回退到不懂 v2、且會在 cold start 重跑舊 DDL 的版本；準備兼容 schema 的 rollback build。保留新增 schema；修復後按事件／idempotency replay，禁止刪訂單「重來」。

## 13. 上線前業務資料交接

Admin／營運需要提供或填好：真實車行名稱及聯絡、分店地址、負責人 email、服務範圍、baseline checklist 確認、三服務價格策略、預約時段、技師操作負責人、收款方法、取消／no-show 處理、工藝／零件保固文字、售後聯絡、來源歸屬標準、pilot 免佣條款。這些缺失不阻止開發，但對應 offer 必須 draft，不能公開接單。

所有驗收通過後，明天可對外描述為：「建立車輛護照、預約檢查、查看有證據的檢查結果、批准維修與追加、追蹤完成紀錄」；只有已實際啟用的收款／通知方式可宣稱。推薦不讀佣金率或商業條款作排序；價格、時間未確認就標明，品質沒有足夠成交資料時不捏造評分。

## 14. 下一階段完整產品範圍

受控試點穩定後按真實工單完善：循環排班／技師資源／no-show、Email outbox 自動重試及監測、線上支付和 provider webhook／refund 對帳、自動結算、車行自助申請／文件審核、checklist Admin 編輯／版本發布、部件多行明細與分批完工、多分店人員精細權限、品質評價及可解釋排序、保固到期規則、資料保留政策／附件 lifecycle。每項先延用本計劃的主訂單、批准行、證據和 ledger，不再建立第二套平行交易模型。
