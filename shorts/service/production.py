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
from shorts.service.cloud import RequestJournal
from shorts.service.director import RULES, ideas_prompt, develop_prompt, validate_development
from shorts.service.timeline import approved_assets
from shorts.core.dependencies import fingerprint, select_assets, dependency_records
from media import pcm, waveform, silent_video, inspect, checksum, extract_frames, probe
from render import render, visual_clip

def ident_new():return uuid.uuid4().hex

def run_job(cloud,j,p):
    pid=p['id'];op=j['operation'];data=j['payload'];provider=Providers(cloud.c,cloud.http,RequestJournal(cloud,j['id']))
    if data.get('developmentId'):p={**p,'activeDevelopment':data['developmentId']}
    if 'assetSelections' in data:p={**p,'assetSelections':data['assetSelections']}
    if 'approvedAssetIds' in data:p={**p,'approvedAssetIds':data['approvedAssetIds']}
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
        a=select_assets(available,development()['data'],p.get('activeDevelopment'),p.get('assetSelections')).get((eid,kind))
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
        from shorts.core.revisions import scoped_value,replace_scope,idea_scope,impact,changes
        old=cloud.entity(pid,data['kind'],data['entityId'])
        original=old['data'];scope=data.get('scope')
        target=scoped_value(original,scope) if data['kind']=='developments' else idea_scope(original,scope)
        revised=provider.text(RULES+'\nCorrige únicamente el objeto target. Devuelve {replacement:objeto editado,changeSummary:[]}. Conserva su id. El contexto solo sirve para continuidad, no lo reescribas.\n'+json.dumps({'target':target,'context':original.get('bible',original) if scope and scope.get('group')!='whole' else None,'correction':data['instruction']},ensure_ascii=False))
        require(isinstance(revised.get('replacement'),dict),'REVISION_SCHEMA','Corrección incompleta')
        if data['kind']=='developments':
            candidate=validate_development(replace_scope(original,scope,revised['replacement']))
            available=[x.to_dict() for x in cloud.project_ref(pid).collection('assets').stream()]
            report=impact(original,candidate,available,old['id'],p.get('assetSelections'))
        else:
            candidate=idea_scope(original,scope,revised['replacement'])
            # Validate an individual candidate without inventing a new idea batch.
            require(set(original)<=set(candidate) and all(candidate.get(k) for k in original),'IDEA_SCHEMA','Idea corregida incompleta')
            report={'changes':changes(original,candidate),'assetsNeedingReview':[],'paidCalls':1}
        return {'candidateId':entity(data['kind'],{'data':candidate,'impact':report,'scope':scope,'previousId':old['id'],'batchId':old.get('batchId'),'ideaId':old.get('ideaId')})['id']}
    with tempfile.TemporaryDirectory(prefix='shorts-') as temp:
        root=Path(temp)
        if op=='import':
            from shorts.core.imports import import_candidate
            from shorts.core.revisions import impact
            source_project=cloud.project(data['sourceProjectId'],p['owner'])
            source=cloud.entity(source_project['id'],'assets',data['sourceAssetId'])
            require(digest(source)==data['sourceHash'],'IMPORT_CHANGED','Cambió la versión de origen; vuelve a revisarla')
            source_dev=cloud.entity(source_project['id'],'developments',source['developmentId'])
            old=development();candidate,metadata=import_candidate(source,source_dev['data'],old['data'],data['targetId'])
            validate_development(candidate)
            if candidate!=old['data']:
                available=[x.to_dict() for x in cloud.project_ref(pid).collection('assets').stream()]
                dev=entity('developments',{'data':candidate,'previousId':old['id'],'ideaId':old.get('ideaId'),'source':'import','impact':impact(old['data'],candidate,available,old['id'],p.get('assetSelections')),'provenance':metadata['provenance']})
                p={**p,'activeDevelopment':dev['id']}
            source_path=root/('import.png' if source['mimeType']=='image/png' else 'import.jpg' if source['kind']=='image' else 'import.wav')
            cloud.download(source_project['id'],source['object'],source_path)
            require(checksum(source_path)==source['sha256'],'IMPORT_CHECKSUM','El original no coincide con su registro')
            metadata.update({k:source[k] for k in ('samples','sampleRate','channels','waveform','model') if k in source})
            a=asset(source_path,source['kind'],data['targetId'],metadata)
            return {'assetId':a['id'],'developmentId':p['activeDevelopment'],'imported':True}
        if op in ('image','veo','tts','music','transcribe','review'):
            dev=development();d=dev['data'];eid=data['entityId']
        if op=='image':
            shot=next((s for s in d['shots'] if s['id']==eid),None)
            refs=[]
            if shot and data.get('variantPrompt'):
                base=selected(eid,'image');refs=[{**base,'uri':uri(base)}]
                require(isinstance(data['variantPrompt'],str) and 0<len(data['variantPrompt'])<=3000,'VARIANT_PROMPT','Describe el movimiento localizado')
                prompt=RULES+'\nMantén encuadre, identidad y fondo del frame de referencia. Cambia únicamente esta región/acción: '+data['variantPrompt']
            elif shot:
                for rid in shot['referenceEntityIds']:
                    a=selected(rid,'image');refs.append({**a,'uri':uri(a)})
                prompt=RULES+'\nProduce un frame narrativo anime 2D, sin texto ni subtítulos. Estados, participantes y distribución: '+json.dumps(shot,ensure_ascii=False)
            else:
                e=next((e for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==eid),None)
                require(e,'ENTITY','Referencia inexistente');prompt=RULES+'\nReferencia maestra limpia: '+json.dumps(e,ensure_ascii=False)
            raw,mime=provider.image(prompt,refs,p['format']);path=root/('image.png' if mime=='image/png' else 'image.jpg');path.write_bytes(raw);inspect(path,'video')
            return {'assetId':asset(path,'image',('layer_'+ident_new()) if data.get('variantPrompt') else eid,{'variantOf':eid if data.get('variantPrompt') else None,'parentAssetId':refs[0]['id'] if data.get('variantPrompt') else None,'references':[a['id'] for a in refs],'dependencies':dependency_records(refs),'model':cloud.c['models']['image'],'prompt':prompt})['id']}
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
            require(checksum(source)==u['sha256'],'UPLOAD_CHECKSUM','El archivo recibido no coincide con el seleccionado; no se crean cues')
            target=root/'audio.wav';meta=pcm(source,target);meta['waveform']=waveform(target);meta.update(requestId=data['requestId'],originalObject=u['object'])
            a=asset(target,'pcm',data['requestId'],meta)
            dev=development();req=next(x for x in dev['data']['soundRequests'] if x['id']==data['requestId'])
            attacks=meta['waveform']['attackCandidates'];ambience=req.get('type')=='ambience'
            anchor={'anchorShotId':req['shotId'],'anchorFrameOffset':0} if ambience else {'eventId':'event_'+ident_new()}
            cue=entity('cues',{'audioRevision':a['id'],'requestId':req['id'],'track':'ambience' if ambience else 'sfx','shotId':req['shotId'],'sourceSyncSample':0 if ambience else (attacks[0] if attacks else 0),'trimInSample':0,'trimOutSample':meta['samples'],'offsetSamples':0,'gainDb':0,**anchor,'correctionSource':'detector','manualLock':False,'eventDescription':req['eventDescription'],'requestFingerprint':digest(req),'analysisAttempts':0})
            cloud.entity_ref(pid,'uploads',u['id']).update({'state':'decoded','assetId':a['id'],'cueId':cue['id']})
            auto_job=None
            try:
                current=cloud.project(pid,p['owner'])
                if not ambience:auto_job=cloud.submit(current,'analyze',{'cueId':cue['id'],'reason':'Sincronización tras carga','developmentId':p['activeDevelopment'],'approvedAssetIds':data.get('approvedAssetIds',[])},j['id']+'-analysis',current['revision'],j['session'])['id']
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
            cue=start_attempt(cloud.db.transaction())
            from shorts.service.timeline import assemble_plan
            from shorts.core.contracts import visual_fingerprint
            manifest=assemble_plan(cloud,p);shot=next(s for s in manifest['shots'] if s['id']==cue['shotId'])
            require(shot['treatment']!='black' and not shot.get('draftPlaceholder'),'EVENT_MATERIAL','Falta composición visual aprobada; el ajuste manual sigue disponible')
            a=manifest['assets'][shot['assetRevision']];files={}
            for aid in {shot['assetRevision'],*(x['assetRevision'] for x in shot.get('layers',[]))}:
                local=root/(aid+'.media');cloud.download(pid,manifest['assets'][aid]['object'],local);files[aid]=local
            path=root/'silent.mp4';visual_clip(shot,files,path,480,270 if p['format']=='16:9' else 854,0,shot['frames'])
            composed=cloud.upload_file(pid,ident_new(),path,path.name,'video/mp4');composed_uri='gs://'+cloud.c['bucket']+'/'+composed
            visual_hash=visual_fingerprint(shot)
            from shorts.core.events import contact_options,choose_contact
            scan=cue.get('analysisScan') if data.get('occurrenceIndex') is not None else None
            if scan:
                require(scan['videoRevision']==a['id'] and scan.get('visualFingerprint')==visual_hash and scan['eventDescription']==cue['eventDescription'],'EVENT_SCAN_STALE','Cambió el video o el evento; revisa con fotogramas manuales')
                options=scan['options'];result={'confidence':scan.get('confidence')}
            else:
                result=provider.text(RULES+'\nExamina el video real. Evento: '+cue['eventDescription']+'. Corrección solicitada: '+data.get('reason','Localizar contacto')+'. Devuelve {visible:boolean,approxSeconds:number|null,occurrences:[{seconds:number,description:string}],evidence:string,confidence:number}. Incluye CADA contacto visible separado y no inventes contacto.',[{'fileData':{'fileUri':composed_uri,'mimeType':'video/mp4'}}],True)
                options=contact_options(result,float(probe(path)['format']['duration']))
                scan={'videoRevision':a['id'],'visualFingerprint':visual_hash,'eventDescription':cue['eventDescription'],'options':options,'confidence':result.get('confidence')}
                cloud.entity_ref(pid,'cues',cue['id']).update({'analysisScan':scan})
            choice=choose_contact(options,data.get('occurrenceIndex'))
            if choice is None:return {'cueId':cue['id'],'state':'awaiting_occurrence_selection','error':'Hay varios contactos. Elige el que corresponde al sonido antes de afinarlo.'}
            start=max(0,int(choice['seconds']*24)-12);frames=extract_frames(path,root/'frames',start,24)
            import base64
            parts=[{'text':f'Frame {f["index"]}' } for f in []]
            for f in frames:
                parts.extend([{'text':f'Frame {f["index"]}'},{'inlineData':{'mimeType':'image/jpeg','data':base64.b64encode((root/'frames'/f['file']).read_bytes()).decode()}}])
            fine=provider.text(RULES+'\nElige fotograma de contacto, solo con evidencia. Devuelve {visible:boolean,frameIndex:number|null,evidence:string}. Evento: '+cue['eventDescription'],parts,True)
            require(fine.get('visible') and any(f['index']==fine.get('frameIndex') for f in frames),'EVENT_UNCERTAIN','Contacto no concluyente; usa ajuste manual')
            proposal=entity('events',{'shotId':cue['shotId'],'videoRevision':a['id'],'pts':fine['frameIndex'],'timebase':24,'visible':True,'evidence':fine['evidence'],'source':'analysis','visualFingerprint':visual_hash,'coordinateSpace':'shot_output','occurrence':choice,'occurrenceIndex':data.get('occurrenceIndex',0),'confidence':result.get('confidence')})
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
            from shorts.service.timeline import assemble_plan
            from shorts.core.contracts import visual_fingerprint
            manifest=assemble_plan(cloud,p)
            shot=next(s for s in manifest['shots'] if s['id']==data['shotId'])
            require(shot['treatment']!='black','FRAME_MATERIAL','Aprueba material real de esta toma antes de marcar el evento')
            a=manifest['assets'][shot['assetRevision']];files={}
            for aid in {shot['assetRevision'],*(x['assetRevision'] for x in shot.get('layers',[]))}:
                path=root/(aid+'.media');cloud.download(pid,manifest['assets'][aid]['object'],path);files[aid]=path
            source=root/'visual.mp4'
            visual_clip(shot,files,source,480,270 if p['format']=='16:9' else 854,0,shot['frames'])
            frames=extract_frames(source,root/'frames',data['start'],data['count']);aid=ident_new()
            for f in frames:f['object']=cloud.upload_file(pid,aid,root/'frames'/f['file'],f['file'],'image/jpeg')
            record=entity('references',{'assetRevision':a['id'],'visualFingerprint':visual_fingerprint(shot),'coordinateSpace':'shot_output','frames':frames,'kind':'indexed_frames','shotId':data['shotId']})
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
            record={'id':rid,'revision':1,'state':'ready','jobId':j['id'],'cacheKey':digest([result['manifestHash'],data['startFrame'],data['endFrame'],op=='render',result['compilerVersion']]),'final':op=='render','timelineId':timeline['id'],'object':files[result['file']],'files':files,'draftIssues':timeline['data'].get('draftIssues',[]),'cueHashes':{c['id']:digest(c) for c in timeline['data']['cues']},**result}
            cloud.put_entity(pid,'previews',record);return {'previewId':rid,'final':op=='render'}
        if op=='review':
            a=cloud.entity(pid,'assets',data['assetId'])
            result=provider.text(RULES+'\nRevisa solo el material observado contra estas biblias. Devuelve {issues:[],coverage:[],uncertainty:string}. No certifiques perfección.\n'+json.dumps(d['bible'],ensure_ascii=False),[{'fileData':{'fileUri':uri(a),'mimeType':a['mimeType']}}],True)
            return {'review':result,'assetId':a['id']}
        if op=='transcribe':
            import re
            from decimal import Decimal
            from media import ff
            a=selected(eid,'pcm');ref=cloud.db.collection('animeShortsJobs').document(j['id'])
            name=j.get('providerOperation')
            if not name:
                source=root/'voice.wav';cloud.download(pid,a['object'],source)
                target=root/'recognition.wav'
                ff(['-i',source,'-map','0:a:0','-ar',48000,'-ac',1,'-c:a','pcm_s16le',target])
                obj=cloud.upload_file(pid,ident_new(),target,target.name,'audio/wav')
                result=provider.post('https://speech.googleapis.com/v1/speech:longrunningrecognize',{'config':{'encoding':'LINEAR16','sampleRateHertz':48000,'languageCode':'ja-JP','enableWordTimeOffsets':True,'audioChannelCount':1},'audio':{'uri':'gs://'+cloud.c['bucket']+'/'+obj}},'transcribe')
                name=result.get('name');require(name,'SPEECH_OPERATION','Speech no devolvió una operación')
                ref.update({'providerOperation':name,'state':'waiting_provider','speechAudioRevision':a['id']})
            deadline=time.time()+900
            while time.time()<deadline:
                result=provider.poll_speech(name)
                if result.get('done'):break
                time.sleep(5)
            else:raise ContractError('SPEECH_PENDING','La transcripción sigue en Google; conserva su ID',503)
            require(not result.get('error'),'SPEECH_FAILED','Google informó un fallo de transcripción')
            words=[];transcripts=[]
            for row in result.get('response',{}).get('results',[]):
                alt=(row.get('alternatives') or [{}])[0];transcripts.append(alt.get('transcript',''))
                for w in alt.get('words',[]):
                    times=[w.get(k,'0s') for k in ('startTime','endTime')]
                    require(all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)?s',t) for t in times),'SPEECH_TIME','Tiempo de reconocimiento inválido')
                    start,end=[round(Decimal(t[:-1])*48000) for t in times]
                    require(0<=start<=end<=a['samples'],'SPEECH_TIME','Palabra fuera del audio recibido')
                    words.append({'text':w['word'],'startSample':start,'endSample':end})
            require(words,'SPEECH_EMPTY','No se reconocieron palabras; el editor manual sigue disponible')
            record=entity('references',{'kind':'speech_alignment','audioRevision':a['id'],'audioHash':a['sha256'],'utteranceId':eid,'words':words,'transcript':' '.join(transcripts),'source':'google-speech-v1','precisionNotice':'Marcas aproximadas de reconocimiento, revisa la voz real'})
            return {'alignmentId':record['id'],'assetId':a['id'],'state':'awaiting_alignment_review'}
        raise ContractError('OPERATION','Operación no implementada')
