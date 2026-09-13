# Merchant onboarding, matching and marketing implementation plan

Date: 2026-09-13
Status: proposed implementation; this document does not deploy features or change the database.

## 1. Outcomes and scope

1. Admin can create, invite, review, activate and suspend merchants.
2. Merchants configure branch-specific services and vehicle compatibility from the same database catalogue used by vehicle passports.
3. Owners receive explainable recommendations based on confirmed vehicle needs and can request, quote, schedule and complete service.
4. Admin can publish SEO metadata, social previews and campaign landing pages without a code deployment, and configure supported advertising measurement.

Marketing controls support paid traffic; changing SEO does not create an advertising campaign, purchase ads, or guarantee rankings. Buying ads, budgets, billing and ad creative remain in the advertising platform. Merchant-paid promotion is a separate optional feature with explicit sponsored labelling; it must never bypass vehicle compatibility or secretly change organic rankings.

## 2. Current code baseline

- `index.html`: admin merchant creation reads service types from DB, but merchant portal still contains hardcoded service options. Branch creation and invitations are separate follow-up requests; branch errors can be missed.
- `api/_handlers/dealers.js`: merchant CRUD, invitations, branches, service rules, matching and service requests exist.
- `api/_lib/dealer-matcher.js`: service-label aliases and compatibility scoring exist. Missing rules receive a generic score; VIN prefix can receive 100; individual offerings are ranked rather than branch coverage. GET matches writes each rule result and can persist a different result from the best returned match.
- `db/schema.sql`: dealers, branches, members, invites, shared service types, offerings, fitments, packages, requests and match cache already exist. Comments describe custom server JWT authorization, not Supabase Auth JWTs.
- `index.html` and `assets/site-metadata.js`: metadata is currently maintained in code. `vercel.json` serves a static root and `/demo`; unknown paths return a custom 404. There is no inspected admin marketing editor.
- Findings are from local source, not a verification of production database migrations or live merchant accounts.

## 3. User interfaces and flows

### Admin merchant setup

Wizard: business/contact → branches/location → offered services → supported vehicles → pricing → owner invitation → review.

Allow saved drafts. Activation requires valid contact details, an active branch and at least one explicitly configured service. Show setup errors inline. Admin can view all branches, service coverage, invitation delivery, request history and audit events.

Create business, first branch and initial services in one transaction. Enqueue invitation delivery after commit. Use idempotency to avoid duplicates on double-click/retry. Invite tokens are hashed, expire, are single-use and bound to the invited email; show a usable invitation link rather than a raw token workflow.

### Merchant backend

Tabs: Overview, Branches, Services, Vehicle compatibility, Requests/Quotes, Team.

Services are searchable grouped checkboxes from `service_item_types`, followed by branch selection, pricing, currency, duration, accepting-requests flag and compatibility. Explicitly select universal, restricted or unverified support: a blank form never silently means all vehicles. Provide a vehicle match preview for configured rules. Explain that opening hours do not imply bookable appointment inventory.

Permissions: owner manages team and business; manager manages operational data; staff manages assigned requests; viewer is read-only. Every query is scoped by membership and merchant/branch ownership.

### Car owner

Passport → review selected needs/evidence → compare matching branches → select services → share request → review quote → accept → schedule → completion confirmation.

Result cards show covered and uncovered needs, compatibility state, approximate distance where known and indicative pricing or “request quote.” Separate needs-confirmation enquiries from confirmed compatibility. Share only request-relevant vehicle details with the chosen merchant.

### Admin marketing console

Proposed routes: `/admin/marketing/pages`, `/admin/marketing/campaigns`, `/admin/marketing/tracking`, `/admin/marketing/revisions`.

Page editor tabs:

- Content: approved layout blocks, headline, copy, image/alt text and CTA.
- Search: page title, description, canonical, indexing policy and slug.
- Social: Open Graph title/description/image/alt, Twitter card preview.
- Campaign: source/medium/campaign URL builder and destination CTA.
- Publish: draft preview, validation report, revision comparison, publish and rollback.

Provide mobile/desktop and illustrative search/social previews; explain actual snippets and social refresh timing are controlled by third parties. Warn on unusually long titles/descriptions rather than claiming fixed character limits guarantee display.

Global settings: site name, default title template/description/share image, approved organization details, favicon and supported site-verification tokens. Organization structured data uses a validated template; no freeform scripts or invented review/rating data.

Marketing editor may prepare drafts. Marketing publisher/admin may publish. Only an administrator may change tracking destinations or verification settings. Merchants cannot change global SEO.

## 4. Data model

