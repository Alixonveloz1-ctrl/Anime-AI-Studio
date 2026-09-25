// Explicit UI fixtures. This transport never contacts Google or a real backend.
const clone=value=>structuredClone(value);
const still='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#253527"/><path d="M0 260L200 130 370 280 640 150V360H0" fill="#50674c"/><circle cx="500" cy="95" r="35" fill="#d8edac"/><text x="32" y="330" fill="#eee" font-size="20" font-family="sans-serif">Imagen sintética para probar la interfaz</text></svg>');
export function createFixture({empty=false}={}){
 const data={story:'Haru espera el último tren, reconoce a una antigua amiga y decide quedarse para hablar.',title:'El último tren',bible:{dramatic:'Una despedida que se convierte en una decisión.',visual:'Anime 2D con luz de atardecer',characters:[{id:'hero',name:'Haru',japaneseReading:'ハル',age:28,objective:'Atreverse a hablar',relationships:[],speech:'Serena',voice:{name:'Kore',languageCode:'ja-JP',direction:'Contenida'},costumes:[{id:'coat',description:'Abrigo verde'}],referencePrompt:'Retrato de Haru'}],locations:[{id:'station',name:'Estación',layout:'Andén largo',entrances:[],windows:[],furniture:[],light:'Atardecer',soundZones:[],referencePrompt:'Estación tranquila'}],props:[]},shots:[{id:'shot1',beatId:'beat1',function:'Haru decide quedarse',frames:3600,treatment:'hold',prompt:'Haru espera bajo el reloj del andén.',referenceEntityIds:['hero','station'],locationId:'station',visibleCharacters:['hero'],offscreenCharacters:[],props:[],before:{hero:'De pie'},after:{hero:'Mira hacia la entrada'}},{id:'shot2',beatId:'beat1',function:'Una respuesta al otro lado',frames:3600,treatment:'camera2d',prompt:'La cámara se acerca al banco vacío.',referenceEntityIds:['station'],locationId:'station',visibleCharacters:[],offscreenCharacters:['hero'],props:[],before:{},after:{}}],beats:[{id:'beat1',change:'Decide hablar',minFrames:7200,preferredFrames:7200,maxFrames:7200}],utterances:[{id:'voice1',shotId:'shot1',speakerId:'hero',type:'dialogue',spanish:'Todavía estamos a tiempo.',japanese:'まだ間に合う。',acting:'Con esperanza',pauseBeforeFrames:0,pauseAfterFrames:12}],soundRequests:[{id:'door',name:'La puerta del andén',description:'Cierre seco de la puerta metálica.',prompt:'Metal station door closing, short dry impact.',seconds:2,preparationSeconds:.2,tailSeconds:.6,perspective:'Cerca de Haru',shotId:'shot1',eventDescription:'La puerta toca el marco',required:true}],musicRequests:[{id:'music1',prompt:'Piano íntimo, sin voces.',seconds:120,startFrame:0,endFrame:2880}],subtitles:[{utteranceId:'voice1',text:'Todavía estamos a tiempo.'}]};
 const asset=(id,entityId,kind,state='approved',created=1)=>({id,entityId,kind,approvalState:state,created,sha256:'hash-'+id,revision:1,samples:96000});
 const initialIdeas=[1,2,3].map(n=>({id:'idea'+n,batchId:'batch',created:n,data:{id:'concept'+n,title:['El último tren','La carta sin abrir','Cuando vuelva la lluvia'][n-1],premise:['Un encuentro pendiente en un andén.','Una carta llega veinte años después.','Dos antiguos rivales comparten refugio.'][n-1],initialSituation:'Una decisión cambia el rumbo.',obstacle:'El silencio entre ambos.',emotionalProgression:'Duda, tensión y esperanza.',ending:'La respuesta permanece abierta.'}}));
 const p={id:'fixture',owner:'test',title:'El último tren',genre:'drama',subgenres:['romance'],concept:'Dos personas se encuentran antes de partir.',format:'16:9',revision:1,stage:'tomas',created:1,ideas:initialIdeas,selectedIdea:{id:'idea1'},activeDevelopment:'dev',developments:[{id:'dev',dataHash:'data',data,created:1,revision:1,approvalState:'approved'}],assets:[asset('ref1','hero','image'),asset('ref2','station','image'),asset('img1','shot1','image'),asset('img2','shot2','image'),asset('imgCandidate','shot1','image','candidate',4),asset('imgOld','shot1','image','approved',0),asset('voice','voice1','pcm'),asset('sound','door','pcm'),asset('music','music1','pcm')],assetSelections:{'shot1|image':'img1'},cues:[{id:'cue',requestId:'door',shotId:'shot1',audioRevision:'sound',eventId:'event',eventDescription:'La puerta toca el marco',created:1,revision:1,approvalState:'candidate',analysisAttempts:2,sourceSyncSample:9600,trimInSample:0,trimOutSample:96000,offsetSamples:0,gainDb:0,manualLock:false}],events:[],timelines:[],previews:[],references:[],cueSelections:{},subtitleEdits:{}};
 p.developmentDrafts=[];
 p.assets.find(a=>a.id==='sound').requestId='door';
 if(empty){p.ideas=[];p.developments=[];p.assets=[];p.cues=[];delete p.selectedIdea;delete p.activeDevelopment;}
 const calls=[],jobs=[],keys=new Map();let n=0;
 function job(operation,result){const j={id:'job'+(++n),operation,state:'awaiting_review',created:n,revision:1,settled:true,result};jobs.push(j);return {jobId:j.id,state:j.state};}
 function render(final,body){const id='preview'+(++n),t=p.timelines.find(t=>t.id===(body.timelineId||p.activeTimeline));const row={id,created:n,state:'ready',final,timelineId:t.id,manifestHash:t.compiledHash,startFrame:body.startFrame||0,endFrame:body.endFrame||7200,url:still,draftIssues:[],current:true,fullProgram:true};p.previews.push(row);return job(final?'render':'preview',{previewId:id});}
 async function transport(url,options={}){
  const path=new URL(url,'https://fixture.invalid').searchParams.get('path'),method=options.method||'GET',body=options.body?JSON.parse(options.body):{};calls.push({path,method,body,headers:options.headers});
  let result;const key=options.headers?.['Idempotency-Key'];
  if(key&&keys.has(key))return new Response(JSON.stringify(keys.get(key)),{status:202});
  if(path==='/projects'&&method==='GET')result={projects:[p]};
  else if(path==='/projects'&&method==='POST'){Object.assign(p,body);result=p;}
  else if(path==='/projects/fixture'&&method==='GET')result=p;
  else if(path.endsWith('/lease')){p.revision++;p.lease={session:body.session,expires:Date.now()/1000+30};result=p;}
  else if(path.endsWith('/jobs'))result={jobs};
  else if(path.startsWith('/jobs/'))result=jobs.find(j=>j.id===path.split('/')[2]);
  else if(path.endsWith('/ideas:generate')){p.ideas=clone(initialIdeas);result=job('ideas',{});}
  else if(path.includes('/ideas/')&&path.endsWith(':select')){p.selectedIdea={id:path.split('/')[4].split(':')[0]};result=p;}
  else if(path.endsWith('/develop')){
   const step=body.stage||1,id='draft'+(++n),groups=[['title','story','beats'],['bible','shots','utterances'],['soundRequests','musicRequests','subtitles']];
   const prior=body.sourceDraftId?p.developmentDrafts.find(x=>x.id===body.sourceDraftId)?.data||{}:{};
   const current=step<4?{...clone(prior),...Object.fromEntries(groups[step-1].map(k=>[k,clone(data[k])]))}:clone(prior);
   p.developmentDrafts.push({id,ideaId:p.selectedIdea.id,stage:step,sourceDraftId:body.sourceDraftId,data:current,status:'ready',approvalState:'candidate',created:n});
   if(step===4)p.developments=[{id:'dev',data:current,created:n,revision:1,approvalState:'candidate'}];
   result=job('develop',{draftId:id,stage:step});
  }
  else if(path.includes('/drafts/')&&path.endsWith(':approve')){const id=path.split('/').at(-1).split(':')[0];const row=p.developmentDrafts.find(x=>x.id===id);row.approvalState='approved';p.activeDraft=id;result=row;}
  else if(path.includes('/drafts/')&&path.endsWith(':recover')){const row={id:'recovered'+(++n),ideaId:p.selectedIdea.id,stage:1,data:{title:data.title,story:data.story,beats:data.beats},created:n,status:'ready',approvalState:'candidate'};p.developmentDrafts.push(row);result=row;}
  else if(path.includes('/drafts/'))result=p.developmentDrafts.find(x=>x.id===path.split('/').at(-1));
  else if(path.includes('/revisions/')&&path.endsWith(':approve')){const parts=path.split('/'),kind=parts[4],id=parts[5].split(':')[0];const entity=p[kind].find(x=>x.id===id);if(kind==='assets'&&entity.approvalState!=='approved'&&!body.reviewed)return new Response(JSON.stringify({error:'Revisión requerida'}),{status:422});entity.approvalState='approved';if(kind==='developments')p.activeDevelopment=id;if(kind==='assets')p.assetSelections[entity.entityId+'|'+entity.kind]=id;if(kind==='timelines')p.activeTimeline=id;result=entity;}
  else if(path.endsWith('/assets:generate')){const kind=body.operation==='image'?'image':body.operation==='veo'?'veo_silent_validated':'pcm',a=asset('new'+(++n),body.entityId,kind,'candidate',n);p.assets.push(a);result=job(body.operation,{assetId:a.id});}
  else if(path.endsWith('/url'))result={url:still};
  else if(path.endsWith('/waveform'))result={samples:96000,binSamples:240,peaks:Array.from({length:400},(_,i)=>i>36&&i<52?.8:.04),attackCandidates:[9600]};
  else if(path.endsWith('/timeline:compile')){const t={id:'timeline'+(++n),compiledHash:'composition-'+(p.subtitleApproval?'approved':'draft'),data:{shots:data.shots.map((s,i)=>({...s,startFrame:i*3600})),cues:p.cues},approvalState:'candidate',created:n,revision:1};p.timelines.push(t);p.candidateTimeline=t.id;result=t;}
  else if(path.endsWith('/previews')&&method==='POST')result=render(false,body);
  else if(path.endsWith('/renders'))result=render(true,{timelineId:p.activeTimeline});
  else if(path.includes('/previews/'))result=p.previews.find(x=>x.id===path.split('/').at(-1));
  else if(path.includes('/exports/'))result={files:[{name:'Corto.mp4',url:still},{name:'Subtítulos.srt',url:still}]};
  else if(path.endsWith('/mix-policy')){p.mixPolicy={normalization:{enabled:body.normalize},ducking:{enabled:body.duckMusic}};result=p;}
  else if(path.endsWith('/subtitles')&&method==='GET')result={rows:[{utteranceId:'voice1',shotId:'shot1',japanese:'まだ間に合う。',audioRevision:'voice',audioHash:'hash-voice',samples:96000,segments:[{text:'Todavía estamos a tiempo.',startSample:0,endSample:96000}],warnings:[],stale:false}]};
  else if(path.endsWith('/subtitles:approve')){p.subtitleApproval=body;result=p;}
  else if(path.includes('/subtitles/'))result={record:body,warnings:[]};
  else if(path.includes('/shots/')&&path.endsWith('/frames'))result=job('frames',{framesId:'frames'});
  else if(path.includes('/frames/'))result={frames:Array.from({length:48},(_,i)=>({index:i,seconds:i/24,url:still}))};
  else if(path.includes('/cues/')&&path.endsWith('/anchor')){Object.assign(p.cues[0],{eventId:'new-event',revision:p.cues[0].revision+1});result=p.cues[0];}
  else if(path.includes('/cues/')&&method==='PATCH'){Object.assign(p.cues[0],body.patch,{revision:p.cues[0].revision+1});result={cue:p.cues[0],correctionId:'correction'};}
  else if(path.includes('/cues/')&&path.endsWith(':approve')){Object.assign(p.cues[0],{approvalState:'approved',manualLock:true});result=p.cues[0];}
  else if(path.endsWith('/batches'))result={nodes:[],batches:[],planHash:'none'};
  else throw new Error('Fixture route not implemented: '+method+' '+path);
  if(method!=='GET')p.revision++;if(key)keys.set(key,clone(result));
  return new Response(JSON.stringify(clone(result)),{status:200,headers:{'Content-Type':'application/json'}});
 }
 return {project:p,calls,jobs,transport,identity:{getIdToken:async()=> 'fixture-only-no-real-account'}};
}
