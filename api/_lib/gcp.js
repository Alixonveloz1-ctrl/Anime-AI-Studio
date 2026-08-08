// ════════════════════════════════════════════════════════════════
// SHARED GOOGLE CLOUD HELPERS
//
// Files under api/_lib/ are NOT deployed as serverless functions
// (Vercel skips anything starting with "_"), so this is a plain
// shared module for the real endpoints.
//
// Two jobs:
//   1. ONE place that turns GCP_SERVICE_ACCOUNT into credentials.
//      It used to be copy-pasted into all five endpoints.
//   2. ONE place that resolves models and regions, every one of them
//      overridable by an environment variable. Switching accounts —
//      or working around a model that a new project has no allowlist
//      for — must never require a code change.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ─── Configuration: every value overridable from Vercel ───
const env = (name, fallback) => {
  const v = (process.env[name] || '').trim();
  return v || fallback;
};

// Read through to process.env on every access rather than snapshotting at
// require() time, so the resolved value always reflects the current
// environment (and so tests can vary it without module-cache tricks).
const cfg = {
  // Default region for Vertex AI calls that are not model-specific.
  get location()       { return env('GCP_LOCATION', 'us-central1'); },

  // Text generation (universe, characters, story, image prompts, direction).
  get scriptModel()    { return env('SCRIPT_MODEL', 'gemini-3.1-pro-preview'); },
  // Gemini 3.x preview models are only served from the "global" endpoint.
  get scriptLocation() { return env('SCRIPT_LOCATION', 'global'); },

  // Images.
  get imageModel()     { return env('IMAGE_MODEL', 'gemini-2.5-flash-image'); },
  get imageRegions()   { return env('IMAGE_REGIONS', 'us-central1,europe-west4,us-east4')
                                  .split(',').map(s => s.trim()).filter(Boolean); },

  // Narration (Gemini TTS, with a fallback for projects without access to
  // the preferred model).
  get ttsModel()       { return env('TTS_MODEL', 'gemini-3.1-flash-tts-preview'); },
  get ttsFallback()    { return env('TTS_FALLBACK_MODEL', 'gemini-2.5-flash-preview-tts'); },
  get ttsLocation()    { return env('TTS_LOCATION', this.location); },

  // Video.
  get veoModel()       { return env('VEO_MODEL', 'veo-3.1-lite-generate-001'); },
  get veoLocation()    { return env('VEO_LOCATION', this.location); },

  // Music (Lyria).
  get musicModel()     { return env('MUSIC_MODEL', 'lyria-002'); },
  get musicLocation()  { return env('MUSIC_LOCATION', this.location); },

  // Subtitle forced alignment (Speech-to-Text).
  get sttModel()       { return env('STT_MODEL', 'latest_long'); },
  get sttLanguage()    { return env('STT_LANGUAGE', 'es-US'); },

  get bucket()         { return env('GCS_OUTPUT_BUCKET', '').replace(/^gs:\/\//, '').replace(/\/+$/, ''); },

  // Cloud Run ffmpeg service that assembles the final MP4. Empty until the
  // service is deployed; the app reports it as unavailable instead of failing.
  get assemblyUrl()    { return env('ASSEMBLY_SERVICE_URL', '').replace(/\/+$/, ''); },
};

// Per-model endpoint locations for image generation. Overridable wholesale
// with IMAGE_MODEL_LOCATIONS as JSON, e.g. {"my-model":"global"}.
function imageModelLocations() {
  const base = {
    'gemini-2.5-flash-image':         'us-central1',
    'gemini-3.1-flash-image-preview': 'global',
    'gemini-3-pro-image-preview':     'global',
  };
  try {
    return { ...base, ...JSON.parse(env('IMAGE_MODEL_LOCATIONS', '{}')) };
  } catch (e) {
    return base;
  }
}

// Unknown models default to "global": every recent Gemini image preview
// model is served there, so a newly released model works without a deploy.
function imageModelLocation(model) {
  return imageModelLocations()[model] || 'global';
}

// ─── Credentials ───
class ConfigError extends Error {}

function loadServiceAccount() {
  const raw = (process.env.GCP_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new ConfigError('GCP_SERVICE_ACCOUNT no configurado en Vercel');
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError('GCP_SERVICE_ACCOUNT no es JSON válido — pega el archivo completo de la service account');
  }
  if (!sa.project_id)   throw new ConfigError('GCP_SERVICE_ACCOUNT sin project_id — ¿pegaste el JSON completo?');
  if (!sa.client_email) throw new ConfigError('GCP_SERVICE_ACCOUNT sin client_email');
  if (!sa.private_key)  throw new ConfigError('GCP_SERVICE_ACCOUNT sin private_key');
  if (!sa.token_uri)    sa.token_uri = 'https://oauth2.googleapis.com/token';
  return sa;
}

// Access tokens last an hour. Vercel reuses warm instances across requests,
// so caching saves an OAuth round-trip on most calls.
let tokenCache = { key: null, token: null, expiresAt: 0 };

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = sa.client_email;
  if (tokenCache.token && tokenCache.key === cacheKey && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  // Native crypto signing: the PEM goes straight to createSign, which parses
  // headers and newlines itself. An earlier atob()-based decode threw
  // "The string did not match the expected pattern" on Vercel whenever the
  // key carried stray whitespace.
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${sig}`,
  });
  const d = await r.json();
  if (!d.access_token) {
    throw new Error(`OAuth: ${d.error_description || d.error || JSON.stringify(d).slice(0, 200)}`);
  }

  tokenCache = { key: cacheKey, token: d.access_token, expiresAt: now + (d.expires_in || 3600) };
  return d.access_token;
}

// ─── GCS V4 signed URL ───
// Works for GET (download) and PUT (direct browser upload), so large assets
// never travel through a Vercel function.
function signedUrl(sa, bucket, objectPath, { method = 'GET', expiresSeconds = 604800 } = {}) {
  const now = new Date();
  const datetime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const date = datetime.slice(0, 8);

  const credentialScope = `${date}/auto/storage/goog4_request`;
  const credential = `${sa.client_email}/${credentialScope}`;

  // Query params must be sorted alphabetically for the canonical request.
  const queryParams = [
    `X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    `X-Goog-Credential=${encodeURIComponent(credential)}`,
    `X-Goog-Date=${datetime}`,
    `X-Goog-Expires=${expiresSeconds}`,
    `X-Goog-SignedHeaders=host`,
  ].join('&');

  // Path-style GCS URL, so the bucket is part of the canonical path.
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method,
    `/${bucket}/${encodedPath}`,
    queryParams,
    `host:storage.googleapis.com`,
    '',                 // blank line after headers
    'host',             // signed headers
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const crHex = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['GOOG4-RSA-SHA256', datetime, credentialScope, crHex].join('\n');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign);
  const sigHex = signer.sign(sa.private_key, 'hex');

  return `https://storage.googleapis.com/${bucket}/${encodedPath}?${queryParams}&X-Goog-Signature=${sigHex}`;
}