Reuse existing IDs and table names; verify production schema before generating migrations. Add indexes and backfills through explicit migrations, not request-time seed routines.

| Table | Change and key fields |
| --- | --- |
| service_item_types | Shared canonical key, category, labels, active flag; add ordering and a service aliases table. Seed initial catalogue once; subsequent edits remain DB-owned. |
| dealers | Review/activation metadata, profile completeness; preserve draft/active/suspended lifecycle. |
| dealer_branches | Validate coordinates; add timezone and accepting_requests. |
| dealer_branch_services | New branch/service junction, unique branch+service, branch price range/currency, duration, availability and active flag. |
| dealer_service_items / dealer_item_fitments | Explicit compatibility mode, verification status, provenance and structured brand/model/year/powertrain rules. |
| vehicle_needs | Vehicle, canonical service key, urgency, source evidence, confidence, due date/km, selected/confirmed/resolved status and version. |
| dealer_request_items | Request, need reference, offering reference and immutable service/price snapshot. |
| dealer_quotes / dealer_quote_items | Quote version, currency, expiry, totals, line items and acceptance state. |
| dealer_request_events | Append-only actor, transition, timestamp and request version. |
| matching_runs | Algorithm version, input versions/hash, result explanations, expiry; persist only when needed for requests/audit. |
| marketing_pages | Unique normalized path+locale, page type, draft/published revision pointers and lifecycle. |
| marketing_page_revisions | Immutable content blocks, title, description, canonical policy, robots settings, social image reference, structured-data fields, author and timestamps. |
| marketing_settings / revisions | Global defaults, organization/verification fields, published version and audit metadata. |
| marketing_campaigns | Campaign name/slug, published destination page, UTM defaults, active window and status. No ad-spend execution. |
| marketing_integrations | Allowlisted provider, validated public measurement IDs, conversion action mapping, enabled/test state and change actor. Secrets use server secret references, never public settings JSON. |
| attribution_sessions | Consent-permitted anonymous identifier, first/last touch, bounded UTM/click identifiers, consent version and expiry. |
| conversion_events | Unique event ID, event name, authoritative business reference, campaign reference, delivery/deduplication state and timestamp. |

Enforce valid price/year ranges, foreign keys, same-merchant branch/service/package relationships and optimistic version checks. Add indexes for merchant status, active branch offerings by service key, unresolved vehicle needs and request status/date. RLS/direct database grants must match the real custom-auth architecture; do not assume auth.uid() maps to existing application user IDs.

## 5. Matching algorithm v2

### Need extraction

Normalize confirmed records, applicable maintenance intervals and explicit user requests to catalogue keys. Split oil+filter into two requirements. Use applicability rules so electric vehicles do not acquire engine-oil needs. Keep confidence separate from urgency: missing history means unknown, not automatically healthy or overdue. AI may propose service keys and ask for missing information, but cannot silently confirm repairs or merchant compatibility.

Assign initial need weights: urgent 3, due-soon 2, routine or explicit request 1. These are configurable business ranking weights, not medical/safety probabilities. If there are no confirmed selected needs, return a browse-services state rather than a fabricated recommendation score.

### Eligibility

Exclude inactive/suspended merchants, inactive/non-accepting branches and unavailable services. Match canonical service keys, then evaluate all constraints within a rule with AND, alternative rules with OR. Known contradictions exclude; missing required attributes yield needs_confirmation. Explicitly verified universal service support is permitted where applicable. A VIN prefix alone never establishes exact component compatibility.

Build separate confirmed and needs_confirmation result groups. Respect user-declared strict district/radius restrictions; never silently widen them. No compatible result should suggest changing filters or asking for confirmation, not manufacture a match.

### Branch ranking

For eligible confirmed offerings aggregate by branch, not merely by merchant. Select the best compatible offering for each need and count that need once.

```
coverage = sum(urgency weights of covered selected needs)
           / sum(urgency weights of all selected confirmed needs)

score = 100 * (0.55 * coverage
             + 0.25 * compatibility_specificity
             + 0.15 * proximity
             + 0.05 * availability)
```

All components are normalized to [0,1]. Specificity rewards supported relevant vehicle attributes, without calling the score a probability. Proximity uses approximate straight-line distance, e.g. exp(-distance_km / 10), with market-calibrated scale. Availability uses verified slot data only; it is disabled in the first release if no scheduling source exists. Omit unavailable dimensions globally for a query and renormalize the remaining weights so candidates remain comparable; do not reward a merchant for omitting data. Missing branch coordinates receive an explicit unknown-location state when proximity is enabled. Strict location filters require confirmed location.

