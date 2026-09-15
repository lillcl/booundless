# DATABASE_SCHEMA.md

Canonical source of truth for database structure.

## Merchant and marketing additions — 2026-09-13

Source migrations: `db/merchant-v2-schema.sql` and `db/marketing-schema.sql`. Both are idempotent additive SQL files, loaded after `db/schema.sql` by the existing `getDb()` bootstrap. Verified against an isolated UTF-8 local Postgres database; production application is not verified. Existing merchant tables remain defined in `db/schema.sql` (dealers, branches, members, invites, catalogue, offerings, fitments, packages, requests and legacy matches).

### dealer_branch_services

| Field | Type | Null/default | Constraints / meaning |
| --- | --- | --- | --- |
| branch_id | text | NOT NULL | FK dealer_branches(id), ON DELETE CASCADE |
| service_id | text | NOT NULL | FK dealer_service_items(id), ON DELETE CASCADE |
| is_active | boolean | NOT NULL / true | Whether offering participates in matching |

Composite primary key (branch_id,service_id). Partial index `dealer_branch_services_service(service_id) WHERE is_active` supports candidate lookup. Same-merchant ownership is enforced by the server transaction, not a composite database FK. New initial branch links to services selected during merchant creation. Existing branches are deliberately not auto-assigned all services; an owner/manager configures them in the portal. PUT replacement deletes associations for that branch then inserts selected ones atomically; services themselves are retained.

### marketing_pages

| Field | Type | Null/default | Constraints / meaning |
| --- | --- | --- | --- |
| path | text | NOT NULL | PK; CHECK path IN ('/','/demo') |
| draft | jsonb | NOT NULL / {} | Validated metadata draft, never served publicly |
| published | jsonb | nullable | Published metadata; null uses template defaults |
| version | integer | NOT NULL / 0 | Incremented on draft save, publish or rollback |
| updated_by | text | nullable | FK users(id), ON DELETE SET NULL |
| updated_at | timestamptz | NOT NULL / NOW() | Last mutation time |

Seed inserts only `/` and `/demo`, with ON CONFLICT DO NOTHING, preserving edits. No arbitrary public slugs yet. Draft and published JSON fields: title, description, social_title, social_description, image, image_alt strings and indexable boolean. Detailed string lengths and URL validation live in the API dictionary and `api/_lib/marketing.js`; JSON shape is validated at the API layer, not a JSON-schema DB check.

### marketing_revisions

| Field | Type | Null/default | Constraints / meaning |
| --- | --- | --- | --- |
| id | bigserial | NOT NULL / sequence | PK publication identifier |
| page_path | text | NOT NULL | FK marketing_pages(path), default NO ACTION |
| content | jsonb | NOT NULL | Validated immutable publication snapshot |
| actor_id | text | nullable | FK users(id), ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL / NOW() | Publication time |

Index `marketing_revision_page(page_path,id DESC)`. API exposes no revision edit/delete; database owner remains technically able to change rows. Rollback copies the selected old snapshot into a new revision and updates the page; it does not delete history. Draft saves do not create publication revisions.

### Security and lifecycle

All three new tables enable RLS and revoke PUBLIC access; conditional revocations cover Supabase anon/authenticated roles when they exist. There are no direct-client policies: access is through the privileged server using existing custom-session DB role/membership gates. Public renderer selects only published metadata. Actor IDs are retained until user deletion, then set null.

Legacy `vehicle_item_matches` is retained for compatibility/history, but the matching GET no longer writes it. No production rows are deleted by these migrations. Draft merchant creation now transacts dealer+services+initial branch+associations together. New merchants always begin as draft; activation is validated by the server.

Rollback procedure: first revert dependent application code and remove new public rewrites/bootstrap imports, then back up the three tables. Drop new tables only after explicit approval and backup, in dependency order (marketing_revisions, marketing_pages, dealer_branch_services). Code-only rollback may leave additive tables safely in place. Existing dealer/vehicle data is not part of rollback deletion.

### Workflow extension — db/workflow-schema.sql (2026-09-14)

This additive bootstrap follows the merchant and marketing SQL files. All new tables enable RLS and revoke PUBLIC/anon/authenticated access; privileged server handlers enforce ownership and membership. SQL is the authoritative field-level definition.

