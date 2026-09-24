# MASTER_PLAN.md

## Project
- Name: `康程 CarAI — Service V10 Interactive`
- Source Requirements: `reference/kangcheng_v10_4/index.html` (V10.4 prototype) + `reference/kangcheng_v10_4/README.txt`
- Last Updated: `2026-09-02`

## Current Prototype Snapshot
- Single-file SPA prototype in `reference/kangcheng_v10_4/index.html`.
- Screens: home, garage, service, qinao, workshops, calendar, profile, videos, plus detail screens (`tripDetail`, `videoDetail`, `vehicleDetail`, `garageDetail`).
- V10.4 highlights: corrected inconsistent spacing on Home / 琴澳 / 影片 pages; real scenic image assets in `reference/kangcheng_v10_4/assets/`.
- Visual identity to be confirmed with the user before implementation work begins.

## Open Questions (must resolve before Phase 1)
1. Target stack — is the production build a vanilla HTML/JS/CSS app matching the prototype, or a framework rebuild (React/Vue/Svelte/etc.)?
2. Backend requirements — does 康程 need a real backend (auth, vehicle data persistence, booking) or is this a static interactive prototype?
3. Persistence — do garage/calendar/profile data need to be stored (DB) or remain local-only as in the current prototype?
4. Deployment target — web-only, or also wrapped for mobile (PWA / native shell)?

## Breakdown Principles
- Every task is independently deliverable, testable, reviewable, and demoable.
- Minimize strong dependencies and explicitly identify parallel work.
- Break each task into phases from foundational/easy → complex.
- Complete P0/core before P1/extensions unless dependencies justify otherwise.
- Frontend and backend are separate workstreams connected through canonical contracts.

## Task Index
| ID | Task | Priority | Dependencies | Parallel With | Owner | Task File |
|---|---|---|---|---|---|---|
| 01 | Architecture & Contracts | P0 | None | — | Architect | `tasks/01_Architecture_Contracts.md` |
| 02 | Database Foundation | P0 | 01 | 03 | Database Agent | `tasks/02_Database.md` |
| 03 | Frontend Foundation | P0 | 01 | 02 | Frontend Agent | `tasks/03_Frontend.md` |
| 04 | Backend Core | P0 | 01,02 | 03 | Backend Agent | `tasks/04_Backend.md` |
| 05 | Integration | P0 | 03,04 | — | Integration Agent | `tasks/05_Integration.md` |
| 06 | QA / Playwright | P0 | 05 | 07 | QA Agent | `tasks/06_QA.md` |
| 07 | Security Review | P0 | 02,04,05 | 06 | Security Agent | `tasks/07_Security.md` |
| 08 | Release / Hardening | P1 | 06,07 | — | Orchestrator | `tasks/08_Release.md` |

## Phase 7 — Dealer Self-Registration Refactor (2026-09-24)
Task file: [`tasks/15_Dealer_Self_Registration.md`](tasks/15_Dealer_Self_Registration.md). Replaces the admin-invite-token flow with a hidden `#/dealer/register` page. Self-register creates user + active dealer + first branch + owner membership in one transaction. Admin gains full edit + member management + suspend that cascades to `users.is_active` for every member. `dealer_invites` table dropped; invite endpoints removed.

## Recommended Execution Waves
- **Wave 1 — Foundation:** 01
- **Wave 2 — Parallel Foundations:** 02 / 03
- **Wave 3 — Core Backend + continuing Frontend:** 04 / 03
- **Wave 4 — Integration:** 05
- **Wave 5 — Parallel Validation:** 06 / 07
- **Wave 6 — Release / Hardening:** 08
- **Cross-cutting:** docs, contract sync, progress signatures, independent review.

## Phase Gates
- A task cannot be complete without acceptance criteria and independent review.
- Dependent work starts only when required contracts/dependencies are stable.
- Prefer parallel work whenever no real dependency exists.
