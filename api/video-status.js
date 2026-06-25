// ════════════════════════════════════════════════════════════════
// VIDEO STATUS — Veo 3.1 polling (Edge Runtime)
// Returns a V4 Signed URL (7 days) — works without public bucket access
// MODEL_ID must match video-start.js exactly
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

const MODEL_ID = 'veo-3.1-lite-generate-001';
const LOCATION  = 'us-central1';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const header  = { alg:'RS256', typ:'JWT' };
  const payload = { iss:sa.client_email, sub:sa.client_email, aud:sa.token_uri, iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/cloud-platform' };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const r = await fetch(sa.token_uri, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token error: ' + JSON.stringify(d));
  return d.access_token;
}

// ─── GCS V4 Signed URL — 7 days, works without public bucket ───
async function generateSignedUrl(sa, bucket, objectPath, expiresSeconds = 604800) {
  const now = new Date();
  // Format: YYYYMMDDTHHMMSSZ
  const datetime = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = datetime.slice(0, 8);

  const credentialScope = `${date}/auto/storage/goog4_request`;
  const credential = `${sa.client_email}/${credentialScope}`;

  // Canonical query string (params must be sorted alphabetically)
  const queryParams = [
    `X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    `X-Goog-Credential=${encodeURIComponent(credential)}`,
    `X-Goog-Date=${datetime}`,
    `X-Goog-Expires=${expiresSeconds}`,
    `X-Goog-SignedHeaders=host`,
  ].join('&');

  // Canonical request — path must include bucket for path-style GCS URLs
  const canonicalRequest = [
    'GET',
    `/${bucket}/${objectPath}`,
    queryParams,
    `host:storage.googleapis.com`,
    '',          // blank line after headers
    'host',      // signed headers
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  // Hash canonical request
  const crHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
  const crHex = Array.from(new Uint8Array(crHash)).map(b => b.toString(16).padStart(2,'0')).join('');

  // String to sign
  const stringToSign = ['GOOG4-RSA-SHA256', datetime, credentialScope, crHex].join('\n');

  // Sign with SA private key
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const signKey = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signKey, new TextEncoder().encode(stringToSign));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

  return `https://storage.googleapis.com/${bucket}/${objectPath}?${queryParams}&X-Goog-Signature=${sigHex}`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error:'Method not allowed' }), { status:405, headers:CORS });

  try {
    const { operationName, projectId } = await req.json();
    if (!operationName) return new Response(JSON.stringify({ error:'operationName requerido' }), { status:400, headers:CORS });

    const sa = JSON.parse((process.env.GCP_SERVICE_ACCOUNT || '').trim());
    const pid = projectId || sa.project_id;
    const token = await getAccessToken(sa);

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${pid}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:fetchPredictOperation`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': pid },
      body: JSON.stringify({ operationName }),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return new Response(JSON.stringify({ error: `Status check: ${msg}` }), { status: response.status, headers: CORS });
    }

    if (!data.done) return new Response(JSON.stringify({ done: false }), { headers: CORS });

    if (data.response?.raiMediaFilteredCount > 0 && !data.response?.videos?.length) {
      return new Response(JSON.stringify({ done: true, error: 'Video bloqueado por filtros de seguridad — modifica el prompt' }), { headers: CORS });
    }

    const video = data.response?.videos?.[0];
    if (!video?.gcsUri) {
      return new Response(JSON.stringify({ done: true, error: 'Veo terminó pero no devolvió video' }), { headers: CORS });
    }

    const gcsUri = video.gcsUri;
    // Parse gs://bucket/path
    const gcsPath  = gcsUri.replace('gs://', '');
    const slash    = gcsPath.indexOf('/');
    const bucket   = gcsPath.slice(0, slash);
    const objPath  = gcsPath.slice(slash + 1);

    // Generate V4 Signed URL — 7 days, no public access needed
    const signedUrl = await generateSignedUrl(sa, bucket, objPath, 604800);

    return new Response(JSON.stringify({ done: true, gcsUri, publicUrl: signedUrl }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
