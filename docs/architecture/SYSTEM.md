# SYSTEM.md

## Architecture Overview
Describe system boundaries, major modules, trust boundaries, external services, runtime topology, and ownership.

## Layers
- Frontend
- Backend
- Shared contracts
- Database
- External integrations
- Observability / operations

## Rules
- UI does not own business rules.
- Presentation code does not directly access the database.
- Contracts are explicit and versioned where necessary.
- Dependencies should point toward stable domain logic.
