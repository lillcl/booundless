# DATA_FLOW.md

## Primary Flow
`User → Frontend → API → Validation → Business Logic → Database / External Service → API → Frontend`

## For Each Critical Flow Document
- Trigger
- Inputs
- Validation
- Authentication / authorisation
- Transformations
- Persistence
- Events / side effects
- Output
- Error / retry / rollback behaviour
