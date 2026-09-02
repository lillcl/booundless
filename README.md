# 康程 CarAI — Service V10 Interactive

Single-page web application for 康程 CarAI's connected-vehicle service experience.

## What this repo is
- Reference HTML prototype lives in [`reference/kangcheng_v10_4/`](reference/kangcheng_v10_4/) — V10.4 release with corrected spacing on Home / 琴澳 / 影片 screens and real scenic image assets replacing the earlier SVG-style graphics.
- Working application code is being built in [`frontend/`](frontend/), with shared types in [`shared/`](shared/), backend in [`backend/`](backend/), and persistent state in [`database/`](database/) following the template's contract-first workflow.

## Core control files
- `CLAUDE.md` — agent rules and workflow.
- `docs/MASTER_PLAN.md` — canonical task breakdown and parallel dependency map (currently being scoped for 康程).
- `PROGRESS.md` — phase-by-phase signed execution ledger.
- `docs/DATABASE_SCHEMA.md` — database source of truth (TBD).
- `docs/API.md` — API contract source of truth (TBD).
- `docs/SHARED_KEYS.md` — shared naming/key registry.

## Execution model
Plan → split → parallelize by dependency → implement → verify → independent review → document → sign → phase gate.

## Agent workspace navigation
Agents should read: `CLAUDE.md` → `PROGRESS.md` → `docs/MASTER_PLAN.md` → assigned task file → relevant canonical contract docs.
All progress, schema, API, shared-key, and architectural decisions must be logged in their designated canonical files rather than scattered notes.

## Reference material
- `reference/kangcheng_v10_4/index.html` — current V10.4 interactive prototype (single-file SPA; screens: home, garage, service, qinao, workshops, calendar, profile, videos, plus trip/video/vehicle/garage detail screens).
- `reference/kangcheng_v10_4/assets/` — bundled real scenic images (hengqin-skyline, macau-skyline, qinao-bridge-drive).
- `reference/kangcheng_v10_4/README.txt` — V10.4 changelog.