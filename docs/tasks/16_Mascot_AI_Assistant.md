# Task 16 — Mascot AI Assistant and Site Knowledge

## Goal
Add a persistent BOOUNDLESS mascot assistant that can answer from authenticated vehicle tools and reviewed first-party site content, then guide users to allowlisted website destinations.

## Priority
- P0

## Scope
### In Scope
- A branded mascot and responsive website chat panel.
- Persistent conversation continuity across SPA route changes.
- Current-page context supplied to the agent as untrusted data.
- A generated 琴澳同行 knowledge index with citations, anchors, and freshness metadata.
- A generated provenance graph connecting reviewed topics, guide sections, and official sources.
- Read-only knowledge and navigation tools added to the existing agent registry.
- Structured navigation actions resolved through a server-owned allowlist.
- Existing confirmation gates for every data mutation.
- Replacement of the Mini Program's generic robot avatar with the mascot asset.

### Out of Scope
- Voice input/output.
- Autonomous browser control or navigation to arbitrary URLs.
- Vector database or embedding infrastructure. The first release instead uses a deterministic, file-backed knowledge graph generated from reviewed content.
- Replacing the existing MiniMax-compatible agent runtime.
- Automated changes to external booking, government, or dealer systems.

## Dependencies
- Required: existing `/api/agent`, agent persistence tables, 琴澳 guide build pipeline.
- Optional: configured Research MCP for explicit external research.
- Can Run Parallel With: future content authoring after the knowledge contract is stable.

## Contracts Affected
- Database: no schema change for the initial slice.
- API: `/api/agent` accepts bounded `page_context`; agent events may include navigation tool activity.
- Shared Keys: assistant route keys, knowledge topic keys, and client storage keys.
- Events: existing `text`, `tool_activity`, `confirmation_required`, `done`, and `error` remain compatible.

## Phased Delivery
### Phase 1 — Foundation
- [x] Generate and install the mascot artwork.
- [x] Add shared route and knowledge contracts.
- [x] Extend the 琴澳 build to emit the knowledge index.
- [x] Generate and connect the first-party provenance knowledge graph.

### Phase 2 — Core
- [x] Add read-only navigation and site-knowledge agent tools.
- [x] Add bounded page context to agent requests.
- [x] Add the persistent responsive assistant shell to the website and guide.
- [x] Reuse the mascot in the Mini Program chat.

### Phase 3 — Hardening
- [x] Validate route allowlisting and knowledge citation metadata.
- [x] Cover responsive, keyboard, error, confirmation, and route-change behavior.
- [x] Run security review for prompt injection, ownership, rate limits, origins, and unsafe URLs.

## Error / State Requirements
- [x] Loading and thinking state.
- [x] Empty welcome state with page-aware prompts.
- [x] Success with source and navigation cards.
- [x] Validation for empty/oversized input and invalid route actions.
- [x] Permission state for signed-out users.
- [x] Network, timeout, and AI dependency failures.
- [ ] Retry without duplicate write execution.

## Acceptance Criteria
- [x] Mascot opens a chat panel from every customer-facing web page without obscuring primary navigation.
- [x] A 琴澳 question retrieves reviewed content and links to the exact guide section.
- [x] A multi-topic question traverses reviewed topic, document, and official-source relationships.
- [x] The model cannot navigate to a URL absent from the shared allowlist.
- [x] Authenticated questions can still use vehicle, maintenance, and trip tools.
- [x] All write tools still pause for explicit confirmation.
- [x] Knowledge answers expose source, link, and verification date.
- [x] Mobile, keyboard, reduced-motion, and screen-reader states are usable.

## Validation
- [x] Unit tests for retrieval, route resolution, and context validation.
- [x] Agent integration tests with mocked provider calls.
- [ ] Playwright E2E for assistant open/send/navigate/confirm flows.
- [x] Security review.
- [ ] Independent reviewer sign-off.
- [x] Docs synchronized.

## Risks / Notes
- 琴澳 rules and operating details are time-sensitive; stale content must be labeled and link to the official source.
- Automotive answers must not claim a diagnosis from incomplete records.
- The assistant must not send VIN, plate, or other user data to unrelated external research providers.
- The initial deterministic knowledge index and provenance graph are preferred over a vector database until content volume justifies one.

## Ownership / Signatures
- Implementer: `Lead / Orchestrator` — first vertical slice complete 2026-09-30
- Reviewer: `pending`
