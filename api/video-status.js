// ════════════════════════════════════════════════════════════════
// VIDEO STATUS — Veo 3.1 polling (Edge Runtime — no 60s limit)
// Polls fetchPredictOperation and returns done/publicUrl
// MODEL_ID must match video-start.js exactly
// ════════════════════════════════════════════════════════════════
export const config = { runtime: 'edge' };

const MODEL_ID = 'veo-3.1-lite-generate-001'; // must match video-start.js exactly
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
  const payload = {
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\n/g,'');
  const keyDer = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyDer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${signingInput}.${b64sig}`;
  const r = await fetch(sa.token_uri, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token error: ' + JSON.stringify(d));
  return d.access_token;
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
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': pid,
      },
      body: JSON.stringify({ operationName }),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 200);
      return new Response(JSON.stringify({ error: `Status check: ${msg}` }), { status: response.status, headers: CORS });
    }

    // Still processing
    if (!data.done) return new Response(JSON.stringify({ done: false }), { headers: CORS });

    // Blocked by RAI safety filters
    if (data.response?.raiMediaFilteredCount > 0 && !data.response?.videos?.length) {
      return new Response(JSON.stringify({ done: true, error: 'Video bloqueado por filtros de seguridad — modifica el prompt de video' }), { headers: CORS });
    }

    const video = data.response?.videos?.[0];
    if (!video?.gcsUri) {
      return new Response(JSON.stringify({ done: true, error: 'Veo terminó pero no devolvió video' }), { headers: CORS });
    }

    const gcsUri = video.gcsUri;
    const publicUrl = 'https://storage.googleapis.com/' + gcsUri.replace('gs://', '');

    // Patch Content-Disposition so iOS Safari downloads instead of opening in browser
    try {
      const gcsPath   = gcsUri.replace('gs://', '');
      const slash     = gcsPath.indexOf('/');
      const bucket    = gcsPath.slice(0, slash);
      const objPath   = gcsPath.slice(slash + 1);
      await fetch(
        `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objPath)}`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentDisposition: 'attachment; filename="video.mp4"' }),
        }
      );
    } catch (e) {
      console.warn('Content-Disposition patch failed:', e.message);
    }

    return new Response(JSON.stringify({ done: true, gcsUri, publicUrl }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