Tie-break by coverage, specificity, known distance and stable branch ID. Do not initially score reviews or price without verified reviews and comparable quotes. Record algorithm version and explanations. Stale match caches invalidate on vehicle/need, offering, branch or merchant-status version changes; request submission always revalidates eligibility.

Example: oil, filter and brake pads each weight 2. Branch A covers all three: coverage 1. Branch B covers oil+filter: coverage 4/6. Show B's uncovered brake requirement; never claim full coverage. Optional split-merchant results must explain separate requests and prices.

## 6. Service request lifecycle

New → quoted → accepted → scheduled → completed; support declined, cancelled and expired terminal states with defined permitted actors. Merchant creates a quote; owner accepts its exact version; merchant schedules an accepted request; completion records actual work and owner confirmation/dispute state. Quote edits invalidate prior acceptance. Transactions/version checks prevent competing updates. Idempotent submission and completion prevent duplicate requests, conversions and maintenance history.

AI tool calls use the same authorization and matching service; the model can explain results but cannot bypass eligibility, publish merchant claims or send requests without the user's action.

## 7. Public rendering and SEO publishing

Use clean public paths: `/`, `/demo`, `/campaigns/:slug`, and optional approved `/merchants/:slug` pages. Preserve existing private hash-route links during migration. Marketing pages must have correct content, one primary H1, metadata and JSON-LD in the initial HTML, not depend solely on client-side metadata updates.

Implement a shared HTML renderer dispatched through the existing server entry point, with explicit public route rewrites before the filesystem fallback. Assets and existing API routes remain intact. This avoids adding one Vercel Function for each route. Reconcile `assets/site-metadata.js` so it does not overwrite published canonical/title values.

Publishing transaction validates revision and switches the published pointer; invalidate versioned public cache with a bounded fallback TTL (target 60 seconds). Serve last published content on temporary DB errors; never expose drafts. If no valid page exists, return a real 404. Preview is authenticated, no-store and noindex. Rollback republishes a prior revision and invalidates the same cache.

Generate sitemap.xml from published indexable public pages with real last-modified timestamps. Generate robots.txt from a controlled template; private data remains auth-protected regardless of crawler settings. Private clean routes return noindex and no-store; hash routes are not independently server-addressable and must never embed personal data in public HTML.

Canonical defaults to the approved production origin plus normalized path, without campaign query parameters. Allow only validated same-origin overrides. Distinct campaign pages can self-canonicalize; near-duplicate campaign variants may explicitly canonicalize to the primary page. Ad-only pages can be noindex while still serving ads. Block redirect loops, reserved path collisions and open redirects. Slug changes create managed 301 redirects.

## 8. Advertising measurement

Initial supported setup: validated GA4 measurement ID, Google Ads destination/action IDs and optional Meta Pixel ID. Add adapters in stages and verify current vendor documentation before implementation. No arbitrary HTML/JavaScript paste field. GTM, if added later, is an elevated integration because external container changes can execute scripts.

Admin selects which genuine outcomes count as conversions: signup_completed, vehicle_created, service_request_submitted and booking_confirmed. Demo clicks are engagement only. Fire outcome events after successful authoritative operations, not on submit clicks or thank-you-page reloads. Use stable event IDs and business-level uniqueness. Do not promise cross-platform exactly-once delivery; use provider-supported deduplication and delivery retry logs.

Provide consent preferences with default nonessential measurement disabled; initialize consent before tags and apply updates/withdrawal. Start with basic consent-gated loading, without pre-consent ad/analytics requests. Apply retention/deletion controls to permitted attribution data. Never send VIN, plates, vehicle photos, maintenance notes, email or phone to analytics payloads. Validate and truncate UTM input; preserve approved campaign context across signup without allowing external return URLs. Provider secrets and server-side delivery credentials stay server-only.

Campaign dashboard: attributed visits, passport creations, requests and confirmed bookings, clearly excluding unavailable/declined-consent traffic from attribution claims. No invented ROAS: cost/return reporting requires an explicit ad-cost integration and reliable revenue data, deferred from v1.

## 9. API contracts

All mutation routes require authorization, input validation, CSRF protection appropriate to cookie auth and audit events. Keep existing dealer naming for compatibility.

