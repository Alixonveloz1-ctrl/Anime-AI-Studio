"""One explicitly requested editorial stage per job; never chain paid calls."""
import copy
import json
import math
import time
from shorts.core.contracts import require, ContractError, digest, ident, integer, duration_target, AMBIENCE_LOOP_SECONDS, SFX_MAX_SECONDS
from shorts.service.director import develop_prompt, validate_development
from shorts.service.development_schema import development_schema
from shorts.service.references import link_references

STAGES=(
 ('Historia',('title','story','beats'),8192),
 ('Guion, biblias y planos',('bible','shots','utterances'),24576),
 ('Sonido, música y subtítulos',('soundRequests','musicRequests','subtitles'),12288),
 ('Revisión de continuidad',('issues','coverage','nativeQualityGuaranteed'),4096),
)

def stage_schema(stage):
    properties=development_schema()['properties']
    properties['story']={'type':'STRING','description':'Historia completa en español para leer y aprobar: inicio, desarrollo, conflicto, desenlace, acciones y silencios. No es una sinopsis ni una lista técnica.'}
    properties.update(issues={'type':'ARRAY','items':{'type':'STRING'}},coverage={'type':'ARRAY','items':{'type':'STRING'}},nativeQualityGuaranteed={'type':'BOOLEAN'})
    # Indices and source-file arithmetic are application responsibilities.
    if stage in (2,3):
        item=properties['shots']['items'] if stage==2 else properties['musicRequests']['items']
        derived=('referenceEntityIds',) if stage==2 else ('seconds','sourceInSample','fadeInSamples','fadeOutSamples')
        for field in derived:
            item['properties'].pop(field,None)
            for order in ('required','propertyOrdering'):
                if field in item.get(order,[]):item[order].remove(field)
    if stage==2:
        image=copy.deepcopy(properties['shots']['items']);video=copy.deepcopy(image)
        image['properties']['treatment']['enum']=['hold','camera2d','localized']
        video['properties']['treatment']['enum']=['veo']
        for key in ('frames','minFrames','maxFrames','leadFrames','tailFrames'):
            video['properties'][key]['maximum']=192
        for variant in (image,video):
            order=variant['propertyOrdering'];order.remove('treatment');order.insert(0,'treatment')
        properties['shots']['items']={'anyOf':[image,video]}
    keys=STAGES[stage-1][1]
    return {'type':'OBJECT','properties':{k:properties[k] for k in keys},'required':list(keys),'propertyOrdering':list(keys)}

def validate_shape(value,schema,path='respuesta'):
    problems=[]
    def check(v,s,p):
        if 'anyOf' in s:
            variants=s['anyOf']
            if isinstance(v,dict):
                variants=[a for a in variants if v.get('treatment') in a.get('properties',{}).get('treatment',{}).get('enum',[])]
            if len(variants)!=1:problems.append(p+': tratamiento de toma inválido');return
            check(v,variants[0],p);return
        kind=s.get('type')
        valid={'OBJECT':isinstance(v,dict),'ARRAY':isinstance(v,list),'STRING':isinstance(v,str),'INTEGER':type(v) is int,'NUMBER':type(v) in (int,float),'BOOLEAN':type(v) is bool}.get(kind,True)
        if not valid:problems.append(p+': tipo de dato incorrecto');return
        if kind=='OBJECT':
            for key in s.get('required',[]):
                if key not in v:problems.append(p+'.'+key+': falta este campo')
            for key,child in s.get('properties',{}).items():
                if key in v:check(v[key],child,p+'.'+key)
        elif kind=='ARRAY':
            if len(v)<s.get('minItems',0) or len(v)>s.get('maxItems',100000):problems.append(p+': cantidad de elementos inválida')
            for i,item in enumerate(v):check(item,s['items'],p+'['+str(i+1)+']')
        elif kind=='STRING' and not v.strip():problems.append(p+': texto vacío')
        elif kind in ('NUMBER','INTEGER') and (not math.isfinite(v) or v<s.get('minimum',-math.inf) or v>s.get('maximum',math.inf)):problems.append(p+': número fuera del intervalo')
        if 'enum' in s and v not in s['enum']:problems.append(p+': valor no permitido')
    check(value,schema,path)
    require(not problems,'DEVELOPMENT_FIELDS','El paso necesita corrección: '+ '; '.join(problems[:12]))

