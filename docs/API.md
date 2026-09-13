# API.md

Canonical API contract.

## Merchant and marketing delivery — 2026-09-13

Implemented routes below describe code, not a confirmation that production migrations have run. Remaining plan phases are tracked in `MERCHANT_MATCHING_MARKETING_PLAN.md`.

Authentication: `kc_session` HttpOnly cookie; every request resolves the current active user. Admin endpoints require current DB role `admin`. Merchant edits require active membership as owner/manager. All errors use `{ "error": { "code": "...", "message": "..." } }`. Unauthorized is 401, forbidden 403. Existing dealer handler unexpected failures currently return 500; marketing validation returns 422. Lists currently have no pagination except SEO revision history capped at 50; dedicated rate limiting is not yet implemented.

### GET /api/service-item-types

Authenticated user. Returns `{data:[{key,category,display_names}]}` for active DB catalogue entries, ordered category/key. Read-only. This is shared by the merchant portal; existing admin alias `/api/admin/dealers/service-item-types` remains supported.

### POST /api/admin/dealers

Admin. Body: `display_name` required; optional legal_name, registration_number, phone, email, website, service_item_type_keys array (maximum 30 processed), and `branch:{name,address,district,phone}`. All new merchants are drafts regardless of client status.

Returns 201 `{dealer,services,branch}`. `branch` is null if no branch name supplied. Creation of dealer, initial branch, initial services and branch-service associations is transactional; invalid/inactive service keys return 422 and roll back. Invitation is a separate existing `/api/admin/dealers/:id/invites` operation; no automatic email delivery is implemented. Create requests are not yet idempotent: do not automatically retry uncertain successful submissions.

### PATCH /api/admin/dealers/:id

Admin. Existing fields plus status draft/active/suspended. Activation now requires contact phone/email, active branch with an address, and an active service. Failure: 422 `incomplete_setup`. Returns `{dealer}`. Explicit branch offerings and fitments are still required for useful confirmed matching.

### GET /api/dealer/branches?dealer_id=:id

Active merchant member. Returns `{data:[branch]}`, with `service_ids` listing active branch offerings. `dealer_id` selects an authorized merchant; omitted uses the existing first active membership behavior. Read-only.

### PUT /api/dealer/branches/:branchId/services?dealer_id=:id

Owner/manager. Body `{service_ids:["service-id"]}`, maximum 100 entries, deduplicated. Replaces that branch's associations in a transaction. Empty list intentionally removes all offerings. Validates branch ownership and that every service is active and owned by the same merchant. Returns `{service_ids:[...]}`. 422 for invalid associations, 403 for insufficient role. Replacement is repeatable; last save wins (optimistic versioning is not yet implemented).

### GET /api/vehicles/:id/dealer-matches

Vehicle owner. Optional existing dealer_id filter. Read-only; no longer upserts `vehicle_item_matches`. Only active merchants, active branches and explicit active branch offerings are candidates.

Response `{vehicle,matches,branches,unmatched_needs}`. Each match preserves legacy fields and adds `branch_id`, `branch_name`, `compatibility_state` (`confirmed` or `needs_confirmation`). A known contradictory fitment is excluded; missing required attributes and empty rules need confirmation. Legacy match_level remains exact/likely/review but is not a probability or compatibility guarantee; use compatibility_state for UI decisions.

`branches` entries: branch_id/name, dealer_id/name, mode (`needs` or `browse`), score (integer or null in browse mode), covered_needs and uncovered_needs canonical key arrays, coverage [0,1], algorithm_version `dealer-match-v2-coverage`.

Current needs use existing wear >=80, weight 2; wear >=100 weight 3. Scores renormalize available coverage/specificity weights: `round(100*(.55*coverage+.25*specificity)/.8)`. Distance and availability are not yet measured. Duplicate offerings count each need once. Unknown fitments cannot cover a confirmed need.

### POST /api/vehicles/:id/service-requests

Vehicle owner. Required dealer_id, branch_id, dealer_service_item_id; optional message and package_id. Server revalidates active merchant, service ownership, branch ownership, branch offering, and known fitment contradictions. Package must belong to this active merchant. Returns 201 `{request}`. Missing branch/service or unavailable offering: 422. Known incompatibility: 422 `incompatible`. Missing vehicle attributes permit an enquiry; the UI labels it accordingly. Existing request schema/status lifecycle remains unchanged and does not yet persist a distinct enquiry kind. Idempotency, multi-item quotes and completion-history integration remain pending.

### GET /api/admin/marketing/pages

Admin; no-store. Returns `{pages,revisions}`. Pages contain path, draft, published, version, updated_by, updated_at. Revisions are the latest 50 published snapshots globally, newest first. Supported page paths currently `/` and `/demo` only.

### PATCH /api/admin/marketing/pages

Admin; same-origin browser writes. Body `{path,version,content}`. Version is the integer last read from GET. Content fields are strings: title (required, max160), description (required, max500), social_title (max160), social_description (max500), image (max1000), image_alt (max200); and indexable boolean. Empty social fields fall back to title/description. Image may be empty or an HTTPS URL on www.booundless.com, or a same-site relative URL. No arbitrary script or cross-site image fetch is accepted.

Saves draft only and increments version. Returns `{page}`. 409 `conflict` on stale version; reload before editing again. 422 `unprocessable` on invalid values. Does not publish or spend money.

### POST /api/admin/marketing/pages

Admin. Body `{path,version,revision_id?}`. Publishes saved draft, or republishes a revision belonging to the same page. Validates content, appends revision, updates draft/published and increments version atomically; actor recorded. Returns `{page}`. 409 stale version; 422 invalid content/revision. No body content is implicitly saved by publish: save the draft first. Repeating with an old version fails rather than silently overwriting.

### GET / and GET /demo (public HTML)

Routed through existing API entry point without adding a serverless function. Uses static application template plus published database metadata. Escapes metadata and renders one title/canonical, search/social tags and structured-data description in initial HTML. Canonical is fixed to production origin + clean path; client hash navigation must preserve published metadata on return.

Successful page cache: `public, max-age=0, s-maxage=60`. Publishing may take up to the cache TTL to appear; external search/social caches have their own timing. If DB is unavailable, returns static template with no-store; there is currently no durable last-published fallback. No new campaign public paths, dynamic sitemap or tracking scripts are implemented in this delivery.

## Rules
- Frontend and backend consume the same documented contract.
- Never silently change request/response/error shapes.
- Record auth, permissions, validation, idempotency, versioning, and failure states.

## Endpoint Template
### `METHOD /api/resource`
**Purpose:**  
**Auth:**  
**Permission:**  

#### Request
```json
{}
```

#### Success Response
```json
{}
```

#### Errors
| Code | HTTP | Meaning | Retryable |
|---|---:|---|---|
| `VALIDATION_ERROR` | 400 | Invalid input | No |

#### Notes
- Idempotency:
- Pagination:
- Rate limit:
- Side effects:
