"""Runs only from an authorized persisted job. One immutable result per request."""
import copy
import json
import mimetypes
import tempfile
import time
import uuid
from pathlib import Path
from shorts.core.contracts import require, digest, validate_ideas, ContractError
from shorts.service.providers import Providers, UnknownSubmission
from shorts.service.director import RULES, ideas_prompt, develop_prompt, validate_development
from shorts.service.timeline import approved_assets
from shorts.core.dependencies import fingerprint, select_assets, dependency_records
from media import pcm, waveform, silent_video, inspect, checksum, extract_frames, probe
from render import render

def ident_new():return uuid.uuid4().hex

def run_job(cloud,j,p):
    pid=p['id'];op=j['operation'];data=j['payload'];provider=Providers(cloud.c,cloud.http)
    if data.get('developmentId'):p={**p,'activeDevelopment':data['developmentId']}
    def entity(kind,value):
        record={'id':ident_new(),'revision':1,'approvalState':'candidate','created':time.time(),'jobId':j['id'],**value}
        cloud.put_entity(pid,kind,record);return record
    def development():
        require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias');return cloud.entity(pid,'developments',p['activeDevelopment'])
    def asset(path,kind,entity_id,meta=None):
        aid=ident_new();obj=cloud.upload_file(pid,aid,path,Path(path).name,mimetypes.guess_type(path)[0] or 'application/octet-stream')
        a={'id':aid,'projectId':pid,'entityId':entity_id,'developmentId':p.get('activeDevelopment'),'kind':kind,'object':obj,'sha256':checksum(path),'mimeType':mimetypes.guess_type(path)[0] or 'application/octet-stream','revision':1,'created':time.time(),'approvalState':'candidate','jobId':j['id'],**(meta or {})}
        if not a.get('requestId') and p.get('activeDevelopment'):
            a['inputFingerprint']=fingerprint(development()['data'],entity_id,kind)
        cloud.put_entity(pid,'assets',a);return a
    def selected(eid,kind):
        available=approved_assets(cloud,pid)
        if 'approvedAssetIds' in data:available=[a for a in available if a['id'] in data['approvedAssetIds']]
        a=select_assets(available,development()['data'],p.get('activeDevelopment')).get((eid,kind))
        require(a,'ASSET_MISSING','Falta recurso aprobado: '+eid);return a
    def uri(a):return 'gs://'+cloud.c['bucket']+'/'+a['object']
    if op=='ideas':
        ideas=validate_ideas(provider.text(ideas_prompt(p)))
        review=provider.text(RULES+'\nRevisa diversidad real y fidelidad al género/concepto. Devuelve {distinct:boolean,faithful:boolean,issues:[]}; no reescribas.\n'+json.dumps({'project':p,'ideas':ideas},ensure_ascii=False))
        require(review.get('distinct') is True and review.get('faithful') is True,'IDEA_REVIEW','Las propuestas necesitan revisión; no se regeneraron automáticamente')
        result=[]
        for idea in ideas:result.append(entity('ideas',{'data':idea,'review':review,'batchId':j['id']}))
        return {'ideas':[i['id'] for i in result]}
    if op=='develop':
        idea=cloud.entity(pid,'ideas',data['ideaId'])
        require(p.get('selectedIdea',{}).get('id')==idea['id'] and p['selectedIdea']['hash']==digest(idea),'IDEA_CHANGED','La idea seleccionada cambió')
        d=validate_development(provider.text(develop_prompt(p,idea['data'])))
        review=provider.text(RULES+'\nRevisa guion: intención japonés/español, continuidad espacial y emoción específica al género. Devuelve {issues:[],coverage:[],nativeQualityGuaranteed:false}. No inventes revisión audiovisual.\n'+json.dumps(d,ensure_ascii=False))
        return {'developmentId':entity('developments',{'data':d,'review':review,'ideaId':idea['id']})['id']}
    if op=='revise':
        old=cloud.entity(pid,data['kind'],data['entityId'])
        revised=provider.text(RULES+'\nAplica SOLO la corrección. Devuelve {data: objeto editado, affectedIds:[], changeSummary:[]}. Conserva todo lo demás.\n'+json.dumps({'original':old['data'],'correction':data['instruction']},ensure_ascii=False))
        require('data' in revised and 'affectedIds' in revised,'REVISION_SCHEMA','Corrección incompleta')
        if data['kind']=='developments':validate_development(revised['data'])
        return {'candidateId':entity(data['kind'],{**revised,'previousId':old['id']})['id'],'affectedIds':revised['affectedIds']}
    with tempfile.TemporaryDirectory(prefix='shorts-') as temp:
        root=Path(temp)
        if op in ('image','veo','tts','music','transcribe','review'):
            dev=development();d=dev['data'];eid=data['entityId']
        if op=='image':
            shot=next((s for s in d['shots'] if s['id']==eid),None)
            refs=[]
            if shot:
                for rid in shot['referenceEntityIds']:
                    a=selected(rid,'image');refs.append({**a,'uri':uri(a)})
                prompt=RULES+'\nProduce un frame narrativo anime 2D, sin texto ni subtítulos. Estados, participantes y distribución: '+json.dumps(shot,ensure_ascii=False)
            else:
                e=next((e for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==eid),None)
                require(e,'ENTITY','Referencia inexistente');prompt=RULES+'\nReferencia maestra limpia: '+json.dumps(e,ensure_ascii=False)
            raw,mime=provider.image(prompt,refs,p['format']);path=root/('image.png' if mime=='image/png' else 'image.jpg');path.write_bytes(raw);inspect(path,'video')
            return {'assetId':asset(path,'image',eid,{'references':[a['id'] for a in refs],'dependencies':dependency_records(refs),'model':cloud.c['models']['image'],'prompt':prompt})['id']}
        if op=='veo':
            shot=next(s for s in d['shots'] if s['id']==eid);image=selected(eid,'image')
            raw_id=ident_new();output=j.get('providerOutput') or f'gs://{cloud.c["bucket"]}/{cloud.c["prefix"]}/projects/{pid}/assets/{raw_id}/'
            operation={'name':j['providerOperation']} if j.get('providerOperation') else provider.veo({'prompt':shot['prompt'],'imageApproved':True,'imageMime':image['mimeType'],'durationSeconds':data.get('seconds',8),'format':p['format']},uri(image),output)
            require(operation.get('name'),'VEO_OPERATION','No se recibió operationId')
            ref=cloud.db.collection('animeShortsJobs').document(j['id']);ref.update({'providerOperation':operation['name'],'providerOutput':output,'state':'waiting_provider'})
            deadline=time.time()+1800
            while time.time()<deadline:
                state=ref.get().to_dict()['state']
                result=provider.poll_veo(operation['name'])
                if result.get('done'):break
                time.sleep(10)
            else:raise ContractError('VEO_PENDING','Operación conocida pendiente; conserva ID para recuperación',503)
            require(not result.get('error'),'VEO_FAILED','Veo informó error')
            videos=result.get('response',{}).get('videos',[]);require(videos,'VEO_EMPTY','Sin video utilizable')
            source=videos[0]['gcsUri'];require(source.startswith(output),'VEO_OUTPUT','Salida fuera del destino autorizado')
            name=source.removeprefix('gs://'+cloud.c['bucket']+'/');original=root/'original.mp4';cloud.download(pid,name,original)
            silent=root/'silent.mp4';meta=silent_video(original,silent)
            return {'assetId':asset(silent,'veo_silent_validated',eid,{**meta,'dependencies':dependency_records([image]),'originalObject':name,'referenceImage':image['id'],'model':cloud.c['models']['veo'],'generateAudio':False})['id']}
        if op in ('tts','music'):
            if op=='tts':
                u=next(u for u in d['utterances'] if u['id']==eid);character=next(c for c in d['bible']['characters'] if c['id']==u['speakerId'])
                raw=provider.tts(u,character['voice']);source=root/'original.wav'
            else:
                r=next(r for r in d['musicRequests'] if r['id']==eid);raw=provider.music(r['prompt'],r['seconds']);source=root/'original.mp3'
            source.write_bytes(raw);target=root/'audio.wav';meta=pcm(source,target);meta['waveform']=waveform(target)
            meta['model']=cloud.c['models'][op];meta['contentReview']='needs_review';meta['originalObject']=cloud.upload_file(pid,ident_new(),source,source.name,mimetypes.guess_type(source)[0])
            return {'assetId':asset(target,'pcm',eid,meta)['id']}
        if op=='media':
            u=cloud.entity(pid,'uploads',data['uploadId']);source=root/'upload';cloud.download(pid,u['object'],source)
            target=root/'audio.wav';meta=pcm(source,target);meta['waveform']=waveform(target);meta.update(requestId=data['requestId'],originalObject=u['object'])
            a=asset(target,'pcm',data['requestId'],meta)
            dev=development();req=next(x for x in dev['data']['soundRequests'] if x['id']==data['requestId'])
            attacks=meta['waveform']['attackCandidates'];ambience=req.get('type')=='ambience'
            anchor={'anchorShotId':req['shotId'],'anchorFrameOffset':0} if ambience else {'eventId':'event_'+ident_new()}
            cue=entity('cues',{'audioRevision':a['id'],'requestId':req['id'],'track':'ambience' if ambience else 'sfx','shotId':req['shotId'],'sourceSyncSample':0 if ambience else (attacks[0] if attacks else 0),'trimInSample':0,'trimOutSample':meta['samples'],'offsetSamples':0,'gainDb':0,**anchor,'correctionSource':'detector','manualLock':False,'eventDescription':req['eventDescription'],'analysisAttempts':0})
            cloud.entity_ref(pid,'uploads',u['id']).update({'state':'decoded','assetId':a['id'],'cueId':cue['id']})
            auto_job=None
            try:
                current=cloud.project(pid,p['owner'])
                if not ambience:auto_job=cloud.submit(current,'analyze',{'cueId':cue['id'],'reason':'Sincronización tras carga','developmentId':p['activeDevelopment'],'approvedAssetIds':data.get('approvedAssetIds',[])},j['id']+'-analysis',current['revision'],j['budgetId'],j['session'])['id']
            except ContractError:pass
            return {'analysisJobId':auto_job,'assetId':a['id'],'cueId':cue['id'],'requiresVisualAnchor':True,'requestedSeconds':req['seconds'],'receivedSeconds':meta['samples']/48000}
        if op=='analyze':
            from google.cloud import firestore
            @firestore.transactional
            def start_attempt(tx):
                ref=cloud.entity_ref(pid,'cues',data['cueId']);cue=ref.get(transaction=tx).to_dict()
                require(cue.get('analysisAttempts',0)<2,'ANALYSIS_LIMIT','Dos intentos agotados. El ajuste manual sigue disponible.')
                tx.update(ref,{'analysisAttempts':cue.get('analysisAttempts',0)+1})
                return cue
            cue=start_attempt(cloud.db.transaction());a=selected(cue['shotId'],'veo_silent_validated');path=root/'silent.mp4';cloud.download(pid,a['object'],path)
            result=provider.text(RULES+'\nExamina el video real. Evento: '+cue['eventDescription']+'. Devuelve {visible:boolean,approxSeconds:number|null,occurrences:[],evidence:string,confidence:number}. No inventes contacto si no está visible.',[{'fileData':{'fileUri':uri(a),'mimeType':'video/mp4'}}],True)
            require(result.get('visible') is True and isinstance(result.get('approxSeconds'),(int,float)),'EVENT_UNCERTAIN','No se identificó el contacto; usa ajuste manual')
            start=max(0,int(result['approxSeconds']*24)-12);frames=extract_frames(path,root/'frames',start,24)
            import base64
            parts=[{'text':f'Frame {f["index"]}' } for f in []]
            for f in frames:
                parts.extend([{'text':f'Frame {f["index"]}'},{'inlineData':{'mimeType':'image/jpeg','data':base64.b64encode((root/'frames'/f['file']).read_bytes()).decode()}}])
            fine=provider.text(RULES+'\nElige fotograma de contacto, solo con evidencia. Devuelve {visible:boolean,frameIndex:number|null,evidence:string}. Evento: '+cue['eventDescription'],parts,True)
            require(fine.get('visible') and any(f['index']==fine.get('frameIndex') for f in frames),'EVENT_UNCERTAIN','Contacto no concluyente; usa ajuste manual')
            proposal=entity('events',{'shotId':cue['shotId'],'videoRevision':a['id'],'pts':fine['frameIndex'],'timebase':24,'visible':True,'evidence':fine['evidence'],'source':'analysis','occurrence':result.get('occurrences',[]),'confidence':result.get('confidence')})
            # An automatic pass proposes; it never overwrites a manually locked cue.
            from google.cloud import firestore
            @firestore.transactional
            def propose(tx):
                ref=cloud.entity_ref(pid,'cues',cue['id']);current=ref.get(transaction=tx).to_dict()
                update={'proposedEventId':proposal['id']}
                if not current.get('manualLock') and current['revision']==cue['revision']:
                    update.update(eventId=proposal['id'],revision=current['revision']+1,approvalState='candidate')
                tx.update(ref,update)
            propose(cloud.db.transaction())
            return {'proposalEventId':proposal['id'],'manualLock':cue.get('manualLock',False)}
        if op=='frames':
            a=selected(data['shotId'],'veo_silent_validated');source=root/'video.mp4';cloud.download(pid,a['object'],source)
            frames=extract_frames(source,root/'frames',data['start'],data['count']);aid=ident_new()
            for f in frames:f['object']=cloud.upload_file(pid,aid,root/'frames'/f['file'],f['file'],'image/jpeg')
            record=entity('references',{'assetRevision':a['id'],'frames':frames,'kind':'indexed_frames','shotId':data['shotId']})
            return {'framesId':record['id']}
        if op in ('preview','render'):
            timeline=cloud.entity(pid,'timelines',data['timelineId']);m=copy.deepcopy(timeline['data'])
            require(op!='render' or timeline['approvalState']=='approved','TIMELINE','Montaje sin aprobar')
            for aid,a in m['assets'].items():
                path=root/f'{aid}.media';cloud.download(pid,a['object'],path);a['local']=path.name
            result=render(m,root,data['startFrame'],data['endFrame'],op=='render')
            rid=ident_new();files={}
            names=[result['file'],'clean.mp4','subtitles.srt','subtitles.ass','compiled.json','result.json','mix-report.json']
            if op=='render':names+=['dialogue.wav','thought.wav','narration.wav','system.wav','music.wav','ambience.wav','sfx.wav','mix.wav']
            for name in names:files[name]=cloud.upload_file(pid,rid,root/name,name,mimetypes.guess_type(name)[0] or 'application/json')
            record={'id':rid,'revision':1,'state':'ready','final':op=='render','timelineId':timeline['id'],'object':files[result['file']],'files':files,'draftIssues':timeline['data'].get('draftIssues',[]),'cueHashes':{c['id']:digest(c) for c in timeline['data']['cues']},**result}
            cloud.put_entity(pid,'previews',record);return {'previewId':rid,'final':op=='render'}
        if op=='review':
            a=cloud.entity(pid,'assets',data['assetId'])
            result=provider.text(RULES+'\nRevisa solo el material observado contra estas biblias. Devuelve {issues:[],coverage:[],uncertainty:string}. No certifiques perfección.\n'+json.dumps(d['bible'],ensure_ascii=False),[{'fileData':{'fileUri':uri(a),'mimeType':a['mimeType']}}],True)
            return {'review':result,'assetId':a['id']}
        if op=='transcribe':
            a=selected(eid,'pcm')
            result=provider.post('https://speech.googleapis.com/v1/speech:longrunningrecognize',{'config':{'encoding':'LINEAR16','sampleRateHertz':48000,'languageCode':'ja-JP','enableWordTimeOffsets':True,'audioChannelCount':2},'audio':{'uri':uri(a)}})
            return {'operationName':result['name'],'assetId':a['id'],'state':'awaiting_alignment_review'}
        raise ContractError('OPERATION','Operación no implementada')