def story_data(data):
    # Old drafts have their authored narrative in bible.dramatic. Reuse text,
    # never fabricate a story from a title or a list of technical fields.
    story=data.get('story') or data.get('bible',{}).get('dramatic')
    return {'title':data.get('title',''),'story':story,'beats':copy.deepcopy(data.get('beats',[]))}

def validate_story(data):
    require(isinstance(data,dict),'STORY','Historia incompleta')
    for key in ('title','story'):
        require(isinstance(data.get(key),str) and data[key].strip(),'STORY','Falta el título o el texto de la historia para revisarla.')
    require(isinstance(data.get('beats'),list) and data['beats'],'STORY','Faltan los momentos dramáticos de la historia.')
    ids=set()
    for beat in data['beats']:
        require(isinstance(beat,dict),'STORY','Momento dramático inválido')
        key=ident(beat.get('id'));require(key not in ids,'DUPLICATE_ID','Momentos dramáticos con ID repetido');ids.add(key)
        for field in ('minFrames','preferredFrames','maxFrames'):integer(beat.get(field),field,0,7560)
        require(beat['minFrames']<=beat['preferredFrames']<=beat['maxFrames'],'BEAT_BOUNDS','Revisa los intervalos de los momentos dramáticos.')
    return data

def plan_shots(data, duration_bounds=None):
    """Fit provisional durations only within the authored elastic intervals.

    No audio measurement/approval is fabricated; actual audio is fitted later
    by the existing timeline compiler. No repeat, speed change or extra shot.
    """
    out=copy.deepcopy(data);shots=out.get('shots');voices=out.get('utterances')
    require(isinstance(shots,list) and shots and isinstance(voices,list),'SCRIPT','Faltan planos o intervenciones del guion.')
    lo=[];hi=[];sizes=[]
    for shot in shots:
        require(isinstance(shot,dict),'SCRIPT','Plano inválido')
        ident(shot.get('id'))
        for k in ('minFrames','maxFrames','frames'):integer(shot.get(k),k,1,7560)
        for k in ('leadFrames','tailFrames'):integer(shot.get(k),k,0,7560)
        pauses=shot['leadFrames']+shot['tailFrames']
        for voice in voices:
            require(isinstance(voice,dict),'SCRIPT','Intervención inválida')
            if voice.get('shotId')==shot['id']:
                for k in ('pauseBeforeFrames','pauseAfterFrames'):pauses+=integer(voice.get(k),k,0,7560)
        minimum=max(shot['minFrames'],pauses);maximum=shot['maxFrames']
        require(minimum<=maximum,'PAUSE_BOUNDS','Las pausas exceden el intervalo de la toma '+shot['id']+'. Corrige solo este paso.')
        if shot.get('treatment')=='veo':
            require(max(minimum,shot['frames'])<=192,'VEO_COVERAGE',f"La toma {shot['id']} está prevista para {shot['frames']/24:.1f} segundos, con un mínimo de {minimum/24:.1f}; necesita una corrección de planificación para Veo. El guion se conserva.")
            maximum=min(maximum,192);shot['maxFrames']=maximum
        lo.append(minimum);hi.append(maximum);sizes.append(max(minimum,min(maximum,shot['frames'])))
    if duration_bounds is None:
        target=duration_target(sum(lo),sum(sizes),sum(hi))
    else:
        lower=max(duration_bounds[0],sum(lo));upper=min(duration_bounds[1],sum(hi))
        require(lower<=upper,'SCRIPT_SEGMENT_DURATION',f'Este tramo cubre entre {sum(lo)/24:.1f} y {sum(hi)/24:.1f} segundos; necesita entre {duration_bounds[0]/24:.1f} y {duration_bounds[1]/24:.1f}. Los tramos anteriores siguen guardados. Corrige únicamente este tramo.')
        target=max(lower,min(upper,sum(sizes)))
    difference=target-sum(sizes)
    while difference:
        sign=1 if difference>0 else -1
        for i in range(len(sizes)):
            if (sign>0 and sizes[i]<hi[i]) or (sign<0 and sizes[i]>lo[i]):
                sizes[i]+=sign;difference-=sign
                if not difference:break
    for shot,size in zip(shots,sizes):shot['frames']=size
    return out

