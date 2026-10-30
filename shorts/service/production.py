"""Runs only from an authorized persisted job. One immutable result per request."""
import copy
import json
import mimetypes
import tempfile
import time
import uuid
from pathlib import Path
from shorts.core.contracts import require, digest, validate_ideas, ContractError, sound_group_uses
from shorts.core.requests import IDEAS_OUTPUT_LIMIT
from shorts.service.providers import Providers, UnknownSubmission
from shorts.service.cloud import RequestJournal

# La imagen de ejecución es python:slim y NO trae base de datos de tipos del
# sistema, así que mimetypes sólo conoce la tabla interna de Python — y esa no
# tiene .webp. Un archivo guardado como application/octet-stream no se ve en el
# navegador: se descarga. Los formatos que produce esta aplicación se declaran
# aquí para que la respuesta no dependa de lo que traiga el sistema operativo.
MEDIA_TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
             '.gif':'image/gif','.mp4':'video/mp4','.wav':'audio/x-wav','.mp3':'audio/mpeg',
             '.json':'application/json','.txt':'text/plain','.srt':'text/plain','.zip':'application/zip'}

def media_type(path,default='application/octet-stream'):
    return MEDIA_TYPES.get(Path(str(path)).suffix.lower()) or mimetypes.guess_type(str(path))[0] or default
from shorts.service.director import rules_for, project_style, ideas_prompt, validate_development
from shorts.service.timeline import approved_assets
from shorts.core.dependencies import fingerprint, select_assets, dependency_records
from media import pcm, waveform, silent_video, inspect, checksum, extract_frames, probe
from render import render, visual_clip

def ident_new():return uuid.uuid4().hex

