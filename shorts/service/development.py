"""One explicitly requested editorial stage per job; never chain paid calls."""
import copy
import json
import math
import time
from shorts.core.contracts import require, ContractError, digest, ident, integer
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
    keys=STAGES[stage-1][1]
    return {'type':'OBJECT','properties':{k:properties[k] for k in keys},'required':list(keys),'propertyOrdering':list(keys)}

def validate_shape(value,schema,path='respuesta'):
    problems=[]
    def check(v,s,p):
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
        for field in ('minFrames','preferredFrames','maxFrames'):integer(beat.get(field),field,0,7200)
        require(beat['minFrames']<=beat['preferredFrames']<=beat['maxFrames'],'BEAT_BOUNDS','Revisa los intervalos de los momentos dramáticos.')
    return data

def plan_shots(data):
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
        for k in ('minFrames','maxFrames','frames'):integer(shot.get(k),k,1,7200)
        for k in ('leadFrames','tailFrames'):integer(shot.get(k),k,0,7200)
        pauses=shot['leadFrames']+shot['tailFrames']
        for voice in voices:
            require(isinstance(voice,dict),'SCRIPT','Intervención inválida')
            if voice.get('shotId')==shot['id']:
                for k in ('pauseBeforeFrames','pauseAfterFrames'):pauses+=integer(voice.get(k),k,0,7200)
        minimum=max(shot['minFrames'],pauses);maximum=shot['maxFrames']
        require(minimum<=maximum,'PAUSE_BOUNDS','Las pausas exceden el intervalo de la toma '+shot['id']+'. Corrige solo este paso.')
        require(shot.get('treatment')!='veo' or maximum<=192,'VEO_COVERAGE','La toma '+shot['id']+' supera 8 segundos de Veo. Divide la acción o cambia su tratamiento.')
        lo.append(minimum);hi.append(maximum);sizes.append(max(minimum,min(maximum,shot['frames'])))
    require(sum(lo)<=7200<=sum(hi),'DURATION_PLAN',f'Los intervalos de los planos permiten entre {sum(lo)/24:.1f} y {sum(hi)/24:.1f} segundos; deben permitir 300. Corrige el paso Guion, no la historia.')
    difference=7200-sum(sizes)
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
    require(isinstance(rows,list),'MUSIC','Falta el plan musical.')
    occupied={r.get('id') for group in ('beats','shots','utterances','soundRequests') for r in out.get(group,[]) if isinstance(r,dict)}
    for kind in ('characters','locations','props'):occupied.update(r.get('id') for r in out.get('bible',{}).get(kind,[]) if isinstance(r,dict))
    reserved={r.get('id') for r in rows if isinstance(r,dict)}
    for row in rows:
        require(isinstance(row,dict),'MUSIC','Indicación musical inválida')
        key=ident(row.get('id'));require(key not in occupied,'DUPLICATE_ID','ID musical repetido: '+key);occupied.add(key)
        start=integer(row.get('startFrame'),'entrada musical',0,7199);end=integer(row.get('endFrame'),'salida musical',1,7200)
        require(start<end,'MUSIC_COVERAGE','La salida musical debe ir después de su entrada: '+key)
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

def validate_stage(data,stage):
    validate_story(data)
    if stage==1:return copy.deepcopy(data)
    result=link_references(plan_shots(data))
    if stage==2:
        check={**result,'soundRequests':[],'musicRequests':[],
               'subtitles':[{'utteranceId':u.get('id'),'text':u.get('spanish')} for u in result['utterances']]}
        validate_development(check)
    else:
        result=plan_music(result);validate_development(result)
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

def develop(cloud,provider,job,project,idea):
    stage=job['payload'].get('stage',1);integer(stage,'paso',1,4)
    prior=source_for_stage(cloud,project,stage,job['payload'].get('sourceDraftId'),job['payload'].get('sourceHash'))
    label,keys,limit=STAGES[stage-1];pid=project['id'];jid=job['id']
    draft={'id':jid,'jobId':jid,'ideaId':idea['id'],'stage':stage,'sourceDraftId':job['payload'].get('sourceDraftId'),
           'sourceHash':job['payload'].get('sourceHash'),'data':prior,'created':time.time(),'status':'building','approvalState':'incomplete'}
    cloud.put_entity(pid,'developmentDrafts',copy.deepcopy(draft));ref=cloud.entity_ref(pid,'developmentDrafts',jid)
    cloud.db.collection('animeShortsJobs').document(jid).update({'progress':{'stage':stage,'total':4,'label':label}})
    prompt=develop_prompt(project,idea['data'])+'\nGenera SOLO el paso '+label+'. No escribas los otros pasos ni cambies el contenido previo aprobado. '
    prompt+='La historia debe poder leerse completa antes de producir. Los intervalos de los planos deben permitir sumar 7200 frames, incluyendo todas las pausas, sin acelerar voces. La aplicación calcula la suma provisional dentro de esos intervalos. La aplicación calcula la duración de cada encargo musical a partir de sus entradas y salidas, y divide piezas de más de 184 segundos. '
    prompt+='Cada personaje necesita voz ja-JP y cada intervención debe referirse al ID exacto de su personaje.\nContexto aprobado:\n'+json.dumps(prior,ensure_ascii=False)
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
