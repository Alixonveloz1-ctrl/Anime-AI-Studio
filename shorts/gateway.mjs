// Metadata-only gateway. No legacy configuration, credentials or Node APIs.
export async function handleShortsRequest(request, env = {}) {
  const json = (status, value) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  const path = new URL(request.url).searchParams.get('path') || '/health';
  const enabled = env.SHORTS_ENABLED === 'true';
  if (path === '/config') {
    let firebase = null;
    try { firebase = JSON.parse(env.SHORTS_FIREBASE_WEB_CONFIG || 'null'); } catch {}
    return json(200, { enabled, configured: !!(env.SHORTS_PRODUCTION_URL && firebase), firebase,
      environment: env.SHORTS_ENVIRONMENT || 'preview', generationsTested: false });
  }
  if (!enabled) return json(503, { code: 'SHORTS_DISABLED', error: 'Cortos está desactivado. Animes sigue disponible.' });
  let base;
  try { base = new URL(env.SHORTS_PRODUCTION_URL); } catch {
    return json(503, { code: 'SETUP_REQUIRED', error: 'Falta conectar el servicio de Cortos.' });
  }
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.run.app') || base.pathname !== '/' || base.search || base.username || base.password)
    return json(503, { error: 'Destino de Cortos inválido.' });
  if (env.VERCEL_ENV === 'preview' && env.SHORTS_ENVIRONMENT !== 'preview')
    return json(503, { code: 'PREVIEW_ISOLATION', error: 'La preview requiere configuración aislada.' });
  if (env.VERCEL_ENV === 'production' && env.SHORTS_ENVIRONMENT !== 'production')
    return json(503, { code: 'PRODUCTION_ISOLATION', error: 'Conecta Cortos a la página habitual desde el instalador de main.' });
  if (!/^\/(?:health|projects|jobs)(?:[A-Za-z0-9_/:.-]*)$/.test(path) || path.includes('..'))
    return json(400, { error: 'Ruta no válida.' });
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) return json(405, { error: 'Método no admitido.' });
  const headers = { 'Content-Type': 'application/json' };
  for (const key of ['authorization', 'if-match', 'idempotency-key']) {
    const value = request.headers.get(key);
    if (value) headers[key] = value;
  }
  const origin = request.headers.get('origin');
  if (origin) headers['X-Shorts-Origin'] = origin;
  let payload;
  if (request.method !== 'GET') {
    if (Number(request.headers.get('content-length')) > 1000000) return json(413, { error: 'Los medios se suben directamente al almacenamiento.' });
    payload = await request.text();
    if (new TextEncoder().encode(payload).length > 1000000) return json(413, { error: 'Máximo 1 MB de metadatos.' });
    try { JSON.parse(payload || '{}'); } catch { return json(400, { error: 'JSON inválido.' }); }
  }
  try {
    const upstream = await fetch(new URL(path, base), { method: request.method, headers, body: payload,
      redirect: 'error', signal: AbortSignal.timeout(25000) });
    if (!upstream.headers.get('content-type')?.includes('application/json')) return json(502, { error: 'Respuesta del servicio no válida.' });
    return json(upstream.status, await upstream.json());
  } catch {
    return json(503, { code: 'SERVICE_UNAVAILABLE', error: 'No se confirmó la respuesta. Conserva la operación; no repitas una generación a ciegas.' });
  }
}
