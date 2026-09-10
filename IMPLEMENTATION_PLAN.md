# CarAI Agent + Research MCP Implementation Plan

## 1. Goal

Add a server-side CarAI agent that can:

- Understand the user's vehicles, maintenance records, reminders, trips, and preferences.
- Call safe, validated application tools.
- Research unknown vehicle models through an external Research MCP server.
- Read vehicle photos and prefill the add-car form.
- Explain tool activity, sources, confidence, and uncertainty.
- Ask for confirmation before changing user data.

The existing vanilla `index.html`, Vercel serverless API, custom session authentication, and Supabase/Postgres persistence remain in place.

## 2. Target architecture

```text
Vanilla chat UI
  -> POST /api/agent
  -> ToolLoopAgent
  -> app tools + Research MCP tools
  -> Supabase/Postgres
  -> streamed response, tool activity, sources, or confirmation request
```

The AI key and Research MCP credentials must remain server-side. The browser must never receive them.

Use the Vercel AI SDK `ToolLoopAgent` for the multi-step tool loop. Use the AI SDK MCP client to connect the Research MCP server. For Vercel, prefer MCP Streamable HTTP rather than a local `stdio` process.

## 3. Phase 0 — prerequisites and provider verification

1. Confirm the configured AI model supports tool calling.
2. Confirm the configured AI model supports image input for vehicle photos.
3. Confirm the Research MCP server provides a reachable Streamable HTTP endpoint.
4. Identify the MCP tools that are approved for automotive research.
5. Verify the latest compatible versions of `ai`, `@ai-sdk/mcp`, the provider adapter, and `zod` before installing them.
6. Keep the existing direct `/api/ai` endpoint temporarily for backward compatibility while the agent endpoint is tested.

Required server environment variables:

```text
AI_API_KEY
AI_BASE_URL
AI_MODEL
RESEARCH_MCP_URL
RESEARCH_MCP_TOKEN
RESEARCH_MCP_ALLOWED_TOOLS
RESEARCH_MCP_TIMEOUT_MS
```

## 4. Phase 1 — agent foundation

Add:

```text
api/agent.js
api/_lib/agent.js
api/_lib/research-mcp.js
api/tools/vehicles.js
api/tools/maintenance.js
api/tools/trips.js
api/tools/profile.js
api/tools/research.js
```

`api/agent.js` should:

- Accept authenticated chat messages and a thread ID.
- Load only the current user's relevant context.
- Create or reuse the agent thread.
- Run the agent with a bounded step count and timeout.
- Stream text, tool calls, tool results, errors, and confirmation requests.
- Persist the run and tool activity.

## 5. Application tools

### Read-only tools

- `list_my_vehicles`
- `get_vehicle_status`
- `get_service_history`
- `get_upcoming_reminders`
- `get_recent_trips`
- `get_user_preferences`

### Write tools

- `add_vehicle`
- `update_vehicle`
- `create_service_record`
- `create_trip`
- `create_support_ticket`
- `update_notification_preferences`

Every tool must validate its input schema, enforce the authenticated user's ownership, and return a small structured result. The agent must not receive unrestricted SQL access.

## 6. Research MCP adapter

Implement the MCP connection in `api/_lib/research-mcp.js`.

The adapter must:

1. Connect using `RESEARCH_MCP_URL` and server-side authentication.
2. Discover tools from the MCP server.
3. Allow only tools listed in `RESEARCH_MCP_ALLOWED_TOOLS`.
4. Namespace tools to avoid collisions, for example:
   - `research.search`
   - `research.open_source`
   - `research.extract_vehicle_specs`
5. Convert MCP tool schemas into AI SDK tools.
6. Normalize results into `{ title, url, source, retrieved_at, content }`.
7. Reject oversized, malformed, or non-approved results.
8. Close connections cleanly and use timeouts suitable for serverless execution.

Do not expose arbitrary MCP tools to the model. MCP tools and returned content are external and untrusted.

## 7. Vehicle photo and unknown-model workflow

The flow should be:

1. User selects a vehicle photo.
2. Vision AI extracts make, model, year, fuel type, plate only when visible, and confidence.
3. The UI shows the extracted fields for confirmation.
4. If the model matches an existing preset, use the preset.
5. If it does not match, the agent calls the Research MCP.
6. Research official manufacturer pages, manuals, or trusted automotive sources.
7. Extract specifications and maintenance intervals with source URLs and dates.
8. Show the findings, confidence, conflicting sources, and uncertainty.
9. Ask the user before saving the vehicle and specifications.

If research fails or confidence is low, keep the manual text form available and clearly label the result as unverified.

## 8. Database schema

