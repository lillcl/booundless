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

Not yet created: vehicle_needs, quotes/quote_items, request_events, matching_runs, campaigns, integrations, attribution_sessions and conversion_events. Their proposed shapes remain in the implementation plan and must not be treated as deployed schema.

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

## Data Integrity / Security
- Ownership:
- RLS / permissions:
- Sensitive fields:
- Retention / deletion:
