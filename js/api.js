/* Tiny API client. Same-origin fetch with JSON envelope.

   The server uses `{ data, count }` for list endpoints and returns the
   resource directly for single-resource endpoints. We unwrap lists here
   so views receive plain arrays. */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(payload?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function unwrap(payload) {
  if (payload && Array.isArray(payload.data)) return payload.data;
  return payload;
}

export const api = {
  health: () => request('/api/health'),
  vehicles: {
    list: async () => unwrap(await request('/api/vehicles')),
    get: (id) => request(`/api/vehicles/${id}`),
  },
  reminders: {
    list: async () => unwrap(await request('/api/reminders')),
    get: (id) => request(`/api/reminders/${id}`),
  },
};