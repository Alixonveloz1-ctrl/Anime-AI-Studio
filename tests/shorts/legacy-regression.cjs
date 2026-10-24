const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='958248ec2fe90fb4a2b0b5004d2a53642a274995';
const old=f=>execFileSync('git',['show',`${base}:${f}`],{encoding:'utf8'});
// U005 adds an owner check to all APIs. Normalize ONLY that exact preamble;
// generation and montage bodies must remain identical. Storage adds only the
// separately tested recovery actions and immutable backup-before-save hook. U006 also
// permits one counts-only log at the successful project read boundary.
for(const name of fs.readdirSync('api').filter(x=>x.endsWith('.js')&&x!=='shorts.js')){
 const source=fs.readFileSync('api/'+name,'utf8');
 assert.ok(source.includes('if (await begin(req, res'),`Missing access boundary: ${name}`);
 // Project manifests (list/get/conditional save) and recovery now live in
 // api/_lib/project-store.js and project-recovery.js, tested in tests/recovery.
 const normalized=source.replace(/      \/\/ Project manifests: listing, reading and conditional saves[\s\S]*?(?=      if \(action === 'projectDelete'\))/, '').replace('if (await begin(req, res','if (begin(req, res').replace("  if (await require('./_lib/access').handleSession(req, res)) return;\n",'');
 const previous=old('api/'+name).replace(/      if \(action === 'projectList'\) \{[\s\S]*?(?=      if \(action === 'projectDelete'\))/, '');
 assert.equal(normalized,previous,`Legacy API body changed: ${name}`);
}
const helper=fs.readFileSync('api/_lib/gcp.js','utf8'),oldHelper=old('api/_lib/gcp.js');
assert.equal(helper.split('const CORS =')[0],oldHelper.split('const CORS =')[0],'Google/model/storage helpers changed');
assert.equal(helper.split('// Config errors')[1],oldHelper.split('// Config errors')[1],'Legacy exports/error behavior changed');
const current=fs.readFileSync('index.html','utf8'),original=old('index.html');
const scripts=s=>[...s.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
// Keep the exact character/scene markup and generation controls. Only their
// read scheduling changes; failing media cannot hide every character or scene.
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const charMarkup=source=>section(source,'    const defaultPrompt = `Single clean character reference',source.includes('const markup = ({ ch, imgSrc })')?'  };\n  return renderStoredCards':'  }).join(\'\');');
const sceneMarkup=source=>section(source,"  const selRatio = document.getElementById('aspectRatio')",source.includes('const markup = ({ s, imgA')?'  `;};':'  `;}).join(\'\');').replace('const markup = ({ s, imgA, imgB, imgC, audData, vids }) => {','c.innerHTML = items.map(({ s, imgA, imgB, imgC, audData, vids }) => {');
assert.equal(charMarkup(current),charMarkup(original),'Character prompts/markup changed');
assert.equal(sceneMarkup(current),sceneMarkup(original),'Scene generation controls/markup changed');
// Every top-level statement of the Animes script stays byte-identical to the
// baseline, except the statements listed in FIXED. Each entry names what was
// fixed and the real-page test that covers it; any other change fails here.
function topLevelUnits(code){
 // A unit starts at a column-0 line outside every bracket, string, template
 // literal and comment. Column-0 comment lines are not part of the comparison.
 const units=[],stack=[],n=code.length,word=/[A-Za-z0-9_$]/;let start=0,depth=0,i=0,last='';
 const regexAllowed=()=>!last||/[(,=:[!&|?{};+\-*%<>~^]$/.test(last)||/^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(last);
 const template=p=>{while(p<n){const d=code[p];if(d==='\\'){p+=2;continue;}if(d==='`')return p+1;if(d==='$'&&code[p+1]==='{'){stack.push({depth:0});depth++;return p+2;}p++;}return p;};
 const push=end=>{const text=code.slice(start,end).split('\n').filter(l=>!l.startsWith('//')).join('\n').trim();if(text)units.push(text);};
 while(i<n){
  const c=code[i];
  if(c==='\n'){i++;if(depth===0&&i<n&&/[^\s})\]]/.test(code[i])&&!code.startsWith('//',i)){push(i);start=i;}continue;}
  if(/\s/.test(c)){i++;continue;}
  if(c==='/'&&code[i+1]==='/'){while(i<n&&code[i]!=='\n')i++;continue;}
  if(c==='/'&&code[i+1]==='*'){i=code.indexOf('*/',i+2);i=i<0?n:i+2;continue;}
  if(c==='"'||c==="'"){i++;while(i<n&&code[i]!==c){if(code[i]==='\\')i++;i++;}i++;last='str';continue;}
  if(c==='`'){i=template(i+1);last='str';continue;}
  if(c==='/'&&regexAllowed()){i++;let cls=false;while(i<n&&code[i]!=='\n'){const d=code[i];if(d==='\\'){i+=2;continue;}if(d==='[')cls=true;else if(d===']')cls=false;else if(d==='/'&&!cls)break;i++;}i++;while(i<n&&/[a-z]/.test(code[i]))i++;last='re';continue;}
  if('{(['.includes(c)){depth++;if(stack.length)stack[stack.length-1].depth++;last=c;i++;continue;}
  if(c==='}'&&stack.length&&stack[stack.length-1].depth===0){stack.pop();depth--;i=template(i+1);last='str';continue;}
  if('})]'.includes(c)){depth--;if(stack.length)stack[stack.length-1].depth--;last=c;i++;continue;}
  if(word.test(c)){let j=i;while(j<n&&word.test(code[j]))j++;last=code.slice(i,j);i=j;continue;}
  last=c;i++;
 }
 push(n);
 return units;
}
const FIXED=[
 // U006: project loading and paint (tests/shorts/ui/animes-loading.test.mjs).
 [/^(async )?function (loadStateFor|switchProject|renderAll|renderCharacters|renderScenes|renderStoredCards|cloudGetDbValue)\(/,'U006 loading'],
 [/^\(async function init\(\) \{/,'U006 loading; uploads other projects\' unsynced changes'],
 // Project sync: one save in flight, conditional on the GCS generation, retried,
 // never pruned or overwritten while unsynced; honest project list; Nuevo
 // Proyecto exists in the cloud before it opens (tests/shorts/ui/animes-sync.test.mjs).
 [/^(let cloudSaveTimer|let pendingCloudSave|let cloudSyncWarningShown|const nube|const claveVersion|const claveSinSubir)\b/,'project sync state'],
 [/^(async )?function (syncDe|recordarVersion|tieneCambiosSinSubir|marcarSinSubir|cloudSaveProject|queueCloudProjectSave|enviarGuardado|sincronizarPendientes|subirCambiosPendientesDeOtros|resolverConflicto|cloudLoadProject|cloudListProjects|migrateThisBrowserToCloud|refreshProjectsFromCloud|pruneDeviceCacheExcept|newProject|crearProyecto|deleteProject|openProjectsModal)\(/,'project sync'],
 [/^(document|window)\.addEventListener\('(visibilitychange|pagehide|online)', sincronizarPendientes\);$/,'project sync flush'],
 // Nothing can switch anime or episode while media for the open one is being
 // generated (tests/shorts/ui/animes-sync.test.mjs).
 [/^(const ocupaciones|let ocupacionSeq|let peticionesDeGeneracion|const RUTAS_DE_GENERACION|const fetchSinVigilar|window\.fetch = function)\b/,'generation guard'],
 [/^function (ocuparProyecto|trabajoEnCurso|bloqueadoPorTrabajo)\(/,'generation guard'],
 [/^window\.switchEpisode = function\(ep\) \{/,'generation guard'],
 [/^for \(const \[clave, etiqueta\] of Object\.entries\(\{/,'generation guard wraps the media generators'],
 [/^document\.getElementById\('(btnGenerarUniverso|btnGenerarEpisodio|btnNextEpisode)'\)\.addEventListener\('click'/,'generation guard'],
 // The image batch always releases its lock (tests/shorts/ui/animes-sync.test.mjs).
 [/^document\.getElementById\('btnAllImages'\)\.addEventListener\('click'/,'image batch lock'],
 // Episode tabs and the generate buttons are repainted with every render, so
 // they always describe the open project (tests/shorts/ui/animes-sync.test.mjs).
 [/^function updateEpisodeNav\(\) \{/,'episode navigation'],
 [/^window\.addEventListener\('load', \(\) => setTimeout\(updateEpisodeNav, 500\)\);$/,'episode navigation (replaced by renderAll)'],
];
{
 const units=source=>scripts(source).flatMap(topLevelUnits);
 const now=units(current),before=units(original);
 const minus=(a,b)=>{const left=new Map();for(const u of b)left.set(u,(left.get(u)||0)+1);return a.filter(u=>{const k=left.get(u)||0;if(k){left.set(u,k-1);return false;}return true;});};
 const changed=[...minus(before,now),...minus(now,before)].map(u=>u.split('\n')[0]);
 const unexplained=[...new Set(changed.filter(head=>!FIXED.some(([pattern])=>pattern.test(head))))];
 assert.deepEqual(unexplained,[],'Animes logic changed outside the listed, tested fixes');
}
assert.deepEqual([...current.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x=>x[1]),[...original.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x=>x[1]),'Original Animes design changed');
assert.equal(fs.readFileSync('tests/static-check.mjs','utf8'),old('tests/static-check.mjs'));
const config=JSON.parse(fs.readFileSync('vercel.json')),previous=JSON.parse(old('vercel.json'));
for(const [route,value] of Object.entries(previous.functions))assert.deepEqual(config.functions[route],value);
for(const file of ['i','setup.sh','worker/montage/runner.sh'])assert.equal(fs.readFileSync(file,'utf8'),old(file),`Legacy installer/worker changed: ${file}`);
console.log('A003/A006/A008/A085 + U005/U006 + listed Animes fixes: every changed Animes statement is listed and tested; design, provider helpers, generation APIs, installers and worker unchanged; recovery/backup and project-store changes are explicitly bounded and tested. Real project export remains pending.');