def plan_music(data):
    """Turn editorial cue bounds into physically valid source requests."""
    out=copy.deepcopy(data);pieces=[];rows=out.get('musicRequests')
    total=sum(s['frames'] for s in out.get('shots',[]))
    require(isinstance(rows,list),'MUSIC','Falta el plan musical.')
    occupied={r.get('id') for group in ('beats','shots','utterances','soundRequests') for r in out.get(group,[]) if isinstance(r,dict)}
    for kind in ('characters','locations','props'):occupied.update(r.get('id') for r in out.get('bible',{}).get(kind,[]) if isinstance(r,dict))
    reserved={r.get('id') for r in rows if isinstance(r,dict)}
    for row in rows:
        require(isinstance(row,dict),'MUSIC','Indicación musical inválida')
        key=ident(row.get('id'));require(key not in occupied,'DUPLICATE_ID','ID musical repetido: '+key);occupied.add(key)
        start=integer(row.get('startFrame'),'entrada musical',0,7559);end=integer(row.get('endFrame'),'salida musical',1,7560)
        require(start<end,'MUSIC_COVERAGE','La salida musical debe ir después de su entrada: '+key)
        # The screenplay is authoritative: a cue cannot extend past its ending.
        require(start<total,'MUSIC_COVERAGE','La música comienza después del final del guion: '+key)
        end=min(end,total)
        index=0
        while start<end:
            stop=min(end,start+184*24);index+=1
            piece=copy.deepcopy(row)
            if index>1:
                suffix=index;new=key+'_part'+str(suffix)
                while new in occupied or new in reserved:suffix+=1;new=key+'_part'+str(suffix)
                piece['id']=new;occupied.add(new)
            piece.update(startFrame=start,endFrame=stop,seconds=math.ceil((stop-start)/24),sourceInSample=0,fadeInSamples=0,fadeOutSamples=0)
            pieces.append(piece);start=stop
    out['musicRequests']=pieces
    return out

def plan_sound(data):
    """Effects you can actually obtain, and the same sound asked for only once.

    The plan for a five-minute short arrived with thirteen effects, several of
    them the same sound in different shots, and one 315-second «effect» that was
    really the room tone of the whole film: nothing anybody can go and fetch as
    a file. Here each request is cut back to a length that exists, and the ones
    that are the same sound share a group, so one upload serves all of them.
    """
    out=copy.deepcopy(data);rows=out.get('soundRequests')
    require(isinstance(rows,list),'SOUND','Falta el plan de efectos.')
    # Regla del usuario para futuros proyectos: un sonido producido por
    # voz humana NUNCA es un efecto a subir. Grito, gemido, respiración,
    # suspiro, risa, llanto o jadeo van como intervención (utterance)
    # con la voz del personaje en Gemini TTS, no como efecto externo,
    # porque una app externa le daría otro tono distinto al personaje.
    # Si el modelo genera uno así en el plan de sonido, se descarta aquí
    # en vez de pedirlo como archivo a subir; en el guion debe aparecer
    # como intervención del personaje, no como efecto.
    import re
    # Palabras completas, no prefijos: "sobre" no es "sob" (sollozo), y
    # "pasos sobre grava" no es un sonido vocal. Solo coinciden formas
    # completas de grito, gemido, respiración, etc., en inglés y español.
    vocal=re.compile(r'\b(?:screams?|screaming|shouts?|shouting|yells?|yelling|cry|cries|crying|groans?|groaning|moans?|moaning|grunts?|grunting|growls?|growling|breaths?|breathing|sighs?|sighing|laughs?|laughing|sobs?|sobbing|whispers?|whispering|gasps?|gasping|pants?|panting|vocal|voice|gritos?|gemidos?|respiración|respiraciones|respirar|respira|respirando|suspiros?|risas?|llanto|llorar|llora|llorando|jadeos?|jadear|susurros?|susurrar|human voice)\b')
    kept=[];seen=set()
    # IDs ya ocupados por el resto de la historia: un sonido nunca puede
    # reutilizar el ID de una toma, una voz o una ficha, ni el de otro sonido.
    seen_ids={str(r.get('id') or '') for group in ('beats','shots','utterances','musicRequests') for r in out.get(group,[]) if isinstance(r,dict)}
    seen_ids.update(str(r.get('id') or '') for kind in ('characters','locations','props') for r in out.get('bible',{}).get(kind,[]) if isinstance(r,dict))
    seen_ids.discard('')
    for row in rows:
        # El modelo repite el ID cuando el mismo sonido suena en varias
        # tomas (caso real 2026-10-29: sfx_heavy_footsteps_01 duplicado
        # en el paso 3 de Mi Vida Lenta). La validación exige IDs únicos
        # en toda la historia, así que la segunda ocurrencia se renombra
        # con sufijo, sin tocar su sonido, su toma ni su prompt: el
        # agrupado por sonido ya lo hace soundGroup, no el ID.
        rid=str(row.get('id') or '')
        if rid in seen_ids:
            suffix=2
            while f"{rid}_{suffix:02d}" in seen_ids:suffix+=1
            row['id']=f"{rid}_{suffix:02d}"
        seen_ids.add(str(row.get('id') or ''))
        require(isinstance(row,dict),'SOUND','Solicitud de sonido inválida')
        texto=' '.join(str(row.get(k) or '') for k in ('name','description','prompt','eventDescription')).lower()
        if vocal.search(texto):continue
        prompt=' '.join(str(row.get('prompt') or '').split()).lower()
        # The same sound in the same shot twice is not two sounds.
        key=(str(row.get('shotId') or ''),prompt)
        if prompt and key in seen:continue
        seen.add(key)
        kind=row.get('type') if row.get('type') in ('sfx','ambience') else 'sfx'
        seconds=row.get('seconds')
        seconds=float(seconds) if type(seconds) in (int,float) and seconds>0 else 2.0
        # Past a hit's length it is a bed, whatever it was labelled, and a bed
        # only ever needs a loop: the montage repeats it for as long as its
        # place lasts.
        if seconds>SFX_MAX_SECONDS:kind='ambience'
        seconds=min(seconds,AMBIENCE_LOOP_SECONDS if kind=='ambience' else SFX_MAX_SECONDS)
        row['type']=kind;row['seconds']=seconds
        for field in ('preparationSeconds','tailSeconds'):
            value=row.get(field)
            row[field]=float(value) if type(value) in (int,float) and value>0 else 0.0
        if kind=='ambience':row['preparationSeconds']=row['tailSeconds']=0.0
        margin=row['preparationSeconds']+row['tailSeconds']
        if margin>=seconds:
            share=max(0.0,(seconds-0.1)/2)
            row['preparationSeconds']=min(row['preparationSeconds'],share);row['tailSeconds']=min(row['tailSeconds'],share)
        # One group per distinct sound: uploading its file once gives it to every
        # shot where that same sound happens.
        row['soundGroup']=digest([kind,prompt])
        kept.append(row)
    out['soundRequests']=kept
    return out

def plan_voices(data):
    """A voice name the catalogue does not have cannot speak; map it, never dead-end.

    The response schema lists the thirty Gemini TTS names, and the model still
    answers now and then with the Cloud spelling ('ja-JP-Chirp3-HD-Kore'),
    another casing, or a name nobody has. The screenplay was accepted anyway and
    every single voice generation failed afterwards with 'the saved voice is not
    in the catalogue' — a finished story that could not say a word.
    """
    from shorts.core.requests import VOICES
    out=copy.deepcopy(data);known={name.lower():name for name in VOICES}
    for person in out.get('bible',{}).get('characters',[]):
        if not isinstance(person,dict):continue
        voice=person['voice'] if isinstance(person.get('voice'),dict) else {}
        asked=str(voice.get('name') or '').strip()
        name=known.get(asked.lower()) or known.get(asked.split('-')[-1].strip().lower())
        # Nothing recognisable: the story still has to be able to speak, so one
        # catalogue voice comes from the character's own id. The same character
        # always gets the same voice, and Personajes can change it.
        if not name:name=VOICES[int(digest(str(person.get('id') or ''))[:8],16)%len(VOICES)]
        person['voice']={**voice,'name':name,'languageCode':'ja-JP','direction':str(voice.get('direction') or '')}
    return out

def validate_stage(data,stage):
    validate_story(data)
    if stage==1:return copy.deepcopy(data)
    result=plan_voices(link_references(plan_shots(data)))
    missing={b['id'] for b in result['beats']}-{s.get('beatId') for s in result['shots']}
    require(not missing,'STORY_COVERAGE','El guion omitió momentos de la historia aprobada: '+', '.join(sorted(missing))+'. Completa este paso conservando la historia.')
    if stage==2:
        check={**result,'soundRequests':[],'musicRequests':[],
               'subtitles':[{'utteranceId':u.get('id'),'text':u.get('spanish')} for u in result['utterances']]}
        validate_development(check)
    else:
        result=plan_music(plan_sound(result));validate_development(result)
    return result

def source_for_stage(cloud,project,stage,source_id,source_hash=None):
    integer(stage,'paso',1,4)
    if stage==1:
        require(not source_id,'STAGE_SOURCE','La historia comienza sin un paso anterior.');return {}
    require(source_id and project.get('activeDraft')==source_id,'STAGE_SOURCE','Aprueba primero el paso anterior.',409)
    source=cloud.entity(project['id'],'developmentDrafts',source_id)
    require(source.get('ideaId')==project['selectedIdea']['id'] and source.get('stage')==stage-1 and source.get('status')=='ready' and source.get('approvalState')=='approved','STAGE_SOURCE','El paso anterior no está aprobado para esta idea.',409)
    if source_hash:require(digest(source['data'])==source_hash,'STAGE_CHANGED','El contenido aprobado cambió.',409)
    return copy.deepcopy(source['data'])

def apply_voice_assignments(data,project):
    out=copy.deepcopy(data)
    settings=project.get('voiceAssignments',{})
    if settings.get('ideaId')==project.get('selectedIdea',{}).get('id'):
        for character in out['bible']['characters']:
            if character['id'] in settings.get('voices',{}):character['voice']=copy.deepcopy(settings['voices'][character['id']])
    return out

def production_draft(row):
    """Expose an approved screenplay for media work without inventing a score.

    The snapshot uses the same development contract as final editorial review.
    A stage marker keeps export pending until the remaining review is finished.
    """
    require(row.get('stage') in (2,3) and row.get('status')=='ready' and row.get('approvalState')=='approved',
            'SCRIPT_APPROVAL','Aprueba el guion completo antes de abrir producción.',409)
    data=validate_stage(row['data'],row['stage'])
    if row['stage']==2:
        data.update(soundRequests=[],musicRequests=[],subtitles=[
            {'utteranceId':u['id'],'text':u['spanish']} for u in data['utterances']])
    return validate_development(data)

def develop(cloud,provider,job,project,idea):
    stage=job['payload'].get('stage',1);integer(stage,'paso',1,4)
    prior=source_for_stage(cloud,project,stage,job['payload'].get('sourceDraftId'),job['payload'].get('sourceHash'))
    if stage==2:
        from shorts.service.script_segments import develop_segment
        return develop_segment(cloud,provider,job,project,idea,prior)
    label,keys,limit=STAGES[stage-1];pid=project['id'];jid=job['id']
    draft={'id':jid,'jobId':jid,'ideaId':idea['id'],'stage':stage,'sourceDraftId':job['payload'].get('sourceDraftId'),
           'sourceHash':job['payload'].get('sourceHash'),'data':prior,'created':time.time(),'status':'building','approvalState':'incomplete'}
    cloud.put_entity(pid,'developmentDrafts',copy.deepcopy(draft));ref=cloud.entity_ref(pid,'developmentDrafts',jid)
    cloud.db.collection('animeShortsJobs').document(jid).update({'progress':{'stage':stage,'total':4,'label':label}})
    prompt=develop_prompt(project,idea['data'])+'\nGenera SOLO el paso '+label+'. No escribas los otros pasos ni cambies el contenido previo aprobado. '
    prompt+='La historia debe poder leerse completa antes de producir. Los intervalos de los planos deben permitir que el TOTAL del corto dure entre 6840 y 7560 frames (285 a 315 segundos a 24 FPS), incluyendo todas las pausas, sin acelerar voces. La aplicación calcula la suma provisional dentro de esos intervalos. La aplicación calcula la duración de cada encargo musical a partir de sus entradas y salidas, y divide piezas de más de 184 segundos. '
    prompt+='Cada personaje necesita voz ja-JP y cada intervención debe referirse al ID exacto de su personaje. '
    if stage==3:
        # Every effect is a file the user has to go and obtain by hand. Thirteen
        # of them for five minutes, with repeats, was a day of work; one of
        # 315 seconds was not obtainable at all.
        prompt+=('EFECTOS DE SONIDO: pide SOLO los que de verdad necesitan un archivo propio y marcan un momento. '
                 'Para cinco minutos bastan entre tres y seis sonidos distintos; menos es mejor. Cada solicitud es un archivo '
                 'que una persona tiene que conseguir y subir a mano. Si el MISMO sonido ocurre en varias tomas, repite su '
                 'prompt palabra por palabra en cada toma donde suena: la aplicación lo reconoce como el mismo sonido y un '
                 'solo archivo sirve para todas. PERO cada ocurrencia debe tener un ID ÚNICO y distinto, nunca repitas un ID: si son pasos pesados en tres tomas, usa sfx_heavy_footsteps_01, sfx_heavy_footsteps_02 y sfx_heavy_footsteps_03, uno por toma. Un ID repetido rechaza todo el plan, aunque el sonido sea el mismo. No pidas efectos para lo que ya cuentan la voz o la música. '
                 f'type=sfx es un sonido con un instante exacto de contacto y dura como máximo {SFX_MAX_SECONDS} segundos. '
                 f'type=ambience es un lecho continuo del que solo hace falta un BUCLE CORTO de hasta {AMBIENCE_LOOP_SECONDS} '
                 'segundos; la aplicación lo repite mientras dure su lugar, así que nunca pidas el ambiente entero del corto. '
                 'Un fondo continuo o musical NO es un efecto: encárgalo en musicRequests, que lo compone Lyria. ')
    prompt+='\nContexto aprobado:\n'+json.dumps(prior,ensure_ascii=False)
    if job['payload'].get('instruction'):prompt+='\nCorrección solicitada por el usuario para este paso: '+job['payload']['instruction']
    try:
        part=provider.text(prompt,max_output_tokens=limit,response_schema=stage_schema(stage))
        ref.update({'raw':part})
        require(isinstance(part,dict) and set(part)==set(keys),'DEVELOPMENT_STAGE','Respuesta incompleta en '+label+'. Los pasos anteriores siguen guardados.')
        validate_shape(part,stage_schema(stage))
        if stage==4:
            require(isinstance(part['issues'],list) and all(isinstance(x,str) for x in part['issues']) and isinstance(part['coverage'],list),'REVIEW','Revisión incompleta')
            part['nativeQualityGuaranteed']=False
            result=validate_stage(prior,3);ref.update({'data':result,'review':part,'status':'ready','approvalState':'candidate'})
            return {'data':result,'review':part}
        combined={**prior,**part};ref.update({'data':combined})
        result=validate_stage(combined,stage)
        ref.update({'data':result,'status':'ready','approvalState':'candidate'})
        return {'draftId':jid,'stage':stage}
    except ContractError as error:
        ref.update({'status':'invalid','error':{'code':error.code,'message':str(error)}});raise

def recover_story(cloud,project,source_id,new_id):
    source=cloud.entity(project['id'],'developmentDrafts',source_id)
    require(source.get('ideaId')==project.get('selectedIdea',{}).get('id'),'IDEA_CHANGED','El borrador pertenece a otra idea.',409)
    job=cloud.db.collection('animeShortsJobs').document(source.get('jobId',source_id)).get().to_dict()
    require(job and job.get('projectId')==project['id'] and job.get('owner')==project['owner'] and job.get('settled'),'RECOVERY_STATE','El trabajo todavía no está cerrado.',409)
    require(not any(c.get('state')=='submitted_unknown' for c in job.get('providerCalls',[])),'SUBMITTED_UNKNOWN','Hay una llamada sin confirmar.',409)
    data=validate_story(story_data(source.get('data',{})))
    candidate={'id':new_id,'ideaId':source['ideaId'],'stage':1,'data':data,'status':'ready','approvalState':'candidate','created':time.time(),'recoveredFrom':source_id}
    cloud.put_entity(project['id'],'developmentDrafts',candidate)
    return candidate

def recover_sound(cloud,project,source_id,new_id):
    """Repair saved editorial cue durations without another provider call."""
    source=cloud.entity(project['id'],'developmentDrafts',source_id)
    require(source.get('stage')==3 and source.get('status')=='invalid' and source.get('error',{}).get('code') in ('MUSIC_COVERAGE','MUSIC_DURATION','MUSIC_FADE'),'SOUND_RECOVERY','Este borrador no contiene un plan musical recuperable.',409)
    require(source.get('ideaId')==project.get('selectedIdea',{}).get('id'),'IDEA_CHANGED','Cambió la idea seleccionada.',409)
    source_for_stage(cloud,project,3,source.get('sourceDraftId'),source.get('sourceHash'))
    job=cloud.db.collection('animeShortsJobs').document(source.get('jobId',source_id)).get().to_dict()
    require(job and job.get('projectId')==project['id'] and job.get('owner')==project['owner'] and job.get('settled'),'RECOVERY_STATE','El trabajo todavía no está cerrado.',409)
    require(not any(c.get('state')=='submitted_unknown' for c in job.get('providerCalls',[])),'SUBMITTED_UNKNOWN','Hay una llamada sin confirmar.',409)
    candidate={'id':new_id,'ideaId':source['ideaId'],'stage':3,'sourceDraftId':source['sourceDraftId'],'sourceHash':source['sourceHash'],
               'data':validate_stage(source['data'],3),'status':'ready','approvalState':'candidate','created':time.time(),'recoveredFrom':source_id}
    cloud.put_entity(project['id'],'developmentDrafts',candidate)
    return candidate


def script_timing_brief(prior):
    """Budget the whole approved story, never reinterpret returned frame units."""
    beats=prior.get('beats',[])
    weights=[max(1,b.get('preferredFrames',1)) for b in beats]
    total=sum(weights);cursor=0;budget=[]
    for i,(beat,weight) in enumerate(zip(beats,weights)):
        end=round(7200*sum(weights[:i+1])/total)
        budget.append({'beatId':beat['id'],'targetSeconds':(end-cursor)/24,'targetFrames':end-cursor})
        cursor=end
    return ('PLANIFICA TODA LA HISTORIA APROBADA, desde inicio hasta desenlace; no entregues un ejemplo ni solo la primera escena. '
        'Todos los campos cuyo nombre contiene Frames y el campo frames están en FOTOGRAMAS, NUNCA en segundos. '
        'A 24 FPS: 1 segundo=24 frames; 8 segundos=192; 12 segundos=288. '
        'frames incluye voces, pausas y acciones del plano, no solo su silencio. La música y los efectos simultáneos no se suman otra vez. '
        'Puede haber planos sin voces, solo acción, silencio, música o ambiente. Distribuye el relato con ritmo natural. '
        'Presupuesto orientativo por momento narrativo, calculado sobre el total de cinco minutos: '+json.dumps(budget,ensure_ascii=False)+'. '
        'Cada momento necesita todos sus planos e intervenciones. Verifica antes de responder que la suma de frames de TODOS los planos está entre 6840 y 7560. '
        'No confíes en que el montaje añadirá el tiempo que falta. No estires miradas ni dupliques planos para rellenar. '
        'Solo Veo tiene límite de 192 frames por toma; hold/camera2d/localized pueden cubrir acciones más largas con justificación dramática.')
