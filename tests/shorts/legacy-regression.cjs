const fs=require('node:fs'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='958248ec2fe90fb4a2b0b5004d2a53642a274995';
const old=f=>execFileSync('git',['show',`${base}:${f}`],{encoding:'utf8'});
// U005 adds an owner check to all APIs. Normalize ONLY that exact preamble;
// generation and montage bodies must remain identical. Storage adds only the
// separately tested recovery actions and immutable backup-before-save hook. U006 also
// permits one counts-only log at the successful project read boundary.
// Generation APIs with deliberate, tested fixes: only these statements may differ.
const FIXED_API={
 // 50 s deadline answered as JSON {timeout:true}; Vertex status and
 // retryability travel with the error (tests/animes/script-api.test.cjs).
 'script.js':[/^const DEADLINE_MS = /,/^async function callModel\(/,/^module\.exports = async function handler\(/],
 // One 52 s budget for every Vertex call; a rescue step that would not fit is
 // continued in a new request; a text-only answer is a refusal, not missing
 // capacity (tests/animes/image-api.test.cjs).
 'image.js':[/^const (LIMITE_MS|MIN_PASO_MS|SIN_TIEMPO) = /,/^async function (callGeminiAtUrl|pedirImagen|callGemini)\(/,/^module\.exports = async function handler\(/],
 // The cue is written into the bucket and only its pointer is returned: 30 s of
 // stereo is 7.3 MB as base64, over Vercel's body limit, so the music never
 // reached the phone (tests/animes/music-api.test.cjs).
 'music.js':[/^const LIMITE_MS = /,/^const \{ cfg, auth, vertexUrl.*require\('\.\/_lib\/gcp'\);$/,/^module\.exports = async function handler\(/],
};
const minus=(a,b)=>{const left=new Map();for(const u of b)left.set(u,(left.get(u)||0)+1);return a.filter(u=>{const k=left.get(u)||0;if(k){left.set(u,k-1);return false;}return true;});};
for(const name of fs.readdirSync('api').filter(x=>x.endsWith('.js')&&x!=='shorts.js')){
 const source=fs.readFileSync('api/'+name,'utf8');
 assert.ok(source.includes('if (await begin(req, res'),`Missing access boundary: ${name}`);
 // Project manifests (list/get/conditional save) and recovery now live in
 // api/_lib/project-store.js and project-recovery.js, tested in tests/recovery.
 const normalized=source.replace(/      \/\/ Project manifests: listing, reading and conditional saves[\s\S]*?(?=      if \(action === 'projectDelete'\))/, '').replace('if (await begin(req, res','if (begin(req, res').replace("  if (await require('./_lib/access').handleSession(req, res)) return;\n",'');
 const previous=old('api/'+name).replace(/      if \(action === 'projectList'\) \{[\s\S]*?(?=      if \(action === 'projectDelete'\))/, '');
 if(FIXED_API[name]){
  const changed=[...minus(topLevelUnits(previous),topLevelUnits(normalized)),...minus(topLevelUnits(normalized),topLevelUnits(previous))].map(u=>u.split('\n')[0]);
  assert.deepEqual([...new Set(changed.filter(head=>!FIXED_API[name].some(pattern=>pattern.test(head))))],[],`Legacy API body changed outside the listed fixes: ${name}`);
 }else assert.equal(normalized,previous,`Legacy API body changed: ${name}`);
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
 const template=p=>{while(p<n){const d=code[p];if(d==='\\'){p+=2;continue;}if(d==='`'){last='str';return p+1;}if(d==='$'&&code[p+1]==='{'){stack.push({depth:0});depth++;last='{';return p+2;}p++;}last='str';return p;};
 const push=end=>{const text=code.slice(start,end).split('\n').filter(l=>!l.startsWith('//')).join('\n').trim();if(text)units.push(text);};
 while(i<n){
  const c=code[i];
  if(c==='\n'){i++;if(depth===0&&i<n&&/[^\s})\]]/.test(code[i])&&!code.startsWith('//',i)){push(i);start=i;}continue;}
  if(/\s/.test(c)){i++;continue;}
  if(c==='/'&&code[i+1]==='/'){while(i<n&&code[i]!=='\n')i++;continue;}
  if(c==='/'&&code[i+1]==='*'){i=code.indexOf('*/',i+2);i=i<0?n:i+2;continue;}
  if(c==='"'||c==="'"){i++;while(i<n&&code[i]!==c){if(code[i]==='\\')i++;i++;}i++;last='str';continue;}
  if(c==='`'){i=template(i+1);continue;}
  if(c==='/'&&regexAllowed()){i++;let cls=false;while(i<n&&code[i]!=='\n'){const d=code[i];if(d==='\\'){i+=2;continue;}if(d==='[')cls=true;else if(d===']')cls=false;else if(d==='/'&&!cls)break;i++;}i++;while(i<n&&/[a-z]/.test(code[i]))i++;last='re';continue;}
  if('{(['.includes(c)){depth++;if(stack.length)stack[stack.length-1].depth++;last=c;i++;continue;}
  if(c==='}'&&stack.length&&stack[stack.length-1].depth===0){stack.pop();depth--;i=template(i+1);continue;}
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
 // Text generation: a request over the time limit is made smaller instead of
 // resent unchanged, real Vertex blips are retried, long stories are read in
 // halves (tests/shorts/ui/animes-story.test.mjs, tests/animes/script-api.test.cjs).
 // The episode handler itself (story blocks, split, visual direction, new
 // characters, instructions) is listed above under the generation guard.
 [/^async function (callGeminiOnce|callGemini|extractScenariosFromStory|assignScenariosToScenes|revisarPlanos)\(/,'text generation limits'],
 // /api/image answers are read safely and rescue continuations are followed
 // (tests/shorts/ui/animes-media.test.mjs).
 [/^async function (pedirImagenAlServidor|generateImage|generateImageRaw)\(/,'image requests'],
 // Cast-mode voices: the quota wait is per line and finished lines are kept,
 // so a pause never pays again for the lines already made; one-word lines are
 // voiced (tests/shorts/ui/animes-media.test.mjs).
 [/^(async function (generateAudio|generarAudioDeEscena)\(|const lineasDeVozHechas = |window\.generateSceneAudio = )/,'cast voices'],
 [/^document\.getElementById\('btnAllAudio'\)\.addEventListener\('click'/,'cast voices'],
 // The montage brings every narration and music cue to one format before
 // concatenating them: the concat demuxer reads them all with the first file's
 // header, so the episode went out of sync (tests/shorts/ui/animes-montage.test.mjs).
 [/^function buildMontarScript\(scenes, opts\) \{/,'montage audio format'],
 // Generated media: a bucket write or delete that did not happen is never
 // reported as done, an unuploaded file is kept and retried instead of pruned,
 // and a failed listing is not an empty project
 // (tests/shorts/ui/animes-media-cache.test.mjs).
 [/^(const CLAVE_MEDIOS_PENDIENTES = |function (mediosPendientes|marcarMedioPendiente)\(|async function (subirMediosPendientes|dbSet|dbDel|dbKeys|borrarMaterialDelEpisodio)\()/,'media cache honesty'],
 [/^function sincronizarPendientes\(\) \{/,'media cache honesty'],
 // Asking whether a scene already has its narration downloaded the whole
 // audio: one listing of the project answers for the entire episode
 // (tests/shorts/ui/animes-media-cache.test.mjs).
 [/^(const VIDA_DE_LA_LISTA = |let listaDeClaves = |function (listaDelProyecto|anotarClave)\(|async function (dbHas|cloudListDbKeys)\()/,'existence without downloading'],
 // Each clip is cut to its share of ITS narration: the measurement was cached
 // by scene id, and scene ids repeat in every episode
 // (tests/shorts/ui/animes-media-cache.test.mjs).
 [/^async function sceneAudioSeconds\(s\) \{/,'clip length per episode'],
 // Voices: the saved narration language survives a reload (the list arrives
 // after the settings are restored), "Automática" gives a character a voice
 // nobody else has, and the bulk reference button uses the selected drawing
 // style like the single one (tests/shorts/ui/animes-voices.test.mjs).
 [/^async function cargarVoces\(\) \{/,'saved narration language'],
 [/^window\.setCharacterVoice = function\(id, voice\) \{/,'distinct automatic voice'],
 [/^document\.getElementById\('btnAllCharacterRefs'\)\?\.addEventListener\('click'/,'bulk references use the selected style'],
 // Episode music: ASCII bucket keys (the accented acts were refused), the cue
 // kept in the bucket instead of 7.3 MB of base64, a readable error, and the
 // montage reading it from there (tests/shorts/ui/animes-music.test.mjs).
 [/^(const (actoEnClave|musicKey) = |async function (arrayBufferDeAudio|generateEpisodeMusic|renderMusic|assembleEpisode|previsualizarMezcla)\(|function isMusicDbKey\()/,'episode music'],
 [/^async function dbGet\(k\) \{/,'episode music reads its pointer'],
 // The length selector shows the format fixed by episode 1 (animes-story.test.mjs).
 [/^function updateEpFormatNote\(\) \{/,'episode format lock'],
 // Episode tabs and the generate buttons are repainted with every render, so
 // they always describe the open project (tests/shorts/ui/animes-sync.test.mjs).
 [/^function updateEpisodeNav\(\) \{/,'episode navigation'],
 [/^window\.addEventListener\('load', \(\) => setTimeout\(updateEpisodeNav, 500\)\);$/,'episode navigation (replaced by renderAll)'],
];
{
 const units=source=>scripts(source).flatMap(topLevelUnits);
 const now=units(current),before=units(original);
 const changed=[...minus(before,now),...minus(now,before)].map(u=>u.split('\n')[0]);
 const unexplained=[...new Set(changed.filter(head=>!FIXED.some(([pattern])=>pattern.test(head))))];
 assert.deepEqual(unexplained,[],'Animes logic changed outside the listed, tested fixes');
}
// The one design change allowed: the scroll container reserves the iPhone's
// bottom safe area, or the last control of each panel ends under the tab bar
// (tests/shorts/ui/animes-layout.test.mjs).
const styles=source=>[...source.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  .map(x=>x[1].replace('padding:16px 14px calc(110px + env(safe-area-inset-bottom));','padding:16px 14px 110px;'));
assert.deepEqual(styles(current),styles(original),'Original Animes design changed');
assert.equal(fs.readFileSync('tests/static-check.mjs','utf8'),old('tests/static-check.mjs'));
const config=JSON.parse(fs.readFileSync('vercel.json')),previous=JSON.parse(old('vercel.json'));
for(const [route,value] of Object.entries(previous.functions))assert.deepEqual(config.functions[route],value);
for(const file of ['i','setup.sh','worker/montage/runner.sh'])assert.equal(fs.readFileSync(file,'utf8'),old(file),`Legacy installer/worker changed: ${file}`);
console.log('A003/A006/A008/A085 + U005/U006 + listed Animes fixes: every changed Animes statement is listed and tested; design, provider helpers, generation APIs, installers and worker unchanged; recovery/backup and project-store changes are explicitly bounded and tested. Real project export remains pending.');
