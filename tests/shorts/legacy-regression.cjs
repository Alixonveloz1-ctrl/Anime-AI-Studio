const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='958248ec2fe90fb4a2b0b5004d2a53642a274995';
const old=f=>execFileSync('git',['show',`${base}:${f}`],{encoding:'utf8'});
// U005 adds an owner check to all APIs. Normalize ONLY that exact preamble;
// generation, storage, diagnostics and montage bodies must remain identical.
for(const name of fs.readdirSync('api').filter(x=>x.endsWith('.js')&&x!=='shorts.js')){
 const source=fs.readFileSync('api/'+name,'utf8');
 assert.ok(source.includes('if (await begin(req, res'),`Missing access boundary: ${name}`);
 const normalized=source.replace('if (await begin(req, res','if (begin(req, res').replace("  if (await require('./_lib/access').handleSession(req, res)) return;\n",'');
 assert.equal(normalized,old('api/'+name),`Legacy API body changed: ${name}`);
}
const helper=fs.readFileSync('api/_lib/gcp.js','utf8'),oldHelper=old('api/_lib/gcp.js');
assert.equal(helper.split('const CORS =')[0],oldHelper.split('const CORS =')[0],'Google/model/storage helpers changed');
assert.equal(helper.split('// Config errors')[1],oldHelper.split('// Config errors')[1],'Legacy exports/error behavior changed');
const current=fs.readFileSync('index.html','utf8'),original=old('index.html');
const scripts=s=>[...s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
assert.deepEqual(scripts(current),scripts(original),'Animes inline logic changed');
assert.equal(fs.readFileSync('tests/static-check.mjs','utf8'),old('tests/static-check.mjs'));
const config=JSON.parse(fs.readFileSync('vercel.json')),previous=JSON.parse(old('vercel.json'));
for(const [route,value] of Object.entries(previous.functions))assert.deepEqual(config.functions[route],value);
for(const file of ['i','setup.sh','worker/montage/runner.sh'])assert.equal(fs.readFileSync(file,'utf8'),old(file),`Legacy installer/worker changed: ${file}`);
console.log('A003/A006/A008/A085 + U005: only access preambles changed; legacy scripts, provider helpers, API bodies, installers and worker unchanged. Real project export remains pending.');
