# API.md

Canonical API contract.

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
