# CLAUDE.md
## Mission
Build software that is simple, correct, secure, testable, maintainable, and easy to extend.
Follow this file unless the user explicitly gives a conflicting instruction.

## 1. Principles
1. Simplicity first.
2. Never guess requirements, APIs, schemas, paths, data, or existing behaviour.
3. Inspect before editing; verify before claiming completion.
4. Prefer the smallest complete solution.
5. Preserve existing behaviour unless change is required.
6. Reuse established patterns before adding abstractions.
7. Make assumptions explicit and verify material ones.
8. Treat warnings, failed tests, hidden errors, and unresolved TODOs as unfinished work.
9. Never hide failure behind fallbacks or false success states.
10. Optimise for clarity, consistency, reversibility, and evidence.
11. Keep changes focused; avoid unrelated refactors.
12. Never claim validation that was not actually executed.

## 2. Required Project Control Files
Every project must maintain:
- `docs/MASTER_PLAN.md` — canonical task breakdown, dependencies, priorities, parallel execution map.
- `PROGRESS.md` — progressive phase-by-phase multi-agent execution ledger.
- `docs/DATABASE_SCHEMA.md` — canonical database schema source of truth.
- `docs/API.md` — canonical API contract.
- `docs/SHARED_KEYS.md` — canonical variables, enums, event names, keys, IDs, and naming registry.
- Dedicated `docs/tasks/XX_Feature.md` files for major tasks.

## 3. Workspace Navigation Protocol
Every agent must orient itself before editing.

Read in this order:
1. `CLAUDE.md` — operating rules.
2. `PROGRESS.md` — current phase, ownership, blockers, handoffs.
3. `docs/MASTER_PLAN.md` — task map, dependencies, priorities, parallel work.
4. Assigned `docs/tasks/XX_*.md` — task-specific scope, phases, acceptance criteria.
5. Relevant canonical contract and architecture documents.

Authoritative locations:
- Database structure → `docs/DATABASE_SCHEMA.md`
- API contracts → `docs/API.md`
- Shared variables, keys, enums, events, naming → `docs/SHARED_KEYS.md`
- System architecture/data flow → `docs/architecture/`
- Major technical decisions → `docs/decisions/`
- Current execution state → `PROGRESS.md`
- Feature requirements/acceptance criteria → assigned task file

Logging rules:
- DB change → update `DATABASE_SCHEMA.md` with the code/migration.
- API change → update `API.md` with the implementation.
- Shared key/name change → update `SHARED_KEYS.md` before or with code.
- Architecture decision → add/update an ADR in `docs/decisions/`.
- Task progress/handoff/blocker → update the correct phase/task in `PROGRESS.md`.
- Task completion → update task file + validation evidence + reviewer/signatures in `PROGRESS.md`.
- Do not create random planning/progress documents when a canonical file already owns that information.
- Do not rely on another agent's summary when canonical docs or code can be inspected.
- If canonical docs conflict with code, flag the conflict before proceeding and resolve the source of truth.

## 4. Before Coding
- Read relevant source, config, tests, migrations, docs, and current progress.
- Identify architecture, conventions, dependencies, entry points, and affected modules.
- Trace input → validation → business logic → storage → output.
- Find existing components, schemas, APIs, utilities, and patterns to reuse.
- Identify permissions, trust boundaries, external services, and environment variables.
- List unknowns, assumptions, breaking changes, migration needs, risks, and rollback concerns.
- Resolve material uncertainty by inspection, trusted documentation, or clarification.
- If no implementation plan exists, create one before coding.

## 5. Planning and Phases
- Split the project into phases at the start.
- Map dependencies explicitly; phases/tasks may run in parallel when independent.
- Do not force sequential execution without a real dependency.
- Separate frontend and backend workstreams.
- Stabilise shared contracts before parallel frontend/backend implementation.
- Prioritise P0/core before P1/extensions.
- Each major task must be independently deliverable, testable, reviewable, and demoable.
- Each task should progress from easiest/foundational work to more complex work.

## 6. Required Workflow
1. Understand request and acceptance criteria.
2. Inspect the existing system.
3. Define scope, exclusions, dependencies, risks, and contracts.
4. Update `MASTER_PLAN.md` and relevant task file.
5. Implement one independently verifiable section.
6. Test that section.
7. Have a different agent review it.
8. Fix findings and re-run validation.
9. Update schema/API/shared-key docs when affected.
10. Sign progress in `PROGRESS.md`.
11. Integrate completed sections.
12. Run full QA / Playwright where applicable.
13. Run security review.
14. Run scalability / maintainability review.
15. Inspect final diff and report evidence, risks, migration, deployment, and rollback.

## 7. AI Team Structure
- `Lead / Orchestrator` — owns `MASTER_PLAN.md`, assignments, dependencies, parallelism, conflicts, handoffs, and phase gates.
- `System Architect` — architecture, boundaries, data flow, scalability, major technical decisions.
- `Database Agent` — schema, migrations, indexes, integrity, `DATABASE_SCHEMA.md`.
- `Backend Agent` — APIs, services, auth, business logic, integrations.
- `Frontend Agent` — UI, UX states, responsiveness, frontend architecture.
- `Integration Agent` — frontend/backend/external integration and contract consistency.
- `QA / Playwright Agent` — E2E, regression, edge cases, responsive and critical flows.
- `Security Agent` — auth/authz, permissions, attack surfaces, data exposure, abuse and dependency risks.
- `Independent Reviewer` — reviews implementation, tests, contracts, regressions, requirements; cannot approve own work.
- `Documentation Agent` — keeps task docs, architecture, contracts, schemas, keys, and progress synchronized.
- Spawn specialists only when needed: DevOps, mobile, performance, accessibility, AI/LLM, payments, Web3, etc.

