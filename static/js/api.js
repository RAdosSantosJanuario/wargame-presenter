// Thin wrapper around the local JSON API (server.py).
async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  listWargames: () => request('GET', '/api/wargames'),
  getWargame: (id) => request('GET', `/api/wargames/${encodeURIComponent(id)}`),
  createWargame: (wg) => request('POST', '/api/wargames', wg),
  saveWargame: (id, wg) => request('PUT', `/api/wargames/${encodeURIComponent(id)}`, wg),
  deleteWargame: (id) => request('DELETE', `/api/wargames/${encodeURIComponent(id)}`),
  duplicateWargame: (id) => request('POST', `/api/wargames/${encodeURIComponent(id)}/duplicate`),
  exportWargame: (id) => request('GET', `/api/wargames/${encodeURIComponent(id)}/export`),
  importWargame: (data) => request('POST', '/api/import', data),
  uploadMedia: (id, name, dataUrl) => request('POST', `/api/wargames/${encodeURIComponent(id)}/media`, { name, data: dataUrl }),
  listMedia: (id) => request('GET', `/api/wargames/${encodeURIComponent(id)}/media`),
  listRuns: (wargameId) => request('GET', `/api/runs${wargameId ? `?wargame=${encodeURIComponent(wargameId)}` : ''}`),
  getRun: (id) => request('GET', `/api/runs/${encodeURIComponent(id)}`),
  saveRun: (id, run) => request('PUT', `/api/runs/${encodeURIComponent(id)}`, run),
  deleteRun: (id) => request('DELETE', `/api/runs/${encodeURIComponent(id)}`),
};
