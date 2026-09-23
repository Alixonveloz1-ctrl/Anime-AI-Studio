// Metadata-only Cortos gateway. Does not import Animes credentials or storage.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  const enabled=process.env.SHORTS_ENABLED==='true';
  const path=String(req.query.path || '/health');
  if(path==='/config') {
    let firebase=null;
    try { firebase=JSON.parse(process.env.SHORTS_FIREBASE_WEB_CONFIG || 'null'); } catch {}
    return res.status(200).json({enabled,configured:!!(process.env.SHORTS_PRODUCTION_URL&&firebase),firebase,
      environment:process.env.SHORTS_ENVIRONMENT||'preview',generationsTested:false});
  }
  if(!enabled) return res.status(503).json({code:'SHORTS_DISABLED',error:'Cortos está desactivado. Animes sigue disponible.'});
  let base;
  try { base=new URL(process.env.SHORTS_PRODUCTION_URL); } catch {return res.status(503).json({code:'SETUP_REQUIRED',error:'Falta conectar el servicio de Cortos.'});}
  if(base.protocol!=='https:' || !base.hostname.endsWith('.run.app') || base.pathname!=='/' || base.search || base.username || base.password)
    return res.status(503).json({error:'Destino de Cortos inválido.'});
  if(process.env.VERCEL_ENV==='preview' && process.env.SHORTS_ENVIRONMENT!=='preview')
    return res.status(503).json({code:'PREVIEW_ISOLATION',error:'La preview requiere configuración aislada.'});
  if(!/^\/(?:health|projects|jobs)(?:[A-Za-z0-9_/:.-]*)$/.test(path) || path.includes('..'))
    return res.status(400).json({error:'Ruta no válida.'});
  if(!['GET','POST','PATCH'].includes(req.method))return res.status(405).json({error:'Método no admitido.'});
  const payload=req.method==='GET'?undefined:JSON.stringify(req.body||{});
  if(payload&&Buffer.byteLength(payload)>1000000)return res.status(413).json({error:'Los medios se suben directamente al almacenamiento.'});
  const headers={'Content-Type':'application/json'};
  for(const k of ['authorization','if-match','idempotency-key'])if(req.headers[k])headers[k]=req.headers[k];
  const origin=req.headers.origin;
  if(origin)headers['X-Shorts-Origin']=origin;
  try {
    const upstream=await fetch(new URL(path,base),{method:req.method,headers,body:payload,redirect:'error',signal:AbortSignal.timeout(25000)});
    const type=upstream.headers.get('content-type')||'';
    if(!type.includes('application/json'))return res.status(502).json({error:'Respuesta del servicio no válida.'});
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(503).json({code:'SERVICE_UNAVAILABLE',error:'No se confirmó la respuesta. Conserva la operación; no repitas una generación a ciegas.'});
  }
};
