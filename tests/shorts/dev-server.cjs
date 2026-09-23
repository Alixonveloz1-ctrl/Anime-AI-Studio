// Local route smoke server; models disabled. Not a production backend.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/shorts'){
  req.query=Object.fromEntries(u.searchParams);res.status=n=>{res.statusCode=n;return res;};res.json=v=>res.end(JSON.stringify(v));res.setHeader('Content-Type','application/json');return import('../../shorts/gateway.mjs').then(async({handleShortsRequest})=>{const response=await handleShortsRequest(new Request('http://localhost:4173'+req.url,{method:req.method,...(req.method==='GET'?{}:{body:req,duplex:'half'})}),process.env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));});
 }
 const file=path.resolve(root,'.'+decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;return res.end('Not found');}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(4173,'0.0.0.0',()=>console.log('Local verification http://localhost:4173'));