Add the following tables to the Postgres schema:

### Agent persistence

`agent_threads`

- `id`
- `user_id`
- `title`
- `created_at`
- `updated_at`

`agent_messages`

- `id`
- `thread_id`
- `role`
- `parts JSONB`
- `created_at`

`agent_runs`

- `id`
- `thread_id`
- `user_id`
- `model`
- `status`
- `started_at`
- `completed_at`
- `token_usage JSONB`
- `error`

`agent_tool_calls`

- `id`
- `run_id`
- `tool_name`
- `input JSONB`
- `output JSONB`
- `status`
- `requires_confirmation`
- `confirmed_at`
- `error`
- `created_at`

### Research persistence

`research_runs`

- `id`
- `user_id`
- `query`
- `status`
- `created_at`
- `completed_at`

`research_sources`

- `id`
- `research_run_id`
- `title`
- `url`
- `source_name`
- `published_at`
- `retrieved_at`
- `content_hash`
- `content JSONB`

`vehicle_specs`

- `id`
- `vehicle_id`
- `make`
- `model`
- `year`
- `variant`
- `specs JSONB`
- `confidence`
- `source_urls JSONB`
- `source_names JSONB`
- `fetched_at`
- `verified_at`

Enable RLS on all new tables. Because this app currently uses custom JWT sessions rather than Supabase Auth, API-level ownership checks remain mandatory.

## 9. Confirmation and safety

The agent must request confirmation before:

- Saving or editing a vehicle.
- Saving researched specifications.
- Creating a service record.
- Saving a trip.
- Creating a support ticket.
- Changing notification preferences.

Add these controls:

- Maximum agent steps per request.
- Per-tool timeout.
- Rate limiting for AI and research calls.
- Audit logging for every tool call and write.
- No invented specifications, maintenance history, prices, or safety conclusions.
- Source and retrieval-date display for research results.
- Cancel and retry controls.

## 10. Frontend work

Add an agent panel reachable from:

- `首頁`
- `我的車`
- Service page
- Trip page
- Vehicle detail page

The UI should show:

- Conversation messages.
- “正在查詢車輛資料” and similar progress states.
- Tool calls and their results.
- Research source cards.
- Confirmation cards with Confirm and Cancel buttons.
- Errors with Retry.
- Empty and unauthenticated states.

Keep the current vanilla JavaScript frontend initially. If the chat UI later moves to React, use the AI SDK `useChat` transport and typed agent messages.

## 11. API routes

Add:

```text
POST /api/agent
GET  /api/agent/threads
GET  /api/agent/threads/:id
POST /api/agent/threads/:id/confirm
POST /api/agent/threads/:id/cancel
POST /api/agent/vehicle-research
```

Existing routes remain the source of truth for direct vehicle, reminder, trip, profile, and admin operations.

## 12. Implementation order

1. Add and verify AI SDK/provider dependencies.
2. Add agent persistence tables and ownership checks.
3. Implement read-only vehicle and maintenance tools.
4. Implement `/api/agent` with a single vertical slice.
5. Add the chat panel and tool activity rendering.
6. Add confirmation-gated write tools.
7. Add MCP connection and research tools.
8. Add vehicle photo identification and unknown-model research.
9. Add source cards, caching, audit records, and rate limits.
10. Deploy to Vercel and verify Supabase-backed production behavior.

## 13. Verification checklist

- Ask: “我的車需要做甚麼？” and verify vehicle status/history tools are called.
- Ask a question requiring two tools in sequence.
- Add a vehicle by manual text and cancel the confirmation.
- Add a vehicle by photo and verify fields are prefilled.
- Test a known preset model.
- Test an unknown model and verify Research MCP sources appear.
- Test conflicting or unavailable research.
- Confirm an action and verify the database row and audit log.
- Try to access another user's vehicle and verify denial.
- Test unauthenticated, timeout, provider failure, MCP failure, retry, and cancel states.
- Verify local and live Vercel deployments.

## 14. 車商後台 / Dealer Portal

### Goal

Allow an admin to create and manage approved 車商 accounts. Each 車商 can configure branches, services, supported vehicle fitments, pricing, and service requests. Users can select a 車商 for a vehicle and see only services that match their vehicle and current maintenance needs.

Do not reuse the existing `teams` and `team_members` tables. Those represent family/company vehicle sharing. 車商 requires a separate tenant model.

### Roles

- `admin`: creates, activates, suspends, and edits 車商 records; can manage all catalog and members.
- `dealer_owner`: manages one 車商 profile, branches, staff, services, fitments, and requests.
- `dealer_manager`: manages catalog, fitments, and requests but cannot delete the 車商.
- `dealer_staff`: views matched vehicles and manages assigned requests.
- `dealer_viewer`: read-only access.

