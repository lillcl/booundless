const FIELD_LIMITS = Object.freeze({
  path: 240,
  hash: 240,
  route: 120,
  section: 120,
  title: 240,
  locale: 24,
});

export function sanitizePageContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (value[field] == null) continue;
    const text = String(value[field]).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
    if (text) result[field] = text;
  }
  return result;
}
