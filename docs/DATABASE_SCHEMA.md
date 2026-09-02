# DATABASE_SCHEMA.md

Canonical source of truth for database structure.

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