Keep the existing application-level `users.role` for `admin`/`user`. Store 車商-specific roles in `dealer_members`, so one user can belong to multiple 車商.

### Database schema

`dealers`

- `id`
- `legal_name`
- `display_name`
- `registration_number`
- `phone`
- `email`
- `website`
- `status` (`draft`, `active`, `suspended`)
- `created_by_user_id`
- `created_at`
- `updated_at`

`dealer_branches`

- `id`
- `dealer_id`
- `name`
- `address`
- `district`
- `latitude`
- `longitude`
- `phone`
- `opening_hours JSONB`
- `is_active`

`dealer_members`

- `dealer_id`
- `user_id`
- `role`
- `created_at`
- Primary key: (`dealer_id`, `user_id`)

`dealer_invites`

- `id`
- `dealer_id`
- `email`
- `role`
- `token_hash`
- `expires_at`
- `accepted_at`
- `created_by_user_id`

`service_item_types`

- `key` — canonical key such as `engine_oil`, `oil_filter`, `brake_fluid`, `brake_pads`, `coolant`, `spark_plugs`
- `category`
- `display_names JSONB`
- `is_active`

This is the shared vocabulary used by the app, users, AI normalization, and 車商 catalog. Existing `vehicle_status.item` values should gain a nullable `service_item_type_key` and be backfilled from known Chinese/English aliases.

`dealer_service_items`

- `id`
- `dealer_id`
- `service_item_type_key`
- `name`
- `description`
- `interval_km`
- `interval_months`
- `price_min`
- `price_max`
- `currency`
- `is_active`
- `created_at`
- `updated_at`

`dealer_item_fitments`

- `id`
- `dealer_service_item_id`
- `market`
- `make_norm`
- `model_norm`
- `year_from`
- `year_to`
- `variant_norm`
- `fuel_type_norm`
- `engine_code`
- `vin_prefix`
- `source_urls JSONB`
- `notes`

`dealer_service_packages`

- `id`
- `dealer_id`
- `name`
- `description`
- `price`
- `currency`
- `is_active`

`dealer_package_items`

- `package_id`
- `dealer_service_item_id`
- Primary key: (`package_id`, `dealer_service_item_id`)

`dealer_service_requests`

- `id`
- `dealer_id`
- `branch_id`
- `user_id`
- `vehicle_id`
- `service_item_type_key`
- `package_id`
- `status` (`new`, `accepted`, `scheduled`, `completed`, `cancelled`)
- `message`
- `scheduled_at`
- `created_at`
- `updated_at`

`vehicle_item_matches`

- `id`
- `vehicle_id`
- `dealer_id`
- `dealer_service_item_id`
- `match_score`
- `match_level` (`exact`, `likely`, `review`)
- `match_reason JSONB`
- `algorithm_version`
- `calculated_at`

Use a unique constraint on (`vehicle_id`, `dealer_service_item_id`) and recalculate when the vehicle profile, vehicle status, catalog item, or fitment changes.

### Admin UI

Add an admin `車商` page with:

1. 車商 list: name, status, branches, staff count, catalog coverage, last updated.
2. Add 車商 wizard:
   - Business profile
   - First branch
   - First 車商 owner invite
   - Initial service catalog
   - Vehicle fitment rules
3. 車商 detail tabs:
   - Overview
   - Branches
   - Members and invitations
   - Services and packages
   - Vehicle fitments
   - Service requests
4. Activate/suspend controls with confirmation.
5. Catalog coverage warning when a 車商 has services but no vehicle fitment rules.

### 車商 UI

The 車商 user sees:

- Dashboard with new requests and upcoming appointments.
- Business profile and branch editor.
- Service catalog editor.
- Fitment editor with make/model/year/variant/fuel filters.
- Matched vehicle view showing why each service matched.
- Request workflow: accept, schedule, complete, cancel.

車商 users must never see vehicles or user data outside their own dealer relationship or a service request.

### Normal user UI

On vehicle detail and maintenance pages:

- `選擇車商` control.
- Matched service cards with `適用`, `可能適用`, or `未設定` status.
- Current need, last completed service, dealer service name, price range, and branch.
- `發送服務請求` action.
- Source/fitment explanation when the match is based on a model rule.

The user should not see unrelated catalog items as if they are required. A generic service may be shown only when it is both applicable to the vehicle and relevant to the vehicle's current status or user request.

### User flow

