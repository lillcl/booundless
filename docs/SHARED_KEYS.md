# SHARED_KEYS.md

Canonical registry for shared names across frontend, backend, database, tests, events, and integrations.

## Rules
- One concept = one canonical name.
- Do not create synonyms across layers.
- Update this file before introducing a new shared key.
- Note layer-specific serialization when unavoidable.

## Registry
| Concept | Canonical Key | DB | API | Frontend | Type | Notes |
|---|---|---|---|---|---|---|
| Workspace ID | `workspaceId` | `workspace_id` | `workspaceId` | `workspaceId` | UUID | Example |

## Enums
### `<EnumName>`
- `VALUE_A`
- `VALUE_B`

## Events
| Event | Payload Schema | Producer | Consumer |
|---|---|---|---|

## Environment Variables
| Key | Required | Scope | Secret | Description |
|---|---|---|---|---|