// ─── Google-signed ID token ───
// Cloud Run is deployed private (--no-allow-unauthenticated); calling it needs
// an ID token whose audience is the service URL, not an access token.
async function getIdToken(sa, audience) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    target_audience: audience,
  };
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${sig}`,
  });
  const d = await r.json();
  if (!d.id_token) throw new Error(`ID token: ${d.error_description || d.error || 'sin id_token'}`);
  return d.id_token;
}

// Convenience: credentials + project + token in one call.
async function auth() {
  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);
  return { sa, projectId: sa.project_id, token };
}

// Vertex AI publisher-model endpoint. `location: 'global'` uses the
// non-regional host, everything else uses the regional one.
function vertexUrl(projectId, location, model, method) {
  const host = location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${method}`;
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Shared preamble: CORS, preflight, method guard. Returns true when the
// caller should stop (the response is already finished).
function begin(req, res, methods = ['POST']) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  if (!methods.includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return true;
  }
  return false;
}

// Config errors are the user's to fix in Vercel, so they get a 500 with a
// message that says exactly which variable is wrong.
function fail(res, e) {
  const isConfig = e instanceof ConfigError;
  return res.status(isConfig ? 500 : 500).json({ error: e.message, configError: isConfig || undefined });
}

module.exports = {
  cfg, imageModelLocation, imageModelLocations, signedUrl, getIdToken,
  ConfigError, loadServiceAccount, getAccessToken, auth,
  vertexUrl, CORS, begin, fail,
};