1. Admin creates a 車商 and invites the 車商 owner.
2. 車商 owner accepts the invite and configures branches and services.
3. 車商 maps each service to canonical item keys and adds supported vehicle fitments.
4. User opens a vehicle and selects or searches for the 車商.
5. The server normalizes the user's vehicle profile and existing maintenance items.
6. The matcher finds applicable catalog items and packages.
7. The UI explains the match and shows current maintenance status.
8. User sends a request; the 車商 accepts and schedules it.
9. Completion creates a service-history record and refreshes the vehicle status.

### Matching algorithm

Use deterministic matching for final eligibility. AI may extract fields from photos, map aliases, or explain results, but it must not decide that an item fits without the rules passing.

#### Step A: Normalize vehicle identity

Create a normalized profile:

```text
make_norm
model_norm
year
variant_norm
fuel_type_norm
engine_code
market
vin
```

Normalize casing, punctuation, Chinese/English aliases, trim levels, fuel names, and common model naming differences. Keep the raw values for display.

#### Step B: Normalize maintenance items

Map user status strings to canonical keys:

```text
機油 -> engine_oil
機油隔 / 機油濾芯 -> oil_filter
煞車油 -> brake_fluid
煞車皮 -> brake_pads
冷卻液 -> coolant
火花塞 -> spark_plugs
```

If a value cannot be mapped confidently, mark it `review` instead of silently matching it.

#### Step C: Filter candidates

Reject a catalog item when:

- The 車商 or item is inactive.
- The fitment explicitly conflicts with make, model, year, fuel, engine, market, or VIN prefix.
- The canonical service item does not match the user's item or request.

Then rank remaining candidates by fitment specificity:

1. Exact VIN prefix or exact vehicle variant.
2. Exact make + model + year + variant.
3. Exact make + model + year.
4. Make + model with year range.
5. Make-level or generic service rule.

Suggested match levels:

- `exact`: 90–100 — safe to display as applicable.
- `likely`: 70–89 — display with a review label.
- `review`: below 70 or conflicting data — ask the user or admin to confirm.

The score is an explanation and ranking mechanism, not permission to perform a repair automatically.

#### Step D: Merge current vehicle status

Example: a user's Corolla Cross has `機油及機油隔` needing attention.

- Split it into `engine_oil` and `oil_filter`.
- Match each key to the 車商 catalog.
- If the 車商 has a package containing both items and compatible Corolla Cross fitment, show the package as an exact match.
- If only `engine_oil` is configured, show a partial match and identify the missing `oil_filter` service.
- If the user has `brake_fluid` marked normal, show it only as an available matching service, not as an urgent recommendation.
- If the user's vehicle needs an item that the 車商 has not configured, show `車商尚未設定此項目`, not a false negative or false positive.

#### Step E: Cache and explain

Persist the result in `vehicle_item_matches` with:

- matched keys
- fitment fields used
- score and match level
- algorithm version
- calculation timestamp

Every UI match should be explainable, for example: `Toyota Corolla Cross / 2021 / Hybrid matched exact model-year fitment; service key matched oil_filter.`

### Dealer API routes

```text
GET    /api/admin/dealers
POST   /api/admin/dealers
GET    /api/admin/dealers/:id
PATCH  /api/admin/dealers/:id
POST   /api/admin/dealers/:id/invites
GET    /api/dealer/me
PATCH  /api/dealer/me
GET    /api/dealer/services
POST   /api/dealer/services
PATCH  /api/dealer/services/:id
GET    /api/dealer/fitments
POST   /api/dealer/fitments
PATCH  /api/dealer/fitments/:id
GET    /api/vehicles/:id/dealer-matches
POST   /api/vehicles/:id/service-requests
GET    /api/dealer/service-requests
PATCH  /api/dealer/service-requests/:id
```

### Security and Supabase notes

Enable RLS on all dealer, catalog, match, and request tables. Add indexes on `dealer_id`, `user_id`, `vehicle_id`, canonical item keys, and the main fitment columns. The current application uses custom JWT sessions, so each API route must still perform explicit membership and ownership checks.

If any future client accesses these tables through the Supabase Data API, explicitly expose/grant them and keep RLS enabled; new public tables are no longer automatically exposed by default in current Supabase projects.

### Dealer verification checklist

- Admin can create, activate, suspend, and invite a 車商 owner.
- Dealer owner can edit only their own dealer catalog.
- Dealer staff cannot see unrelated user vehicles.
- User sees only applicable services for the selected vehicle.
- Exact and generic fitments produce different match explanations.
- Partial package matches are clearly labeled.
- Unknown vehicle identity produces `review`, not an automatic offer.
- Service completion updates the vehicle's service history and status.
- Cross-user and cross-dealer access attempts are denied and audited.
