"""One user-requested bible or bounded screenplay segment per paid call.

Each successful request is an immutable checkpoint. Nothing is appended to an
approved story, stretched to five minutes, or automatically submitted again.
"""
import copy
import json
import math
import time
from shorts.core.contracts import require, digest, ident, ContractError
from shorts.service.director import rules_for, project_style, validate_development
from shorts.service.references import link_references


def segment_plan(prior):
    """Allocate the whole story, splitting long beats into <=48 second requests."""
    beats=prior['beats'];weights=[max(1,b['preferredFrames']) for b in beats]
    total=sum(weights);cursor=0;used=0;plan=[]
    for beat,weight in zip(beats,weights):
        used+=weight;end=round(7200*used/total);frames=end-cursor;cursor=end
        require(frames>0,'STORY_TIMING','Un momento narrativo no tiene espacio en los cinco minutos. Revisa su planificación.')
        count=math.ceil(frames/1152)
        for n in range(count):
            size=round(frames*(n+1)/count)-round(frames*n/count)
            plan.append({'beatId':beat['id'],'part':n+1,'parts':count,'targetFrames':size,
                         'minFrames':math.ceil(size*.95),'maxFrames':math.floor(size*1.05)})
    return plan


def checkpoint_hash(row):
    return digest({k:row[k] for k in ('data','segmentPlan','scriptProgress')})


def continuation(cloud,project,source_id,prior,checkpoint_id,expected_hash=None):
    if not checkpoint_id:return None
    row=cloud.entity(project['id'],'developmentDrafts',checkpoint_id)
    require(row.get('stage')==2 and row.get('status')=='partial' and
            row.get('ideaId')==project['selectedIdea']['id'] and
            row.get('sourceDraftId')==source_id and row.get('sourceHash')==digest(prior),
            'SCRIPT_CHECKPOINT','Este tramo no corresponde a la historia aprobada.',409)
    require(row.get('segmentPlan')==segment_plan(prior),'SCRIPT_CHECKPOINT','Cambió el plan de tramos.',409)
    progress=row.get('scriptProgress',{});done=progress.get('completed')
    require(type(done) is int and 0<=done<len(row['segmentPlan']) and row.get('data',{}).get('bible'),
            'SCRIPT_CHECKPOINT','El tramo anterior está incompleto.',409)
    if expected_hash:require(checkpoint_hash(row)==expected_hash,'SCRIPT_CHECKPOINT','Cambió el tramo anterior.',409)
    return copy.deepcopy(row)


def segment_schema(index,plan):
    from shorts.service.development import stage_schema
    schema=stage_schema(2)
    keys=('bible',) if index is None else ('shots','utterances')
    schema={**schema,'properties':{k:schema['properties'][k] for k in keys},'required':list(keys),'propertyOrdering':list(keys)}
    if index is not None:
        for variant in schema['properties']['shots']['items']['anyOf']:
            variant['properties']['beatId']['enum']=[plan[index]['beatId']]
    return schema


def validate_segment(prior,part,plan,index):
    from shorts.service.development import plan_shots,validate_stage
    segment=plan[index];bounds=(segment['minFrames'],segment['maxFrames'])
    require(all(s['beatId']==segment['beatId'] for s in part['shots']),
            'SCRIPT_BEAT','El tramo debe desarrollar el momento narrativo solicitado.')
    local=link_references(plan_shots({**prior,**part},duration_bounds=bounds))
    check={**local,'soundRequests':[],'musicRequests':[],
           'subtitles':[{'utteranceId':u['id'],'text':u['spanish']} for u in local['utterances']]}
    validate_development(check,duration_bounds=bounds)
    combined={**prior,'shots':prior.get('shots',[])+local['shots'],
              'utterances':prior.get('utterances',[])+local['utterances']}
    # Validate cross-segment identifiers and links immediately, without imposing
    # the five-minute requirement on an unfinished screenplay.
    accumulated={**combined,'soundRequests':[],'musicRequests':[],
                 'subtitles':[{'utteranceId':u['id'],'text':u['spanish']} for u in combined['utterances']]}
    validate_development(accumulated,duration_bounds=(1,7560))
    if index+1==len(plan):return validate_stage(combined,2)
    return combined


def develop_segment(cloud,provider,job,project,idea,story):
    from shorts.service.development import validate_shape
    payload=job['payload'];pid=project['id'];jid=job['id'];plan=segment_plan(story)
    previous=continuation(cloud,project,payload.get('sourceDraftId'),story,
                          payload.get('checkpointId'),payload.get('checkpointHash'))
    index=previous['scriptProgress']['completed'] if previous else None
    data=previous['data'] if previous else copy.deepcopy(story)
    label='Biblias de personajes y lugares' if index is None else f'Guion · tramo {index+1} de {len(plan)}'
    progress={'completed':index or 0,'total':len(plan),'frames':sum(s['frames'] for s in data.get('shots',[]))}
    draft={'id':jid,'jobId':jid,'ideaId':idea['id'],'stage':2,'sourceDraftId':payload.get('sourceDraftId'),
           'sourceHash':digest(story),'checkpointId':payload.get('checkpointId'),'data':copy.deepcopy(data),
           'segmentPlan':plan,'scriptProgress':progress,'created':time.time(),'status':'building','approvalState':'incomplete'}
    cloud.put_entity(pid,'developmentDrafts',copy.deepcopy(draft));ref=cloud.entity_ref(pid,'developmentDrafts',jid)
    cloud.db.collection('animeShortsJobs').document(jid).update({'progress':{'stage':(index+2) if index is not None else 1,'total':len(plan)+1,'label':label}})
    prompt=rules_for(project_style(project))+'\nEsta llamada genera SOLO '+label+'. No desarrolles otros pasos.\nCada intervención: japanese va escrito ÚNICAMENTE con caracteres japoneses (hiragana, katakana o kanji), nunca en español ni con letras latinas; spanish es su traducción al español.\n'
    prompt+='Proyecto e idea: '+json.dumps({'project':{k:project[k] for k in ('genre','subgenres','concept','format')},'idea':idea['data']},ensure_ascii=False)
    prompt+='\nHistoria y contenido previo que debes conservar sin reescribir:\n'+json.dumps(data,ensure_ascii=False)
    prompt+='\nPlan completo de tramos (duraciones en fotogramas a 24 FPS): '+json.dumps(plan,ensure_ascii=False)
    if index is None:
        prompt+='\nCrea únicamente las biblias de TODOS los personajes, lugares y objetos necesarios para la historia completa. Incluye sus referencias visuales y voces ja-JP. No escribas todavía planos ni diálogos.'
    else:
        segment=plan[index];start=sum(s['frames'] for s in data.get('shots',[]))/24
        prompt+=f'\nESCRIBE SOLAMENTE EL TRAMO {index+1}: momento {segment["beatId"]}, parte {segment["part"]} de {segment["parts"]}. Ya hay {start:.1f} segundos guardados. Este tramo necesita {segment["targetFrames"]/24:.2f} segundos propios, con margen de {segment["minFrames"]/24:.2f} a {segment["maxFrames"]/24:.2f}. NO son cinco minutos en esta llamada. Desarrolla acciones y diálogo suficientes para este tramo, sin resumirlo. Continúa desde el estado final del tramo anterior; reserva los hechos posteriores para sus tramos y llega al desenlace solo en el último.'
        prompt+=f'\nUsa IDs nuevos con prefijo t{index+1}_ para planos e intervenciones; conserva exactamente los IDs de las biblias. No repitas planos ni diálogos anteriores. Devuelve todas las tomas y voces de este tramo. Los planos sin voz son válidos si tienen acción, silencio o ambiente con intención dramática.'
        prompt+='\nframes, minFrames, maxFrames y pausas se expresan en FOTOGRAMAS: 2 s=48, 8 s=192. La suma de frames de este tramo debe cubrir su presupuesto. Cada toma Veo tiene máximo 192 frames incluidos los márgenes; divide acciones largas con continuidad. Nunca uses treatment=localized: exige generar variantes, marcar un rectángulo exacto y aprobar capas a mano, y el usuario no va a hacer ese trabajo manual. Si una toma necesitaría animación localizada, márcala como veo y que el video la resuelva solo. REGLA OBLIGATORIA DE VIDEO, SIN EXCEPCIÓN POR GÉNERO: al menos la mitad de las tomas DE ESTE TRAMO deben ser video real (treatment=veo), no imagen con paneo. Una toma con diálogo, grito, reacción o acción debe ser veo. Solo una pausa quieta, un detalle fijo o una transición pueden ser imagen, y nunca la mayoría del tramo. Incluso una historia lenta o tranquila se filma con video: movimiento lento, cultivar, regar, caminar, viento, luz que cambia. Nunca conviertas una acción en imagen solo para alargarla: divídela en varias tomas veo seguidas, cada una de máximo 192 frames, con continuidad explícita. Antes de responder, cuenta tus tomas: si menos de la mitad son veo, convierte tomas de imagen a veo hasta llegar a la mitad. No alargues imágenes ni repitas acciones para llenar tiempo. Cuenta voces, acciones y silencios dentro de la duración del plano; música y efectos simultáneos no se suman otra vez. No inventes audio medido. Usa diálogos japoneses con traducción española.'
    if payload.get('instruction'):prompt+='\nIndicaciones del usuario para esta parte: '+payload['instruction']
    schema=segment_schema(index,plan)
    try:
        part=provider.text(prompt,max_output_tokens=8192 if index is None else 16384,response_schema=schema)
        ref.update({'raw':part})
        require(isinstance(part,dict) and set(part)==set(schema['required']),'DEVELOPMENT_STAGE','Respuesta incompleta en '+label+'. Lo anterior sigue guardado.')
        validate_shape(part,schema)
        if index is None:
            ids={beat['id'] for beat in story['beats']}
            for kind in ('characters','locations','props'):
                for entity in part['bible'][kind]:
                    key=ident(entity['id'])
                    require(key not in ids,'DUPLICATE_ID','ID repetido en las biblias: '+key)
                    ids.add(key)
            from shorts.service.development import plan_voices
            result=plan_voices({**data,**part,'shots':[],'utterances':[]});completed=0
        else:
            try:
                result=validate_segment(data,part,plan,index)
            except ContractError as ve:
                # El modelo generó el tramo sin cumplir la regla de video:
                # no se le devuelve el error al usuario para que vuelva a
                # pulsar y pagar otra llamada a ciegas. Se le pide al
                # mismo modelo, con el tramo ya generado en la mano, que
                # lo corrija a video, en esta misma tarea, una sola vez.
                # Si tampoco así cumple, el error original sí se muestra.
                if ve.code!='VIDEO_MAJORITY':raise
                segment=plan[index]
                fix_prompt=(rules_for(project_style(project))+'\nCorrige SOLO este tramo, sin reescribir la historia ni cambiar voces. '
                    'El tramo que generaste tiene menos de la mitad de sus tomas como video real, y eso no se acepta. '
                    'Convierte tomas de imagen (hold/camera2d) a video real (treatment=veo) hasta que al menos la mitad de las tomas DE ESTE TRAMO sean veo. '
                    'Una toma con diálogo, reacción o acción debe ser veo. Divide cada toma larga en varias tomas veo seguidas, cada una de máximo 192 frames, con continuidad explícita, conservando la duración total del tramo entre '
                    f"{segment['minFrames']} y {segment['maxFrames']} frames. Conserva exactamente los IDs de las tomas que ya son veo y de todas las voces; para las tomas nuevas usa IDs nuevos con prefijo t{index+1}_. "
                    'Devuelve SOLO shots y utterances de este tramo, con el mismo esquema.\nTramo a corregir:\n'+json.dumps(part,ensure_ascii=False))
                fixed=provider.text(fix_prompt,max_output_tokens=16384,response_schema=schema)
                ref.update({'raw':fixed})
                require(isinstance(fixed,dict) and set(fixed)==set(schema['required']),'DEVELOPMENT_STAGE','Respuesta incompleta en la corrección del tramo. Lo anterior sigue guardado.')
                validate_shape(fixed,schema)
                result=validate_segment(data,fixed,plan,index)
            completed=index+1
        ready=completed==len(plan)
        progress={'completed':completed,'total':len(plan),'frames':sum(s['frames'] for s in result['shots'])}
        ref.update({'data':result,'scriptProgress':progress,'status':'ready' if ready else 'partial','approvalState':'candidate' if ready else 'incomplete'})
        return {'draftId':jid,'stage':2}
    except ContractError as error:
        ref.update({'status':'invalid','error':{'code':error.code,'message':str(error)}});raise
