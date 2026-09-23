// One owner boundary for the whole studio. No provider/service-account calls
// are allowed before this check, including calls made outside the browser.
const { verify } = require('node:crypto');
const COOKIE = '__Host-studio_session';
const CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const denied = () => new AccessError(401, 'Entra con tu cuenta para continuar.');

function configuration(env = process.env) {
  let config;
  try { config = JSON.parse(env.SHORTS_FIREBASE_WEB_CONFIG || 'null'); } catch {}
  const emails = String(env.STUDIO_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!config || !/^[a-z0-9-]+$/.test(config.projectId || '') ||
      typeof config.apiKey !== 'string' || !config.apiKey || !config.authDomain || !config.appId || !emails.length)
    throw new AccessError(503, 'El acceso privado está pendiente de conexión. Las generaciones están bloqueadas.');
  // This is public Firebase client configuration, never service credentials.
  const firebase = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].map(k => [k, config[k]]));
  return { firebase, emails };
}

function createVerifier({ fetcher = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let keys = {}, expires = 0;
  return async function verifyOwner(token, settings = configuration()) {
    if (typeof token !== 'string' || token.length > 3800 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw denied();
    const [head, body, signature] = token.split('.');
    let header, claims;
    try { header = JSON.parse(Buffer.from(head, 'base64url')); claims = JSON.parse(Buffer.from(body, 'base64url')); } catch { throw denied(); }
    const seconds = Math.floor(now() / 1000), { firebase, emails } = settings;
    if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        claims.aud !== firebase.projectId || claims.iss !== 'https://securetoken.google.com/' + firebase.projectId ||
        typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 128 ||
        !Number.isInteger(claims.exp) || claims.exp <= seconds ||
        !Number.isInteger(claims.iat) || claims.iat > seconds || claims.iat < 0 || claims.iat >= claims.exp ||
        !Number.isInteger(claims.auth_time) || claims.auth_time > seconds || claims.auth_time < 0 ||
        claims.email_verified !== true || claims.firebase?.sign_in_provider !== 'google.com') throw denied();
    try {
      if (expires <= now()) {
        const r = await fetcher(CERTS, { signal: AbortSignal.timeout(4000), redirect: 'error' });
        if (!r.ok) throw new Error('certificates');
        keys = await r.json();
        const age = Number(/(?:^|,)\s*max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1] || 0);
        expires = now() + Math.min(age, 21600) * 1000;
      }
      if (!Object.hasOwn(keys, header.kid) || !verify('RSA-SHA256', Buffer.from(head + '.' + body), keys[header.kid], Buffer.from(signature, 'base64url'))) throw denied();
      if (!emails.includes(String(claims.email || '').toLowerCase()))
        throw new AccessError(403, 'Esta aplicación es privada. Usa la cuenta autorizada.');
      // Check the current user, disabled state and revocation on every request.
      // No long-lived auth cache, no unverified client email or user ID.
      const r = await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(firebase.apiKey), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(4000), redirect: 'error',
      });
      if (r.status === 400 || r.status === 401) throw denied();
      if (!r.ok) throw new Error('identity unavailable');
      const account = (await r.json()).users?.[0];
      if (!account || account.localId !== claims.sub || account.disabled || account.emailVerified !== true ||
          String(account.email || '').toLowerCase() !== String(claims.email).toLowerCase() ||
          !Number.isFinite(Number(account.validSince || 0)) || Number(account.validSince || 0) > claims.auth_time) throw denied();
      return { uid: claims.sub, exp: claims.exp };
    } catch (e) {
      if (e instanceof AccessError) throw e;
      throw new AccessError(503, 'No se pudo comprobar el acceso. No se inició ninguna generación.');
    }
  };
}
const verifyOwner = createVerifier();

function tokenFrom(req) {
  const bearer = req.headers.authorization;
  if (bearer) return bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  // Host is the served origin, never a client-supplied forwarding header.
  return origin === 'https://' + req.headers.host && req.headers['sec-fetch-site'] !== 'cross-site';
}
function privateHeaders(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function reject(res, error) {
  const status = error instanceof AccessError ? error.status : 503;
  res.status(status).json({ error: error instanceof AccessError ? error.message : 'No se pudo comprobar el acceso.', code: status === 503 ? 'ACCESS_UNAVAILABLE' : 'ACCESS_DENIED' });
  return true;
}
async function requireOwner(req, res) {
  privateHeaders(res);
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw new AccessError(403, 'Solicitud de otro sitio rechazada.');
    req.studioOwner = await verifyOwner(tokenFrom(req));
    return false;
  } catch (e) { return reject(res, e); }
}
function cookie(res, token = '', seconds = 0) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`);
}

// Reuse the existing health function: no extra Vercel function or public
// diagnostics. Only client config and the login handshake are public.
async function handleSession(req, res) {
  const action = new URL(req.url, 'https://studio.invalid').searchParams.get('studioAuth');
  if (!action) return false;
  privateHeaders(res);
  try {
    if (!['config', 'status', 'session', 'logout'].includes(action)) throw new AccessError(404, 'Ruta no disponible.');
    const method = ['session', 'logout'].includes(action) ? 'POST' : 'GET';
    if (req.method !== method) throw new AccessError(405, 'Método no admitido.');
    if (method === 'POST' && !sameOrigin(req)) throw new AccessError(403, 'Solicitud de otro sitio rechazada.');
    if (action === 'logout') { cookie(res); res.status(200).json({ signedOut: true }); return true; }
    if (action === 'config') { res.status(200).json({ firebase: configuration().firebase }); return true; }
    if (action === 'session' && !req.headers.authorization?.startsWith('Bearer ')) throw denied();
    const identity = await verifyOwner(tokenFrom(req));
    if (action === 'session') cookie(res, tokenFrom(req), Math.max(0, identity.exp - Math.floor(Date.now() / 1000)));
    res.status(200).json({ uid: identity.uid });
    return true;
  } catch (e) { return reject(res, e); }
}
module.exports = { COOKIE, CERTS, AccessError, configuration, createVerifier, requireOwner, handleSession, tokenFrom, sameOrigin };
