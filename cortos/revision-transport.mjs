// A heartbeat changes the legacy backend's project revision without changing
// editorial content. Serialize project writes and translate ONLY acknowledged
// lease transitions from this page; genuine content conflicts remain conflicts.
export function revisionTransport(fetcher = globalThis.fetch) {
  const projects = new Map();
  function stateFor(id) {
    if (!projects.has(id)) projects.set(id, { queue: Promise.resolve(), leases: new Map() });
    return projects.get(id);
  }
  function bounded(work, signal) {
    if (!signal) return work;
    if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    return Promise.race([work, stopped]).finally(() => signal.removeEventListener('abort', abort));
  }
  return function transport(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, globalThis.location?.origin || 'http://localhost');
    const path = url.searchParams.get('path') || '';
    const match = /^\/projects\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path);
    const method = (init.method || 'GET').toUpperCase();
    if (url.pathname !== '/api/shorts' || !match || !['POST', 'PATCH'].includes(method)) return fetcher(input, init);
    const state = stateFor(match[1]);
    const task = state.queue.then(async () => {
      init.signal?.throwIfAborted();
      const headers = new Headers(init.headers);
      const header = headers.has('X-Shorts-Revision') ? 'X-Shorts-Revision' : 'If-Match';
      const original = headers.get(header);
      let revision = original && /^\d+$/.test(original) ? Number(original) : NaN;
      if (Number.isSafeInteger(revision)) {
        while (state.leases.has(revision)) revision = state.leases.get(revision);
        headers.set(header, String(revision));
      }
      const response = await bounded(Promise.resolve(fetcher(input, { ...init, headers })), init.signal);
      // Read the metadata before releasing the queue, not just response headers.
      // A failed/unreadable/uncertain response never establishes a transition.
      if (path === `/projects/${match[1]}/lease` && response.ok && Number.isSafeInteger(revision)) {
        let request, result;
        try {
          request = JSON.parse(init.body || '{}');
          result = await bounded(response.clone().json(), init.signal);
        } catch (error) {
          if (init.signal?.aborted) throw error;
          return response;
        }
        if (result.id === match[1] && result.lease?.session === request.session &&
            result.lease?.device === request.device && result.revision === revision + 1) {
          state.leases.set(revision, result.revision);
          while (state.leases.size > 128) state.leases.delete(state.leases.keys().next().value);
        }
      }
      return response;
    });
    state.queue = task.catch(() => {});
    return bounded(task, init.signal);
  };
}