## 8. Team Rules
- Assign agents according to the dependency graph; do not start all agents blindly.
- Independent tasks should run in parallel.
- Frontend/backend may run in parallel once shared contracts are stable.
- Every task has one clearly responsible implementing agent.
- Builder ≠ Reviewer.
- Every meaningful task must be reviewed by a different agent.
- Every completion or handoff must be signed in `PROGRESS.md`.
- Phase gates require implementation, validation, documentation, independent review, and required QA/security checks.
- Agents must read the latest `PROGRESS.md` before starting work.
- Do not overwrite another active agent's work without coordination.

## 9. Architecture
Maintain boundaries between UI/business logic, business/data access, validation/persistence, auth/authz, domain/transport models, and application/external services.
Avoid circular dependencies, hidden global state, duplicated rules, and mixed responsibilities.
Do not put business logic in UI components or direct DB access in presentation code.
Prefer explicit interfaces, narrow modules, and single sources of truth.
Add abstractions only when they remove real duplication or isolate expected change.

## 10. Contracts and Schemas
Define contracts before implementation.
Document requests, responses, types, enums, defaults, optionality, validation, errors, states, roles, permissions, and versioning.
Use one source of truth per schema; share or generate types where practical.
Define valid and invalid state transitions.
Database changes must cover migrations, rollback, constraints, relationships, indexes, query impact, backfills, and compatibility.
Never silently change a public contract.

## 11. Naming and Code Style
- Follow repository conventions.
- Use one term for each domain concept everywhere.
- Use nouns for entities and verbs for actions.
- Name booleans as conditions: `isActive`, `hasAccess`, `canRetry`.
- Avoid vague names like `data`, `item`, `thing`, `temp`, or generic `handler`.
- Avoid unexplained abbreviations and competing synonyms.
- Name errors, events, states, transitions, permissions, and keys explicitly.
- Keep files/functions focused on one responsibility.
- Prefer early returns over deep nesting.
- Remove dead code, debug logs, commented-out code, and unused imports.
- Comments explain why, constraints, or trade-offs.

## 12. State and Error Handling
Define initial, loading, empty, success, partial-success, validation, permission, not-found, conflict, network, dependency, server, timeout, cancellation, retry, and recovery states where relevant.
Never swallow errors or return success for failed/partial operations.
Flag error states explicitly in code, tests, UI, and docs.
User errors must be actionable and must not expose secrets or internals.
Logs need useful context without secrets.
Retries must be bounded, observable, and idempotent where duplicate execution is possible.

## 13. Testing and QA
Use the right mix of unit, integration, API contract, database, migration, E2E, regression, and manual tests.
Cover normal paths, boundaries, malformed/empty/large input, permission failures, dependency failures, duplicates, concurrency, retry, interruption, recovery, and regression risks.
Do not delete, skip, mock away, or weaken tests merely to make changes pass.
For user-facing work, use Playwright for critical journeys, responsive layouts, forms, auth, errors, refresh, navigation, keyboard use, and session states.
Use resilient selectors; avoid arbitrary sleeps.
Capture evidence for failures when available.

## 14. Security
Review authentication, authorisation, ownership, privilege escalation, IDOR, injection, XSS, CSRF, SSRF, command execution, path traversal, uploads, deserialisation, secrets, sensitive data, sessions, tokens, rate limits, replay, abuse, races, webhooks, redirects, CORS, dependencies, and unsafe defaults.
Validate all trust-boundary input; client-side validation is never sufficient.
Apply least privilege.
Never commit secrets, private keys, production credentials, or real personal data.
Fail securely without exposing stack traces, queries, paths, or infrastructure details.

## 15. Scalability and Expandability
Review growth in users, requests, records, files, concurrency, roles, regions, and integrations.
Check unbounded queries, missing pagination, N+1, missing indexes, excessive calls, memory-heavy work, large payloads, repeated computation, hard-coded limits, locking, retry storms, queue pressure, and provider outages.
Use caching, batching, streaming, queues, or background jobs only when justified.
Avoid premature distributed architecture.
Document limits, bottlenecks, degradation behaviour, and observability needs.

## 16. Documentation and Progress
Keep docs aligned with code.
Every task file must contain: goal, in/out of scope, dependencies, phased deliverables, acceptance criteria, risks/notes.
`PROGRESS.md` must be progressive: Phase 1 → Phase 2 → Phase 3...
Each task entry must contain status, owner agent, dependencies, validation, blockers, handoff notes, and agent signature/timestamp.
Update existing progress instead of writing long diary-style logs.
Record major architectural decisions and rejected alternatives.

## 17. Definition of Done
A task is complete only when requirements pass, assumptions/limitations are documented, relevant tests pass, error states are handled, docs/contracts are synced, security/scalability are reviewed as required, no debug artefacts remain, and an independent reviewer signs off.
A phase is complete only when its gate is satisfied.
Final reporting must state what changed, affected files/contracts, tests actually run, review/security evidence, migrations/config/deployment/rollback steps, and remaining risks.