def run_job(cloud,j,p):
    pid=p['id'];op=j['operation'];data=j['payload']
    provider_config={**cloud.c,'models':copy.deepcopy(j.get('models',cloud.c['models']))}
    provider=Providers(provider_config,cloud.http,RequestJournal(cloud,j['id']))
    if data.get('developmentId'):p={**p,'activeDevelopment':data['developmentId']}
    if 'assetSelections' in data:p={**p,'assetSelections':data['assetSelections']}
    if 'approvedAssetIds' in data:p={**p,'approvedAssetIds':data['approvedAssetIds']}
    # Estilo visual elegido en Generadores para este corto. Sin elección
    # guardada, anime cinematográfico. Se aplica a guion nuevo, imagen y
    # video nuevos; las fichas ya aprobadas no cambian solas.
    style=project_style(p);rules=rules_for(style)
    def entity(kind,value):
        record={'id':ident_new(),'revision':1,'approvalState':'candidate','created':time.time(),'jobId':j['id'],**value}
        cloud.put_entity(pid,kind,record);return record
    def development():
        require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias');return cloud.entity(pid,'developments',p['activeDevelopment'])
    def asset(path,kind,entity_id,meta=None):
        aid=ident_new();obj=cloud.upload_file(pid,aid,path,Path(path).name,media_type(path))
        a={'id':aid,'projectId':pid,'entityId':entity_id,'developmentId':p.get('activeDevelopment'),'kind':kind,'object':obj,'sha256':checksum(path),'mimeType':media_type(path),'revision':1,'created':time.time(),'approvalState':'candidate','jobId':j['id'],**(meta or {})}
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
        ideas=validate_ideas(provider.text(ideas_prompt(p),max_output_tokens=IDEAS_OUTPUT_LIMIT))
        result=[]
        for idea in ideas:result.append(entity('ideas',{'data':idea,'batchId':j['id']}))
        return {'ideas':[i['id'] for i in result]}
    if op=='develop':
        idea=cloud.entity(pid,'ideas',data['ideaId'])
        require(p.get('selectedIdea',{}).get('id')==idea['id'] and p['selectedIdea']['hash']==digest(idea),'IDEA_CHANGED','La idea seleccionada cambió')
        from shorts.service.development import develop,apply_voice_assignments
        result=develop(cloud,provider,j,p,idea)
        if data.get('stage',1)!=4:return result
        return {'developmentId':entity('developments',{'data':apply_voice_assignments(result['data'],p),'review':result['review'],'ideaId':idea['id'],'sourceDraftId':data['sourceDraftId']})['id']}
    if op=='revise':
        from shorts.core.revisions import scoped_value,replace_scope,idea_scope,impact,changes
        old=cloud.entity(pid,data['kind'],data['entityId'])
        original=old['data'];scope=data.get('scope')
        target=scoped_value(original,scope) if data['kind']=='developments' else idea_scope(original,scope)
        revised=provider.text(rules+'\nCorrige únicamente el objeto target. Devuelve {replacement:objeto editado,changeSummary:[]}. Conserva su id. El contexto solo sirve para continuidad, no lo reescribas.\n'+json.dumps({'target':target,'context':original.get('bible',original) if scope and scope.get('group')!='whole' else None,'correction':data['instruction']},ensure_ascii=False))
        require(isinstance(revised.get('replacement'),dict),'REVISION_SCHEMA','Corrección incompleta')
        if data['kind']=='developments':
            # A corrected sound plan goes through the same normalisation as a
            # new one, so a story planned under the old rules — one 315-second
            # «effect» for the whole film — is repaired by asking for a
            # correction, and the impact report says what changed.
            from shorts.service.development import plan_sound
            candidate=validate_development(plan_sound(replace_scope(original,scope,revised['replacement'])))
            available=[x.to_dict() for x in cloud.project_ref(pid).collection('assets').stream()]
            report=impact(original,candidate,available,old['id'],p.get('assetSelections'))
        else:
            candidate=idea_scope(original,scope,revised['replacement'])
            # Validate an individual candidate without inventing a new idea batch.
            require(set(original)<=set(candidate) and all(candidate.get(k) for k in original),'IDEA_SCHEMA','Idea corregida incompleta')
            report={'changes':changes(original,candidate),'assetsNeedingReview':[],'paidCalls':1}
        return {'candidateId':entity(data['kind'],{'data':candidate,'impact':report,'scope':scope,'previousId':old['id'],'batchId':old.get('batchId'),'ideaId':old.get('ideaId'),'editorialStage':old.get('editorialStage',4)})['id']}
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
                dev=entity('developments',{'data':candidate,'previousId':old['id'],'ideaId':old.get('ideaId'),'source':'import','editorialStage':old.get('editorialStage',4),'impact':impact(old['data'],candidate,available,old['id'],p.get('assetSelections')),'provenance':metadata['provenance']})
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
            from shorts.service.image_direction import image_prompt
            shot=next((s for s in d['shots'] if s['id']==eid),None)
            if shot and data.get('shotImageInstruction'):
                # Imagen principal con instrucción del usuario: NO es una
                # variante. Se edita la imagen aprobada de la toma (si la
                # hay) con la instrucción, pero el archivo resultante es
                # una imagen propia de la toma, así que al aprobarla queda
                # en uso para la toma y para el video, sin pasos extra.
                # Las dependencias son las referencias de la toma, no la
                # imagen base, porque una dependencia sobre la propia toma
                # impediría que la imagen nueva quedara seleccionada.
                instruction=data['shotImageInstruction']
                require(isinstance(instruction,str) and 0<len(instruction)<=3000,'IMAGE_INSTRUCTION','Escribe la instrucción para la imagen')
                reference_assets=[]
                for rid in shot['referenceEntityIds']:
                    try:reference_assets.append(selected(rid,'image'))
                    except Exception:pass
                asset_deps=dependency_records(reference_assets)
                try:base=selected(eid,'image')
                except Exception:base=None
                if base:
                    asset_parent=base['id']
                    refs=[{**base,'uri':uri(base),'referenceLabel':'imagen aprobada de la toma '+eid+' que se debe editar'}]
                    for a in reference_assets:
                        group,e=next((k,e) for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==a['entityId'])
                        refs.append({**a,'uri':uri(a),'referenceLabel':{'characters':'Personaje','locations':'Lugar','props':'Objeto'}[group]+': '+e['name']})
                    prompt=image_prompt(shot,variant=instruction,style=style)
                else:
                    refs=[]
                    for a in reference_assets:
                        group,e=next((k,e) for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==a['entityId'])
                        refs.append({**a,'uri':uri(a),'referenceLabel':{'characters':'Personaje','locations':'Lugar','props':'Objeto'}[group]+': '+e['name']})
                    prompt=image_prompt(shot,shot=True,style=style)+'\nInstrucción del usuario: '+instruction
            elif shot and data.get('variantPrompt'):
                base=selected(eid,'image');refs=[{**base,'uri':uri(base),'referenceLabel':'imagen aprobada de la toma '+eid+' que se debe editar'}]
                require(isinstance(data['variantPrompt'],str) and 0<len(data['variantPrompt'])<=3000,'VARIANT_PROMPT','Describe el movimiento localizado')
                prompt=image_prompt(shot,variant=data['variantPrompt'],style=style)
            elif shot:
                for rid in shot['referenceEntityIds']:
                    a=selected(rid,'image')
                    group,e=next((k,e) for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==rid)
                    label={'characters':'Personaje','locations':'Lugar','props':'Objeto'}[group]+': '+e['name']+' ('+rid+')'
                    if group=='characters' and e.get('costumes'):
                        label+=' - vestuario: '+'; '.join(c.get('description','') for c in e['costumes'] if c.get('description'))
                    refs.append({**a,'uri':uri(a),'referenceLabel':label})
                prompt=image_prompt(shot,shot=True,style=style)
                if data.get('usePreviousShot'):
                    # Botón 2026-10-29: la imagen de la toma anterior sirve
                    # SOLO como referencia de continuidad, no para copiarla.
                    _shots=d['shots'];_idx=next((i for i,s in enumerate(_shots) if s['id']==eid),None)
                    require(_idx is not None and _idx>0,'PREVIOUS_SHOT','Esta es la primera toma, no hay toma anterior que usar como referencia.')
                    _prev=_shots[_idx-1]
                    try:_prev_asset=selected(_prev['id'],'image')
                    except Exception:_prev_asset=None
                    require(_prev_asset,'PREVIOUS_SHOT','La toma anterior todavía no tiene una imagen aprobada que usar como referencia. Genera primero la imagen de la toma anterior.')
                    refs.append({**_prev_asset,'uri':uri(_prev_asset),'referenceLabel':'Toma anterior: referencia de continuidad, no copiar'})
                    prompt+='\nContinuidad con la toma anterior: usa la imagen de la toma anterior SOLO como referencia de continuidad (mismo personaje, mismo vestuario, mismo lugar, misma luz y mismo estilo), pero dibuja ESTA toma con su propia acción y su propio encuadre. No copies la imagen anterior ni repitas su composición.'
                # Vestuario vigente (2026-10-29): si el usuario editó el
                # vestuario en la ficha, ese es el que se debe pedir en
                # las imágenes nuevas, no el que tenía la referencia vieja.
                _costumes=[]
                for _rid in shot.get('visibleCharacters',[]):
                    _ch=next((x for k in ('characters',) for x in d['bible'][k] if x['id']==_rid),None)
                    if _ch and _ch.get('costumes'):
                        _costumes.append(_ch['name']+': '+'; '.join(c.get('description','') for c in _ch['costumes'] if c.get('description')))
                if _costumes:prompt+='\nVestuario vigente que deben llevar los personajes en esta imagen: '+ ' | '.join(_costumes)
            else:
                e=next((e for k in ('characters','locations','props') for e in d['bible'][k] if e['id']==eid),None)
                require(e,'ENTITY','Referencia inexistente');prompt=image_prompt(e,style=style)
            raw,mime=provider.image(prompt,refs,p['format'])
            extension={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}.get(mime)
            require(extension,'IMAGE_FORMAT','Google devolvió un formato de imagen no admitido. No se repitió la generación.')
            path=root/('image'+extension);path.write_bytes(raw);inspect(path,'video')
            return {'assetId':asset(path,'image',('layer_'+ident_new()) if data.get('variantPrompt') else eid,{'variantOf':eid if data.get('variantPrompt') else None,'parentAssetId':refs[0]['id'] if data.get('variantPrompt') else asset_parent,'references':[a['id'] for a in refs],'dependencies':asset_deps if asset_deps is not None else dependency_records(refs),'model':provider_config['models']['image'],'prompt':prompt})['id']}
        if op=='veo':
            from shorts.core.timing import veo_seconds_for_manual_video
            shot=next(s for s in d['shots'] if s['id']==eid);image=selected(eid,'image')
            raw_id=ident_new();output=j.get('providerOutput') or f'gs://{cloud.c["bucket"]}/{cloud.c["prefix"]}/projects/{pid}/assets/{raw_id}/'
            # Veo parte de la imagen aprobada, así que el estilo ya viene de
            # ella; este sufijo refuerza el estilo elegido cuando la imagen
            # es antigua o el modelo duda entre estilos.
            veo_style=' Estilo visual: anime cinematográfico detallado y maduro, no infantil.' if style=='anime_cinematografico' else ' Estilo visual: cinematográfico fotorrealista, personajes ficticios, no personas reales, no dibujo ni anime.'
            # Contexto ficticio explícito: la historia es ciencia ficción y
            # supervivencia, con criaturas ficticias; el aspecto realista es
            # solo el estilo visual, no personas ni violencia reales. Sin
            # este contexto, un plano realista con un arma puede leerse como
            # manejo real de un arma y el proveedor lo devuelve vacío.
            veo_context='Fictional science-fiction survival story, fictional characters and fictional creatures, staged scene, not real people, not real violence. '
            operation={'name':j['providerOperation']} if j.get('providerOperation') else provider.veo({'prompt':veo_context+shot['prompt']+veo_style,'imageApproved':True,'imageMime':image['mimeType'],'durationSeconds':veo_seconds_for_manual_video(shot),'format':p['format']},uri(image),output)
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
            videos=result.get('response',{}).get('videos',[])
            if videos:
                source=videos[0]['gcsUri'];require(source.startswith(output),'VEO_OUTPUT','Salida fuera del destino autorizado')
            else:
                # Regla del usuario: si Veo generó un archivo y quedó guardado
                # en el bucket, la aplicación debe mostrarlo aunque la
                # respuesta de la operación no lo liste. El usuario decide
                # si le sirve y lo aprueba o si lo regenera. Solo se busca
                # dentro del destino autorizado de este trabajo, nunca fuera.
                prefix=output.removeprefix('gs://'+cloud.c['bucket']+'/')
                found=sorted(b.name for b in cloud.bucket.list_blobs(prefix=prefix) if b.name.lower().endswith('.mp4'))
                require(found,'VEO_EMPTY','Sin video utilizable')
                source='gs://'+cloud.c['bucket']+'/'+found[0]
            name=source.removeprefix('gs://'+cloud.c['bucket']+'/');original=root/'original.mp4';cloud.download(pid,name,original)
            silent=root/'silent.mp4';meta=silent_video(original,silent)
            try:clip_seconds=float(meta.get('probe',{}).get('format',{}).get('duration',0))
            except (TypeError,ValueError):clip_seconds=0
            return {'assetId':asset(silent,'veo_silent_validated',eid,{**meta,'clipSeconds':clip_seconds,'dependencies':dependency_records([image]),'originalObject':name,'referenceImage':image['id'],'model':provider_config['models']['veo'],'generateAudio':False})['id']}
        if op in ('tts','music'):
            if op=='tts':
                u=next(u for u in d['utterances'] if u['id']==eid);character=next(c for c in d['bible']['characters'] if c['id']==u['speakerId'])
                raw=provider.tts(u,character['voice']);source=root/'original.wav'
            else:
                r=next(r for r in d['musicRequests'] if r['id']==eid);raw=provider.music(r['prompt'],r['seconds']);source=root/'original.mp3'
            source.write_bytes(raw);target=root/'audio.wav';meta=pcm(source,target);meta['waveform']=waveform(target)
            meta['model']=provider_config['models'][op];meta['contentReview']='needs_review';meta['originalObject']=cloud.upload_file(pid,ident_new(),source,source.name,media_type(source))
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
            # The same sound in several shots is one file, not one upload per
            # shot. The plan gives those requests the same group, so this file
            # is placed in each of them; each placement keeps its own sync,
            # because a hit lands on its own frame.
            shared=[]
            if req.get('soundGroup'):
                taken={c.to_dict().get('requestId') for c in cloud.project_ref(pid).collection('cues').stream()}
                for other in sound_group_uses(dev['data']['soundRequests'],req['id'],taken):
                    bed=other.get('type')=='ambience'
                    place={'anchorShotId':other['shotId'],'anchorFrameOffset':0} if bed else {'eventId':'event_'+ident_new()}
                    shared.append(entity('cues',{'audioRevision':a['id'],'requestId':other['id'],'track':'ambience' if bed else 'sfx','shotId':other['shotId'],'sourceSyncSample':0 if bed else (attacks[0] if attacks else 0),'trimInSample':0,'trimOutSample':meta['samples'],'offsetSamples':0,'gainDb':0,**place,'correctionSource':'detector','manualLock':False,'eventDescription':other['eventDescription'],'requestFingerprint':digest(other),'analysisAttempts':0}))
            # Subir un efecto es solo cargar y guardar: NO se lanza ningún
            # análisis automático de sincronización al subir, porque ese
            # análisis era lo que hacía eterna la carga y obligaba a
            # cancelarla. El efecto queda guardado con su ataque detectado
            # como sincronización inicial, y si el usuario quiere afinarlo
            # lo hace a mano con "Ajustar sincronización" o con "Localizar
            # contacto" en "Ayuda con IA", que sí lanza el análisis solo
            # cuando él lo pide.
            return {'analysisJobId':None,'assetId':a['id'],'cueId':cue['id'],'sharedCueIds':[x['id'] for x in shared],'requiresVisualAnchor':False,'requestedSeconds':req['seconds'],'receivedSeconds':meta['samples']/48000}
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
                result=provider.text(rules+'\nExamina el video real. Evento: '+cue['eventDescription']+'. Corrección solicitada: '+data.get('reason','Localizar contacto')+'. Devuelve {visible:boolean,approxSeconds:number|null,occurrences:[{seconds:number,description:string}],evidence:string,confidence:number}. Incluye CADA contacto visible separado y no inventes contacto.',[{'fileData':{'fileUri':composed_uri,'mimeType':'video/mp4'}}],True)
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
            fine=provider.text(rules+'\nElige fotograma de contacto, solo con evidencia. Devuelve {visible:boolean,frameIndex:number|null,evidence:string}. Evento: '+cue['eventDescription'],parts,True)
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
            # Una vista previa se veía siempre a 640x360, incluso la de una
            # sola toma: la imagen llegaba borrosa y parecía que generarla la
            # hubiera estropeado. Lo corto se ve a tamaño real; sólo una
            # previsualización larga se reduce, que es donde importa el tiempo.
            vertical=m.get('format')=='9:16';duracion=data['endFrame']-data['startFrame']
            ancho=None if op=='render' else (1080 if vertical else 1920) if duracion<=24*45 else (720 if vertical else 1280) if duracion<=24*150 else (360 if vertical else 640)
            result=render(m,root,data['startFrame'],data['endFrame'],op=='render',ancho)
            rid=ident_new();files={}
            names=[result['file'],'clean.mp4','subtitles.srt','subtitles.ass','compiled.json','result.json','mix-report.json']
            if op=='render':names+=['dialogue.wav','thought.wav','narration.wav','system.wav','music.wav','ambience.wav','sfx.wav','mix.wav']
            if op=='render':
                # Entrega para publicar, en Anime y en Cortos por igual:
                # un solo ZIP con el MP4 final y un texto con título,
                # descripción corta y hashtags, generado automáticamente
                # con los datos del proyecto, sin inventar historia. Los
                # demás archivos siguen existiendo para trabajo técnico,
                # pero en Exportar solo se muestra el botón Descargar ZIP.
                import re, zipfile
                title=str(p.get('title') or 'Corto')
                try:story=str(development()['data'].get('story') or '')
                except Exception:story=''
                desc=story.strip()
                for sep in ('\n\n','. '):
                    if sep in desc:desc=desc.split(sep,1)[0].strip();break
                if len(desc)>400:desc=desc[:397].rsplit(' ',1)[0].strip()+'...'
                if not desc:desc=title
                slug=re.sub(r'[^A-Za-z0-9]+','',title.title())
                tags=['#'+slug if slug else '#Corto','#Corto','#Anime']
                genre=str(p.get('genre') or '').strip()
                if genre:tags.append('#'+re.sub(r'[^A-Za-z0-9]+','',genre.title()))
                for sub in (p.get('subgenres') or [])[:2]:
                    tag='#'+re.sub(r'[^A-Za-z0-9]+','',str(sub).title())
                    if tag not in tags:tags.append(tag)
                txt=(title+'\n\n'+desc+'\n\n'+' '.join(tags)+'\n')
                (root/'publicacion.txt').write_text(txt,encoding='utf-8')
                with zipfile.ZipFile(root/'paquete_publicacion.zip','w',zipfile.ZIP_DEFLATED) as z:
                    z.write(root/result['file'],result['file'])
                    z.write(root/'publicacion.txt','publicacion.txt')
                names+=['paquete_publicacion.zip','publicacion.txt']
            for name in names:files[name]=cloud.upload_file(pid,rid,root/name,name,media_type(name,'application/json'))
            record={'id':rid,'revision':1,'state':'ready','jobId':j['id'],'cacheKey':digest([result['manifestHash'],data['startFrame'],data['endFrame'],op=='render',result['compilerVersion']]),'final':op=='render','timelineId':timeline['id'],'object':files[result['file']],'files':files,'draftIssues':timeline['data'].get('draftIssues',[]),'cueHashes':{c['id']:digest(c) for c in timeline['data']['cues']},**result}
            cloud.put_entity(pid,'previews',record);return {'previewId':rid,'final':op=='render'}
        if op=='review':
            a=cloud.entity(pid,'assets',data['assetId'])
            result=provider.text(rules+'\nRevisa solo el material observado contra estas biblias. Devuelve {issues:[],coverage:[],uncertainty:string}. No certifiques perfección.\n'+json.dumps(d['bible'],ensure_ascii=False),[{'fileData':{'fileUri':uri(a),'mimeType':a['mimeType']}}],True)
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