| Route | Purpose |
| --- | --- |
| GET /api/service-item-types | Shared catalogue for admin and merchants |
| POST /api/admin/dealers | Transactional business/initial branch/services creation |
| PATCH /api/admin/dealers/:id | Profile/status with activation gates |
| POST /api/admin/dealers/:id/invites | Invite and delivery status |
| GET/POST/PATCH /api/dealer/branches[/:id] | Authorized branch management |
| PUT /api/dealer/branches/:id/services | Replace branch offerings with version check |
| /api/dealer/services, /api/dealer/fitments | Extend existing CRUD |
| GET /api/vehicles/:id/needs | Authorized needs/evidence |
| GET /api/vehicles/:id/dealer-matches | Read-only branch recommendations and filters |
| POST /api/vehicles/:id/service-requests | Revalidate and create multi-item request |
| POST /api/dealer/service-requests/:id/quotes | Versioned merchant quote |
| POST /api/service-requests/:id/accept-quote | Owner accepts exact quote |
| POST /api/service-requests/:id/transitions | Authorized lifecycle transition |
| GET/POST /api/admin/marketing/pages | List/create drafts |
| GET/PATCH /api/admin/marketing/pages/:id | Read/edit draft with revision conflict handling |
| POST /api/admin/marketing/pages/:id/publish | Validate and publish |
| POST /api/admin/marketing/pages/:id/rollback | Republish specific revision |
| GET/PATCH /api/admin/marketing/settings | Versioned global SEO settings |
| /api/admin/marketing/campaigns | Campaign CRUD and validated URL builder |
| GET/PATCH /api/admin/marketing/integrations | Restricted tracking configuration |
| GET /api/admin/marketing/reports | Aggregate permitted attribution/events |

Public renderer exposes published fields only. Public measurement configuration includes approved IDs, never secrets. Avoid creating unauthenticated conversion endpoints that accept arbitrary claimed bookings.

## 10. Delivery phases and acceptance gates

1. **Baseline and schema:** verify live migrations/auth mapping, catalogue deduplication and API dispatch. Add migrations, fixtures and rollback strategy. Backfill legacy offerings as unverified unless explicit support is known; do not silently activate merchants.
2. **Merchant onboarding:** wizard, transaction, branches, DB-driven catalogue, invite acceptance, role checks and activation checklist.
3. **Matching v2:** structured needs, compatibility states, branch aggregation and explained ranking; compare against deterministic fixtures before rollout.
4. **Service fulfilment:** multi-item requests, quotes, controlled transitions, notifications and confirmed maintenance records.
5. **SEO admin:** revisions, editor, renderer, preview/publish/rollback, sitemap and redirects. No ads integration needed for this phase.
6. **Campaigns and measurement:** campaign templates/UTM builder, consent, supported tracking adapters, deduplicated outcomes and reporting.
7. **Release:** verify staging end-to-end, deploy via existing GitHub flow and verify public production pages. Never send test advertising conversions into production reporting.

Acceptance checklist:

- Admin creates a merchant with a branch and two services; validation failure leaves no partial setup; retry does not duplicate.
- Invited owner logs in and sees only their merchant; staff cannot publish SEO or edit another merchant.
- Shared catalogue changes appear in both creation and portal without a frontend code change.
- Incompatible vehicles are excluded; missing year/engine is needs-confirmation; EV needs avoid engine oil; duplicate rules do not inflate coverage.
- Inactive branches/merchants disappear immediately from request eligibility; location denied and empty-needs states are explicit.
- A 3-item need produces correct complete/partial coverage; stale results cannot bypass submit-time checks.
- Quote acceptance, cancellation, retries and completion create exactly one business request/history record with correct actor checks.
- Published SEO change appears in fetched raw HTML for root/demo/campaign page within the cache target; title, canonical, social tags and JSON-LD agree.
- Draft/private pages stay out of sitemap; unknown URLs return 404; rollback restores prior metadata; stale client code cannot overwrite it.
- HTML/script injection, unsafe images/URLs, reserved slugs and redirect loops are rejected; image upload validates type/size and stores alt text.
- Campaign context survives login; default declined consent sends no nonessential tracking calls; consent withdrawal works.
- A failed form generates no conversion; successful request retry/reload does not create duplicate business conversion events; payloads contain no vehicle/personal details.
- Desktop/mobile browser checks cover wizard, portal, match cards, marketing editor and previews. Also inspect response HTML and network requests; DOM-only SEO tests are insufficient.

## 11. Open deployment inputs

Implementation can proceed with draft/test settings. Before enabling external measurement/delivery obtain the actual analytics/ad IDs, invitation email provider and verified sender, final conversion selection and retention configuration. No ad spend is authorized by this plan. Current merchant database and production deployment must be verified before migrations are applied.

## References

- Google JavaScript SEO: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Google canonical guidance: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Google consent setup: https://developers.google.com/tag-platform/security/guides/consent

These references support initial-HTML metadata/canonical consistency and consent-aware tag initialization. Check current provider APIs again when implementing integrations.