| Table / extension | Keys, data and constraints |
|---|---|
| vehicle_needs | Composite PK vehicle_id/service_key; vehicle FK cascade, canonical service FK; required state confirmed/dismissed/resolved, urgency routine/soon/urgent, source default owner, updated_at default now |
| dealer_request_items | Composite PK request_id/service_id; request FK cascade, service and canonical key FKs; required name snapshot |
| dealer_quotes | UUID PK; request/user FKs; unique request_id/version; required currency MOP/HKD/CNY, JSONB items, nonnegative integer total_minor, expires_at; nullable accepted_at; created_at default now |
| dealer_request_events | Bigserial PK; required request/user FKs and action; created_at default now |
| marketing_integrations | Boolean singleton PK constrained true; config JSONB defaults disabled; version defaults 0; nullable updated_by FK; updated_at default now |
| conversion_events | UUID PK; user FK cascade; required event_name/business_id; unique event_name/business_id; source/campaign default empty; created_at default now |
| dealer_service_requests | version default 0, nullable completion_confirmed_at/request_key/request_fingerprint; partial unique user_id/request_key when nonnull; status adds quoted/accepted/declined |
| dealer_service_items | compatibility_mode required default unverified; constrained unverified/restricted/universal |
| dealer_invites | delivery_status required default not_sent; nullable delivery_id |
| marketing_pages | Path constraint extends to clean /campaigns/:slug; campaign copy lives in draft/published JSON and publication revisions |

Quote line items use JSONB (not a quote_items table), validated by the server as descriptions and integer minor-unit amounts. Request mutation locks rows and checks version. Completion confirmation creates deterministic service-history IDs, preventing duplicate history. Conversion ingestion prunes events older than 90 days; this is ingestion-triggered rather than a scheduled deletion guarantee. Browser attribution expires after 30 days. No vehicle details are sent to advertising providers.

Rollback: revert dependent application code first; leave additive tables/columns in place. Back up before any explicitly authorized removal. Quote/event FKs intentionally prevent deleting referenced business records. Do not restore the old request-status/path constraints while expanded statuses/campaigns remain.

Not created: matching_runs, standalone campaigns, attribution_sessions or scheduling-slot tables. Campaigns and integrations use the concrete tables above; distance, slot inventory and Meta remain outside this release.

## WeChat Mini Program additions — 2026-09-14

Source migration: `server-patch/db/migrations/2026_09_wechat_columns.sql`. Additive; nullable; non-destructive. Verified against the same isolated Postgres used for the workflow extension.

### `users` — six new columns

| Field | Type | Null/default | Constraints / meaning |
| --- | --- | --- | --- |
| wechat_openid | text | nullable | App-scoped openid from `jscode2session`; partial unique index `idx_users_wechat_openid_unique(wechat_openid) WHERE wechat_openid IS NOT NULL` |
| wechat_unionid | text | nullable | Cross-app union id when developer has unified accounts; partial index `idx_users_wechat_unionid(wechat_unionid) WHERE wechat_unionid IS NOT NULL` |
| wechat_appid | text | nullable | Which mini-program / public-account issued the openid; useful when multiple apps share a users table |
| nickname | text | nullable | Display name from `wx.getUserProfile`; falls back to `display_name` when empty |
| avatar_url | text | nullable | Avatar URL; same source |
| phone | text | nullable | Reserved for future phone-binding flow |

Existing `users.email` retains its UNIQUE constraint and remains required; the WeChat handler stores a synthetic email (`wx_<openid>@wechat.local`) on insert so the legacy schema accepts the row without dropping the NOT NULL constraint. Synthetic emails are stable per openid and never collide.

Rollback: drop the six columns. No data loss; existing rows have NULL in the new fields. Drop the partial indexes if you also drop the columns.

## Internal-only correction

marketing_integrations.config stores enabled and promotions (dealer_id, starts_at, ends_at). Legacy external IDs are ignored, never returned and replaced on admin save. Existing conversion_events is retained for history; browser measurement is disabled. SEO tables are unchanged; no destructive migration is required.

## Rules
- No agent invents DB field/table names without updating this document.
- Every schema change requires migration + documentation.
- Record constraints, indexes, defaults, nullability, relationships, ownership, and rollback.

## Tables
### `<table_name>`
| Field | Type | Required | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | uuid | Yes | generated | PK | Canonical identifier |

## Relationships
- `<table_a.field>` → `<table_b.id>`

## Indexes
- `<index_name>`: `<fields>` — reason

## Migrations
| Version | Migration | Status | Agent Signature |
|---|---|---|---|
| 001 | Initial schema | Pending | — |
| 002 | Merchant v2 + Marketing (`db/merchant-v2-schema.sql`, `db/marketing-schema.sql`) | Applied | unassigned |
| 003 | Workflow extension (`db/workflow-schema.sql`) | Applied | unassigned |
| 004 | WeChat Mini Program columns (`server-patch/db/migrations/2026_09_wechat_columns.sql`) | Pending | Lead / Orchestrator |

## Data Integrity / Security
- Ownership:
- RLS / permissions:
- Sensitive fields:
- Retention / deletion:
