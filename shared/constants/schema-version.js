// Single readiness marker shared by request-time database checks and the
// out-of-band migration runner. Bump only after the matching schema slices
// are present in scripts/_lib/migrations.js.
export const SCHEMA_VERSION = '2026-09-22-service-mvp-1';
