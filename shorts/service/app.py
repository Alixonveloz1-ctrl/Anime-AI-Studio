import copy
import json
import os
import time
import uuid
from functools import lru_cache
from flask import Flask, request, jsonify
from google.oauth2 import id_token
from google.auth.transport.requests import Request
from shorts.core.contracts import ContractError, require, ident, project, revision, edit_cue, compile_timeline, digest
from shorts.service.config import config
from shorts.service.cloud import Cloud

app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=1000000
@lru_cache
def cloud():return Cloud(config())
def uid():
    token=request.headers.get('Authorization','').removeprefix('Bearer ')
    require(token,'AUTH','Inicia sesión',401)
    import firebase_admin
    from firebase_admin import auth
    if not firebase_admin._apps:firebase_admin.initialize_app(options={'projectId':config()['authProject']})
    try:claims=auth.verify_id_token(token,check_revoked=True)
    except Exception:raise ContractError('AUTH','Sesión inválida o vencida',401)
    require(claims.get('email_verified') and claims.get('email') in config()['allowedEmails'],'ACCESS','Cuenta no autorizada',403)
    return claims['uid']
def body():
    value=request.get_json(silent=False)
    require(isinstance(value,dict),'JSON_OBJECT','Se requiere un objeto JSON',400)
    try:json.dumps(value,allow_nan=False)
    except (ValueError,TypeError):raise ContractError('JSON_NUMBER','Números no finitos no admitidos',422)
    return value
def expected():
    v=request.headers.get('If-Match','').strip('"')
    require(v.isdigit(),'IF_MATCH','Falta revisión esperada',409);return int(v)
def new_id():return uuid.uuid4().hex

def owned(pid):
    owner=uid();return cloud().project(pid,owner)

def submit(pid,operation,payload,key_override=None,pin=True):
    p=owned(pid);d=body()
    if pin and operation in ('image','veo','tts','music','transcribe','review','frames','analyze','media'):
        payload={**payload,'developmentId':p.get('activeDevelopment')}
        payload['approvedAssetIds']=[x.id for x in cloud().project_ref(pid).collection('assets').stream() if x.to_dict().get('approvalState')=='approved']
        payload['assetSelections']=p.get('assetSelections',{})
    job=cloud().submit(p,operation,payload,key_override or request.headers.get('Idempotency-Key',''),expected(),d.get('session',''))
    return jsonify(jobId=job['id'],state=job['state']),202

@app.errorhandler(ContractError)
def contract_error(e):return jsonify(error=str(e),code=e.code),e.status
@app.errorhandler(Exception)
def unexpected(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e,HTTPException):return jsonify(error=e.description,code='HTTP'),e.code
    # Do not log provider payloads, signed URLs or user texts.
    app.logger.error('shorts_error type=%s',type(e).__name__)
    return jsonify(error='No se completó la operación. Consulta diagnóstico.',code='INTERNAL'),500

@app.get('/health')
def health():return jsonify(service='anime-shorts',schemaVersion=2,providerAccess='pending_authorized_contract_tests',commit=os.environ.get('SHORTS_BUILD_COMMIT'),ready=bool(config()['bucket'] and config()['serviceAccount']))

@app.route('/projects',methods=['GET','POST'])
def projects():
    owner=uid();db=cloud().db
    if request.method=='GET':
        from google.cloud.firestore_v1.base_query import FieldFilter
        return jsonify(projects=[x.to_dict() for x in db.collection('animeShortsProjects').where(filter=FieldFilter('owner','==',owner)).limit(100).stream()])
    p=project(owner,new_id(),body());p['created']=p['updated']=time.time();cloud().project_ref(p['id']).create(p);return jsonify(p),201

@app.route('/projects/<pid>',methods=['GET','PATCH','DELETE'])
def project_route(pid):
    p=owned(pid)
    if request.method=='DELETE':
        # La confirmación en la pantalla es la autorización: no se pide
        # revisión, porque se puede borrar un proyecto que no está abierto.
        return jsonify(cloud().delete_project(pid,p['owner']))
    if request.method=='GET':
        result={**p,'entityCursors':{}}
        for k in ('ideas','developments','assets','cues','events','timelines','previews','developmentDrafts'):
            page=entity_page(pid,k);result[k]=page['items']
            if page['next']:result['entityCursors'][k]=page['next']
        if p.get('activeDevelopment'):
            from shorts.core.dependencies import select_assets
            dev=cloud().entity(pid,'developments',p['activeDevelopment'])
            assets=result['assets'] if 'assets' not in result['entityCursors'] else [x.to_dict() for x in cloud().project_ref(pid).collection('assets').stream()]
            result['usableAssetSelections']={eid+'|'+kind:a['id'] for (eid,kind),a in select_assets(assets,dev['data'],dev['id'],p.get('assetSelections')).items()}
        return jsonify(result)
    d=body();require(set(d)<={'title'},'FIELDS','Edita el contenido como una nueva revisión')
    def patch(tx,current):current.update(d)
    _,p=cloud().mutate(pid,expected(),patch);return jsonify(p)

@app.route('/projects/<pid>/generators',methods=['GET','POST'])
def generators(pid):
    from shorts.core.requests import MODEL_CHOICES,VOICE_GENDERS,selected_models,VISUAL_STYLES,visual_style
    p=owned(pid)
    if request.method=='POST':
        settings=body();style=visual_style(settings)
        models={k:v for k,v in settings.items() if k!='visualStyle'}
        selected_models(config(),models)
        def save(tx,current):current['generators']={**models,'visualStyle':style}
        _,p=cloud().mutate(pid,expected(),save)
    # Each voice travels with its gender: choosing one by ear meant generating
    # thirty samples to find out who was who.
    return jsonify(choices={k:[{'id':m,'name':n} for m,n in rows] for k,rows in MODEL_CHOICES.items()},
                   voices=[{'name':name,'gender':gender} for name,gender in VOICE_GENDERS.items()],
                   selected={k:v['model'] for k,v in selected_models(config(),p.get('generators',{})).items() if k in MODEL_CHOICES},
                   visualStyle=visual_style(p.get('generators',{})),
                   visualStyles=[{'id':k,'name':v} for k,v in VISUAL_STYLES.items()])

@app.post('/projects/<pid>/shots/<sid>/cast')
def shot_cast(pid,sid):
    # Corrección directa de reparto 2026-10-29, caso Plano 09: la toma
    # nombraba a un personaje presente pero no lo tenía en visibleCharacters,
    # así que su referencia nunca se enviaba. El editor general no permite
    # añadir un elemento a una lista vacía, así que este endpoint, igual
    # que los de voz y vestuario, crea una versión aprobada nueva y la deja
    # en uso de inmediato, solo con ese reparto cambiado.
    from shorts.service.director import validate_development
    p=owned(pid);d=body()
    ids=d.get('characterIds')
    require(isinstance(ids,list) and ids,'CAST','Elige al menos un personaje para esta toma.')
    require(len(set(ids))==len(ids),'CAST','Personajes duplicados en el reparto.')
    require(p.get('activeDevelopment'),'DEVELOPMENT','Abre producción con el guion aprobado.')
    old=cloud().entity(pid,'developments',p['activeDevelopment'])
    candidate=copy.deepcopy(old['data'])
    chars={x['id'] for x in candidate['bible']['characters']}
    require(set(ids)<=chars,'CAST','Personaje sin ficha.')
    shot=next((s for s in candidate['shots'] if s['id']==sid),None)
    require(shot,'SHOT','Toma inexistente')
    shot['visibleCharacters']=list(ids)
    shot['referenceEntityIds']=list(dict.fromkeys([*shot.get('referenceEntityIds',[]),shot['locationId'],*ids,*shot.get('props',[])]))
    validate_development(candidate)
    record={**old,'id':new_id(),'data':candidate,'previousId':old['id'],'source':'cast_fix','created':time.time(),'revision':1,
            'approvalState':'approved','approvedBy':p['owner'],'approvedAt':time.time()}
    for field in ('impact','review','jobId','dataHash'):record.pop(field,None)
    def save(tx,current):
        require(current.get('activeDevelopment')==old['id'],'STAGE_CHANGED','Cambió el guion. Vuelve a corregir el reparto.',409)
        tx.create(cloud().entity_ref(pid,'developments',record['id']),record)
        current.update(activeDevelopment=record['id'],timelineStale=True)
        return record
    result,_=cloud().mutate(pid,expected(),save);return jsonify(result),201

@app.post('/projects/<pid>/characters/<cid>/costumes')
def character_costumes(pid,cid):
    # Vestuario editable en la ficha (2026-10-29, a petición del usuario):
    # el director lo genera, el usuario lo cambia, y ese vestuario es el
    # que se pide en las próximas imágenes. Igual que el cambio de voz:
    # crea una versión aprobada nueva y la deja en uso de inmediato, sin
    # pasar por una candidata que haya que aprobar aparte. Los IDs de
    # vestuario se conservan, solo cambian sus descripciones, así que
    # nada más referencia esos IDs.
    from shorts.service.director import validate_development
    p=owned(pid);d=body()
    costumes=d.get('costumes')
    require(isinstance(costumes,list) and costumes,'COSTUMES','Escribe al menos un vestuario.')
    for c in costumes:
        require(isinstance(c,dict) and isinstance(c.get('id'),str) and c['id'] and isinstance(c.get('description'),str) and c['description'].strip(),'COSTUMES','Cada vestuario necesita una descripción.')
    require(len({c['id'] for c in costumes})==len(costumes),'COSTUMES','IDs de vestuario duplicados.')
    require(p.get('activeDevelopment'),'DEVELOPMENT','Abre producción con el guion aprobado.')
    old=cloud().entity(pid,'developments',p['activeDevelopment'])
    candidate=copy.deepcopy(old['data']);person=next((x for x in candidate['bible']['characters'] if x['id']==cid),None)
    require(person,'CHARACTER','Personaje inexistente')
    old_ids={c.get('id') for c in person.get('costumes',[])}
    require(old_ids and set(c['id'] for c in costumes)==old_ids,'COSTUMES','Solo se pueden editar los vestuarios que ya tiene este personaje.')
    person['costumes']=[{'id':c['id'],'description':c['description'].strip()} for c in costumes]
    validate_development(candidate)
    record={**old,'id':new_id(),'data':candidate,'previousId':old['id'],'source':'costume_edit','created':time.time(),'revision':1,
            'approvalState':'approved','approvedBy':p['owner'],'approvedAt':time.time()}
    for field in ('impact','review','jobId','dataHash'):record.pop(field,None)
    def save(tx,current):
        require(current.get('activeDevelopment')==old['id'],'STAGE_CHANGED','Cambió el guion. Vuelve a editar el vestuario.',409)
        tx.create(cloud().entity_ref(pid,'developments',record['id']),record)
        current.update(activeDevelopment=record['id'],timelineStale=True)
        return record
    result,_=cloud().mutate(pid,expected(),save);return jsonify(result),201

@app.post('/projects/<pid>/characters/<cid>/voice')
def character_voice(pid,cid):
    from shorts.core.requests import VOICES
    from shorts.service.director import validate_development
    p=owned(pid);d=body()
    require(set(d)<={'name','direction'} and d.get('name') in VOICES,'VOICE','Elige una voz del catálogo.')
    require(isinstance(d.get('direction',''),str) and len(d.get('direction',''))<=1000,'VOICE_DIRECTION','La dirección admite hasta 1000 caracteres.')
    require(p.get('activeDevelopment'),'DEVELOPMENT','Abre producción con el guion aprobado.')
    old=cloud().entity(pid,'developments',p['activeDevelopment'])
    candidate=copy.deepcopy(old['data']);person=next((x for x in candidate['bible']['characters'] if x['id']==cid),None)
    require(person,'CHARACTER','Personaje inexistente')
    voice={'name':d['name'],'direction':d.get('direction',''),'languageCode':'ja-JP'};person['voice']=voice
    validate_development(candidate)
    record={**old,'id':new_id(),'data':candidate,'previousId':old['id'],'source':'voice_assignment','created':time.time(),'revision':1,
            'approvalState':'approved','approvedBy':p['owner'],'approvedAt':time.time()}
    for field in ('impact','review','jobId','dataHash'):record.pop(field,None)
    def save(tx,current):
        require(current.get('activeDevelopment')==old['id'],'STAGE_CHANGED','Cambió el guion. Vuelve a elegir la voz.',409)
        assignments=current.get('voiceAssignments',{})
        if assignments.get('ideaId')!=current['selectedIdea']['id']:assignments={'ideaId':current['selectedIdea']['id'],'voices':{}}
        assignments['voices'][cid]=voice;current['voiceAssignments']=assignments
        tx.create(cloud().entity_ref(pid,'developments',record['id']),record)
        current.update(activeDevelopment=record['id'],timelineStale=True)
        return record
    result,_=cloud().mutate(pid,expected(),save);return jsonify(result),201

def entity_page(pid,kind,cursor=None):
    require(kind in ('ideas','developments','assets','cues','events','timelines','previews','developmentDrafts'),'ENTITY','Lista inválida')
    query=cloud().project_ref(pid).collection(kind).order_by('__name__').limit(51)
    if cursor:
        snapshot=cloud().entity_ref(pid,kind,ident(cursor)).get();require(snapshot.exists,'CURSOR','Página inexistente');query=query.start_after(snapshot)
    docs=list(query.stream());items=[x.to_dict() for x in docs[:50]]
    for row in items:
        if kind=='developments':row['dataHash']=digest(row['data'])
        if kind=='developmentDrafts':
            row['hasStory']=bool(row.get('data',{}).get('story') or row.get('data',{}).get('bible',{}).get('dramatic'))
            for field in ('data','raw','stages','review'):row.pop(field,None)
        if kind=='assets':row.pop('waveform',None) # retrieved on demand by its dedicated route
        # Every preview compiles a timeline; the studio only lists them, so the
        # manifests (read by id where needed) are not sent on every refresh.
        if kind=='timelines':row.pop('data',None)
    return {'items':items,'next':docs[49].id if len(docs)>50 else None}

@app.get('/projects/<pid>/entities/<kind>/after/<cursor>')
def entities_after(pid,kind,cursor):
    owned(pid);return jsonify(entity_page(pid,kind,cursor))

@app.post('/projects/<pid>/duplicate')
def duplicate(pid):
    p=owned(pid);require(expected()==p['revision'],'REVISION_CONFLICT','Revisión cambió',409)
    q=project(p['owner'],new_id(),p);q['title']=p['title']+' — copia';q['provenance']={'projectId':pid,'revision':p['revision']};cloud().project_ref(q['id']).create(q)
    return jsonify(q),201

@app.post('/projects/<pid>/lease')
def lease(pid):
    owned(pid);d=body();session=ident(d['session']);device=ident(d['device'])
    def update(tx,p):
        old=p.get('lease',{})
        if d.get('heartbeat'):
            require(old.get('session')==session and old.get('device')==device,'LEASE_REPLACED','La sesión fue reemplazada',409)
        # Releasing is only ever about THIS session's lease. Merely opening the
        # studio used to overwrite whatever was there with an expired lease, so
        # a second tab (or a reload that lost its session) stopped the
        # generation already running: a provider call refuses a lease held by
        # another session, and a queued job refuses to start without a live
        # one. Taking production over is still a press of a generation button,
        # which asks for an active lease.
        active=d.get('active',True)
        if not active and old.get('session') and old.get('session')!=session:return
        p['lease']={'device':device,'session':session,'expires':time.time()+(30 if active else 0)}
    _,p=cloud().mutate(pid,expected(),update);return jsonify(p)

@app.post('/projects/<pid>/ideas:generate')
def ideas(pid):return submit(pid,'ideas',{})

@app.post('/projects/<pid>/ideas/<iid>:select')
def select(pid,iid):
    owned(pid);idea=cloud().entity(pid,'ideas',iid)
    def change(tx,p):p['selectedIdea']={'id':iid,'hash':digest(idea)};p['stage']='guion'
    _,p=cloud().mutate(pid,expected(),change);return jsonify(p)
@app.post('/projects/<pid>/develop')
def develop(pid):
    p=owned(pid);require(p.get('selectedIdea'),'IDEA','Elige una idea')
    from shorts.service.development import source_for_stage
    stage=body().get('stage',1);source=body().get('sourceDraftId')
    prior=source_for_stage(cloud(),p,stage,source)
    instruction=body().get('instruction','')
    require(isinstance(instruction,str) and len(instruction)<=3000,'INSTRUCTION','La corrección admite hasta 3000 caracteres.')
    payload={'ideaId':p['selectedIdea']['id'],'stage':stage,'sourceDraftId':source,'sourceHash':digest(prior) if source else None,'instruction':instruction}
    checkpoint=body().get('checkpointId')
    if checkpoint:
        require(stage==2,'SCRIPT_CHECKPOINT','Solo el guion utiliza tramos.')
        from shorts.service.script_segments import continuation,checkpoint_hash
        row=continuation(cloud(),p,source,prior,ident(checkpoint))
        payload.update(checkpointId=checkpoint,checkpointHash=checkpoint_hash(row))
    return submit(pid,'develop',payload)

@app.get('/projects/<pid>/drafts/<eid>')
def get_draft(pid,eid):
    owned(pid);row=cloud().entity(pid,'developmentDrafts',eid)
    return jsonify({k:v for k,v in row.items() if k not in ('raw','stages')})

@app.post('/projects/<pid>/drafts/<eid>:recover')
def recover_draft(pid,eid):
    from shorts.service.development import recover_story
    p=owned(pid);revision(p,expected())
    # Stable ID makes a repeated tap recover the same candidate, with no model.
    key=digest(['recover-story-v1',pid,eid])
    ref=cloud().entity_ref(pid,'developmentDrafts',key)
    existing=ref.get().to_dict()
    if existing:
        require(existing.get('ideaId')==p.get('selectedIdea',{}).get('id'),'IDEA_CHANGED','El borrador pertenece a otra idea.',409)
        return jsonify(existing)
    return jsonify(recover_story(cloud(),p,eid,key))

@app.post('/projects/<pid>/drafts/<eid>:approve')
def approve_draft(pid,eid):
    from shorts.service.development import validate_stage
    owned(pid)
    def change(tx,current):
        ref=cloud().entity_ref(pid,'developmentDrafts',eid);row=ref.get(transaction=tx).to_dict()
        require(row and row.get('status')=='ready' and row.get('stage') in (1,2,3),'DRAFT','El paso no está listo para aprobar.',409)
        require(row.get('ideaId')==current.get('selectedIdea',{}).get('id'),'IDEA_CHANGED','Cambió la idea seleccionada.',409)
        if row['stage']>1:
            require(current.get('activeDraft')==row.get('sourceDraftId'),'STAGE_CHANGED','Cambió el paso anterior; revisa esta versión.',409)
            parent=cloud().entity_ref(pid,'developmentDrafts',row['sourceDraftId']).get(transaction=tx).to_dict()
            require(parent and digest(parent['data'])==row.get('sourceHash'),'STAGE_CHANGED','Cambió el contenido anterior.',409)
        validate_stage(row['data'],row['stage'])
        row.update(approvalState='approved',approvedBy=current['owner'],approvedAt=time.time())
        tx.set(ref,row);current['activeDraft']=eid
        if row['stage']==1:current['title']=row['data']['title']
        return row
    row,_=cloud().mutate(pid,expected(),change);return jsonify(row)

@app.post('/projects/<pid>/drafts/<eid>:recover-sound')
def recover_sound_draft(pid,eid):
    from shorts.service.development import recover_sound
    p=owned(pid);revision(p,expected())
    key=digest(['recover-sound-v1',pid,eid])
    existing=cloud().entity_ref(pid,'developmentDrafts',key).get().to_dict()
    if existing:return jsonify(existing)
    return jsonify(recover_sound(cloud(),p,eid,key)),201

@app.post('/projects/<pid>/drafts/<eid>:produce')
def produce_draft(pid,eid):
    from shorts.service.development import production_draft,apply_voice_assignments
    owned(pid)
    key=digest(['production-draft-v1',pid,eid])
    def change(tx,current):
        row=cloud().entity_ref(pid,'developmentDrafts',eid).get(transaction=tx).to_dict()
        require(row and row.get('ideaId')==current.get('selectedIdea',{}).get('id'),'IDEA_CHANGED','Cambió la idea seleccionada.',409)
        require(current.get('activeDraft')==eid,'STAGE_CHANGED','Abre producción desde el paso aprobado vigente.',409)
        data=apply_voice_assignments(production_draft(row),current)
        # Production may already be open with this same step CORRECTED by hand
        # (an edited candidate, approved). Re-opening it rewound production to
        # the version from before those corrections without saying so.
        in_use=cloud().entity_ref(pid,'developments',current['activeDevelopment']).get(transaction=tx).to_dict() if current.get('activeDevelopment') else None
        require(not(in_use and in_use.get('sourceDraftId')==eid and in_use.get('data')!=data),'SCRIPT_EDITED',
                'La producción ya usa este paso con tus correcciones. Reemplazarlo por la versión anterior perdería esos cambios.',409)
        production_key=digest([key,current['voiceAssignments']]) if current.get('voiceAssignments') else key
        ref=cloud().entity_ref(pid,'developments',production_key)
        existing=ref.get(transaction=tx).to_dict()
        if existing:
            require(existing.get('data')==data,'STAGE_CHANGED','Cambió el guion de esta versión.',409)
            record=existing
        else:
            record={'id':production_key,'revision':1,'data':data,'created':time.time(),
                    'ideaId':row['ideaId'],'sourceDraftId':eid,'editorialStage':row['stage'],
                    'approvalState':'approved','approvedBy':current['owner'],'approvedAt':time.time()}
            tx.create(ref,record)
        current.update(activeDevelopment=production_key,stage='tomas',timelineStale=True,title=data['title'])
        return record
    record,_=cloud().mutate(pid,expected(),change)
    return jsonify(record)

@app.post('/projects/<pid>/revisions/<kind>/<eid>:revise')
def revise(pid,kind,eid):
    owned(pid);cloud().entity(pid,kind,eid);d=body();require(isinstance(d.get('instruction'),str) and 0<len(d['instruction'])<=3000,'INSTRUCTION','Describe la corrección')
    require(kind in ('ideas','developments'),'REVISION_KIND','Solo ideas o guion se corrigen en esta ruta')
    if kind=='developments':
        from shorts.core.revisions import scoped_value
        scoped_value(cloud().entity(pid,kind,eid)['data'],d.get('scope'))
    else:
        from shorts.core.revisions import idea_scope
        idea_scope(cloud().entity(pid,kind,eid)['data'],d.get('scope'))
    return submit(pid,'revise',{'kind':kind,'entityId':eid,'instruction':d['instruction'],'scope':d.get('scope')})
@app.post('/projects/<pid>/developments/<eid>/edits:preview')
@app.post('/projects/<pid>/developments/<eid>/edits:save')
def development_edit(pid,eid):
    p=owned(pid);d=body();revision(p,expected())
    from shorts.core.revisions import apply_edits,impact
    from shorts.service.director import validate_development
    old=cloud().entity(pid,'developments',eid)
    require(d.get('sourceHash')==digest(old['data']),'EDIT_SOURCE','La versión de partida cambió',409)
    candidate=validate_development(apply_edits(old['data'],d.get('patches')))
    available=[x.to_dict() for x in cloud().project_ref(pid).collection('assets').stream()]
    report=impact(old['data'],candidate,available,eid)
    if request.path.endswith(':preview'):return jsonify(report=report,impactHash=digest(report))
    require(d.get('impactHash')==digest(report),'EDIT_IMPACT','Revisa las dependencias actualizadas antes de guardar',409)
    # An edited script keeps the lineage of the step it came from. Without it
    # the studio offered to "use this script in production" again and silently
    # replaced the corrected version with the one before the corrections.
    record={'id':new_id(),'revision':1,'approvalState':'candidate','data':candidate,'previousId':eid,
            'created':time.time(),'source':'manual','impact':report,'ideaId':old.get('ideaId'),
            'sourceDraftId':old.get('sourceDraftId'),'editorialStage':old.get('editorialStage',4)}
    def save(tx,current):
        tx.create(cloud().entity_ref(pid,'developments',record['id']),record)
        return record
    result,_=cloud().mutate(pid,expected(),save)
    return jsonify(result),201

@app.post('/projects/<pid>/revisions/<kind>/<eid>:approve')
def approve(pid,kind,eid):
    p=owned(pid);require(kind in ('developments','assets','timelines','references'),'ENTITY','Tipo no aprobable')
    ref=cloud().entity_ref(pid,kind,eid)
    def change(tx,current):
        entity=ref.get(transaction=tx).to_dict();require(entity and entity.get('approvalState') not in ('stale','quarantined'),'STALE','Recurso desactualizado')
        if entity.get('approvalState')=='approved':
            if kind=='assets':
                current.setdefault('assetSelections',{})[entity['entityId']+'|'+entity['kind']]=eid
                current['timelineStale']=True
            if kind=='developments':current.update(activeDevelopment=eid,stage='tomas',timelineStale=True)
            tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':kind,'entity':eid,'action':'select_existing_approval','author':p['owner'],'at':time.time()})
            return entity
        if kind=='developments' and entity.get('sourceDraftId'):
            require(entity['sourceDraftId']==current.get('activeDraft'),'STAGE_CHANGED','Cambió el guion aprobado después de esta revisión.',409)
        if kind=='assets':
            require(body().get('reviewed') is True,'ASSET_REVIEW','Abre el recurso y aprueba su contenido')
            require(entity['kind'] in ('image','veo_silent_validated','pcm'),'ASSET_REVIEW','Tipo de recurso no aprobable')
            entity['humanReview']={'reviewed':True,'at':time.time(),'by':p['owner']}
        if kind=='timelines':
            compile_timeline(entity['data'],True)
            require(not current.get('timelineStale') and current.get('candidateTimeline')==eid,'TIMELINE_STALE','Compila el montaje actual antes de aprobar',409)
        if kind=='developments':
            from shorts.service.development import apply_voice_assignments
            entity['data']=apply_voice_assignments(entity['data'],current)
        entity.update(approvalState='approved',approvedBy=p['owner'],approvedAt=time.time())
        tx.set(ref,entity);tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'entity':eid,'kind':kind,'hash':digest(entity),'author':p['owner'],'at':time.time()})
        if kind=='developments':current['activeDevelopment']=eid;current['stage']='tomas';current['timelineStale']=True
        if kind=='assets':
            current['timelineStale']=True
            current.setdefault('assetSelections',{})[entity['entityId']+'|'+entity['kind']]=eid
        if kind=='timelines':current['activeTimeline']=eid
        return entity
    entity,_=cloud().mutate(pid,expected(),change);return jsonify(entity)

@app.post('/projects/<pid>/assets/<aid>:use-as-shot-image')
def use_variant_as_shot_image(pid,aid):
    # Una variante aprobada (layer_*, variantOf=una toma) no es una imagen de
    # toma: su entityId es la capa, su huella es None y select_assets nunca
    # la devuelve para la toma, así que "Usar esta versión" sobre una variante
    # parecía no hacer nada: seleccionaba la capa, no la toma, y el video
    # seguía usando la imagen vieja. Esta promoción crea una copia de la
    # variante como imagen propia de la toma, con la huella del guion vigente
    # y sin dependencias, porque el usuario la eligió explícitamente; así la
    # selección queda en uso para la toma y para Generar video. Si ya existe
    # una copia promovida de esta variante, se reutiliza en vez de duplicarla.
    from shorts.core.dependencies import fingerprint
    p=owned(pid);require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias primero')
    dev=cloud().entity(pid,'developments',p['activeDevelopment'])
    variant=cloud().entity(pid,'assets',aid)
    require(variant.get('kind')=='image' and variant.get('approvalState')=='approved','VARIANT','Solo una variante de imagen aprobada puede usarse como imagen de la toma')
    shot_id=variant.get('variantOf');require(shot_id,'VARIANT','Esta imagen no es una variante de una toma')
    shot=next((s for s in dev['data']['shots'] if s['id']==shot_id),None);require(shot,'SHOT','La toma de la variante ya no existe en el guion vigente')
    existing=None
    for row in cloud().project_ref(pid).collection('assets').stream():
        row=row.to_dict()
        if row.get('promotedFrom')==aid and row.get('entityId')==shot_id:
            existing=row;break
    def change(tx,current):
        entity=cloud().entity_ref(pid,'assets',aid).get(transaction=tx).to_dict()
        require(entity and entity.get('kind')=='image' and entity.get('approvalState')=='approved','VARIANT','Solo una variante de imagen aprobada puede usarse como imagen de la toma')
        require(entity.get('variantOf')==shot_id,'VARIANT','La variante ya no pertenece a esta toma')
        if existing:
            promoted=dict(existing)
        else:
            promoted={**entity,'id':new_id(),'entityId':shot_id,'variantOf':None,'promotedFrom':aid,'approvalState':'approved','approvedBy':p['owner'],'approvedAt':time.time(),'created':time.time(),'revision':1,'inputFingerprint':fingerprint(dev['data'],shot_id,'image'),'dependencies':[]}
            tx.create(cloud().entity_ref(pid,'assets',promoted['id']),promoted)
        current.setdefault('assetSelections',{})[shot_id+'|image']=promoted['id']
        current['timelineStale']=True
        tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':'assets','entity':promoted['id'],'action':'use_variant_as_shot_image','source':aid,'author':p['owner'],'at':time.time()})
        return promoted
    promoted,_=cloud().mutate(pid,expected(),change);return jsonify(promoted)

@app.post('/projects/<pid>/assets:generate')
def generate(pid):
    p=owned(pid);d=body();require(d.get('operation') in ('image','veo','tts','music','transcribe','review'),'OPERATION','Motor inválido')
    require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias primero')
    from shorts.core.generation import generation_inputs
    dev=cloud().entity(pid,'developments',p['activeDevelopment'])
    assets=[x.to_dict() for x in cloud().project_ref(pid).collection('assets').stream()]
    generation_inputs(dev['data'],dev['id'],assets,p.get('assetSelections'),d['operation'],d.get('entityId'),bool(d.get('variantPrompt')))
    if d['operation']=='tts':
        from shorts.service.providers import tts_payload
        u=next(x for x in dev['data']['utterances'] if x['id']==d['entityId'])
        speaker=next(x for x in dev['data']['bible']['characters'] if x['id']==u['speakerId'])
        tts_payload(config(),u,speaker['voice'])
    if d['operation']=='review':require(any(a['id']==d.get('assetId') for a in assets),'ASSET','Material a revisar inexistente')
    return submit(pid,d['operation'],{k:d[k] for k in ('entityId','assetId','referenceIds','seconds','variantPrompt','shotImageInstruction') if k in d})

def batch_plan(p):
    from shorts.core.batches import pending_plan
    from google.cloud.firestore_v1.base_query import FieldFilter
    require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias')
    dev=cloud().entity(p['id'],'developments',p['activeDevelopment'])
    assets=sorted([x.to_dict() for x in cloud().project_ref(p['id']).collection('assets').stream()],key=lambda x:x.get('created',0))
    jobs=[x.to_dict() for x in cloud().db.collection('animeShortsJobs').where(filter=FieldFilter('projectId','==',p['id'])).stream()]
    return pending_plan(dev['data'],dev['id'],assets,jobs,p.get('assetSelections')),assets

@app.route('/projects/<pid>/batches',methods=['GET','POST'])
def batches(pid):
    p=owned(pid);nodes,_=batch_plan(p)
    if request.method=='GET':
        return jsonify(nodes=nodes,planHash=digest(nodes),batches=[x.to_dict() for x in cloud().project_ref(pid).collection('batches').stream()])
    d=body();require(d.get('acceptPlanHash')==digest(nodes),'BATCH_CHANGED','Revisa el plan actualizado',409)
    batch={'id':new_id(),'revision':1,'created':time.time(),'state':'active','developmentId':p['activeDevelopment'],'session':ident(d['session']),'authorizedKeys':[n['key'] for n in nodes if n['state']=='ready']}
    def save(tx,current):
        require(current.get('activeDevelopment')==batch['developmentId'],'BATCH_CHANGED','Cambió el guion',409)
        if current.get('activeBatch'):
            prior=cloud().entity_ref(pid,'batches',current['activeBatch']).get(transaction=tx).to_dict()
            if prior and prior['developmentId']==batch['developmentId']:
                prior.update(authorizedKeys=batch['authorizedKeys'],session=batch['session'],revision=prior['revision']+1)
                tx.set(cloud().entity_ref(pid,'batches',prior['id']),prior);return prior
        tx.create(cloud().entity_ref(pid,'batches',batch['id']),batch)
        current['activeBatch']=batch['id'];return batch
    result,_=cloud().mutate(pid,expected(),save)
    return jsonify(result),201

@app.post('/projects/<pid>/batches/<bid>:next')
def batch_next(pid,bid):
    from shorts.core.batches import batch_key
    p=owned(pid);d=body();b=cloud().entity(pid,'batches',bid)
    require(p.get('activeBatch')==bid,'BATCH_REPLACED','Este lote fue sustituido; abre el vigente',409)
    require(b['developmentId']==p.get('activeDevelopment'),'BATCH_CHANGED','Cambió el guion; revisa un nuevo lote')
    require(d.get('session')==p.get('lease',{}).get('session') and p['lease']['expires']>time.time(),'LEASE','Continúa la sesión antes de despachar',409)
    nodes,assets=batch_plan(p);node=next((n for n in nodes if n['state']=='ready' and n['key'] in b['authorizedKeys']),None)
    if not node:return jsonify(state='awaiting_review' if any(n['state']!='approved' for n in nodes) else 'completed',nodes=nodes)
    payload={'entityId':node['entityId'],'developmentId':b['developmentId'],'approvedAssetIds':[a['id'] for a in assets if a.get('approvalState')=='approved'],'assetSelections':p.get('assetSelections',{})}
    # Keep the original payload when an HTTP response was lost. Do not derive a
    # different fingerprint from later approvals for an existing idempotency key.
    key=batch_key(b,node);jid=digest([pid,key]);old=cloud().db.collection('animeShortsJobs').document(jid).get().to_dict()
    if old:return jsonify(jobId=jid,state=old['state'],nodes=nodes)
    job=cloud().submit(p,node['operation'],payload,key,expected(),d['session'])
    return jsonify(jobId=job['id'],state=job['state'],nodes=nodes),202

@app.post('/projects/<pid>/shots/<sid>/visual:propose')
def visual_propose(pid,sid):
    p=owned(pid);d=body();old=cloud().entity(pid,'developments',p['activeDevelopment'])
    from shorts.core.visual import validate_visual
    from shorts.core.revisions import impact
    candidate=copy.deepcopy(old['data']);shot=next((s for s in candidate['shots'] if s['id']==sid),None)
    require(shot,'SHOT','Toma inexistente')
    require(set(d)<={'treatment','camera','layers'},'VISUAL_FIELDS','Campos no admitidos')
    available=[x.to_dict() for x in cloud().project_ref(pid).collection('assets').stream()]
    shot.update(d);validate_visual(shot,{a['id']:a for a in available})
    report=impact(old['data'],candidate,available,old['id'])
    record={'id':new_id(),'revision':1,'created':time.time(),'approvalState':'candidate','data':candidate,'previousId':old['id'],'ideaId':old.get('ideaId'),'impact':report,'source':'manual_visual','editorialStage':old.get('editorialStage',4)}
    def save(tx,current):tx.create(cloud().entity_ref(pid,'developments',record['id']),record)
    cloud().mutate(pid,expected(),save)
    return jsonify(record),201

@app.post('/projects/<pid>/imports')
def import_asset(pid):
    p=owned(pid);d=body();source_project=cloud().project(d['sourceProjectId'],p['owner'])
    require(source_project['id']!=pid and p.get('activeDevelopment'),'IMPORT_PROJECT','Selecciona otra historia y aprueba el guion de destino')
    source=cloud().entity(source_project['id'],'assets',d['sourceAssetId'])
    require(source.get('approvalState')=='approved','IMPORT_APPROVAL','Recurso de origen sin aprobar')
    return submit(pid,'import',{'sourceProjectId':source_project['id'],'sourceAssetId':source['id'],'sourceHash':digest(source),'targetId':ident(d['targetId']),'developmentId':p['activeDevelopment']},pin=False)

@app.post('/projects/<pid>/sound-requests/<sid>/upload-session')
def upload(pid,sid):
    p=owned(pid);d=body();ident(sid);require(expected()==p['revision'],'REVISION_CONFLICT','Revisión cambió',409)
    dev=cloud().entity(pid,'developments',p['activeDevelopment'])['data']
    sound=next((r for r in dev['soundRequests'] if r['id']==sid),None)
    require(sound,'SOUND_REQUEST','Solicitud inexistente')
    require(d.get('mime') in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/x-aac','audio/m4a','audio/x-m4a','audio/flac','audio/ogg','audio/webm'),'MIME','Formato no admitido')
    require(type(d.get('size'))is int and 0<d['size']<=250*1024*1024,'SIZE','Máximo 250 MB',413)
    file_key=d.get('fileKey','');require(isinstance(file_key,str) and len(file_key)==64 and all(c in '0123456789abcdef' for c in file_key),'FILE_KEY','Falta huella del archivo')
    aid=digest([pid,sid,digest(sound),file_key]);ref=cloud().entity_ref(pid,'uploads',aid);existing=ref.get().to_dict()
    if existing:
        require(existing['size']==d['size'] and existing['mimeType']==d['mime'],'UPLOAD_CONFLICT','Archivo distinto',409)
        if d.get('renew'):
            blob=cloud().blob(pid,existing['object'])
            if blob.exists():return jsonify(assetId=aid,complete=True,resumed=True),200
            status=cloud().http.put(existing['uploadUrl'],headers={'Content-Range':f'bytes */{existing["size"]}','Content-Length':'0'},data=b'',timeout=15,allow_redirects=False)
            if status.status_code in (404,410):
                url=blob.create_resumable_upload_session(content_type=existing['mimeType'],size=existing['size'],origin=request.headers.get('X-Shorts-Origin'),if_generation_match=0)
                from google.cloud import firestore
                @firestore.transactional
                def renew(tx):
                    latest=ref.get(transaction=tx).to_dict()
                    if latest['uploadUrl']==existing['uploadUrl']:
                        latest.update(uploadUrl=url,revision=latest['revision']+1,renewed=time.time());tx.set(ref,latest)
                    return latest['uploadUrl']
                return jsonify(assetId=aid,uploadUrl=renew(cloud().db.transaction()),resumed=True,restarted=True),200
            require(status.status_code in (200,201,308),'UPLOAD_STATUS','No se confirmó el estado de la carga; no se abrió otra sesión',503)
        return jsonify(assetId=aid,uploadUrl=existing['uploadUrl'],resumed=True),200
    name=cloud().object_name(pid,aid,'original');blob=cloud().blob(pid,name)
    url=blob.create_resumable_upload_session(content_type=d['mime'],size=d['size'],origin=request.headers.get('X-Shorts-Origin'),if_generation_match=0)
    record={'id':aid,'requestId':sid,'developmentId':p['activeDevelopment'],'sha256':file_key,'object':name,'size':d['size'],'mimeType':d['mime'],'state':'uploading','revision':1,'uploadUrl':url,'created':time.time()}
    from google.api_core.exceptions import AlreadyExists
    try:cloud().put_entity(pid,'uploads',record)
    except AlreadyExists:
        winner=ref.get().to_dict();return jsonify(assetId=aid,uploadUrl=winner['uploadUrl'],resumed=True),200
    return jsonify(assetId=aid,uploadUrl=url),201
@app.post('/projects/<pid>/sound-requests/<sid>/complete')
def upload_complete(pid,sid):
    owned(pid);d=body();u=cloud().entity(pid,'uploads',d['assetId']);require(u['requestId']==sid,'REQUEST','Solicitud incorrecta')
    b=cloud().blob(pid,u['object']);b.reload();require(b.size==u['size'],'UPLOAD_INCOMPLETE','La carga no está completa')
    # Si el trabajo anterior con este mismo archivo falló o se canceló,
    # volver a subir el mismo archivo devolvía ese trabajo viejo y la
    # carga parecía bien pero el efecto nunca aparecía. En ese caso se
    # crea un trabajo nuevo; si el anterior sigue en curso o ya terminó
    # bien, se devuelve ese, como antes.
    base='upload-complete-'+u['id'];key=base
    old=cloud().db.collection('animeShortsJobs').document(digest([pid,base])).get().to_dict()
    if old and old.get('settled') and old.get('state') in ('failed','cancelled'):
        key=base+'-retry-'+str(int(time.time()))
    return submit(pid,'media',{'uploadId':u['id'],'requestId':sid,'developmentId':u['developmentId']},key_override=key,pin=False)

@app.get('/projects/<pid>/assets/<aid>/url')
def asset_url(pid,aid):
    owned(pid);a=cloud().entity(pid,'assets',aid);require(a.get('kind')!='veo_raw' and a.get('approvalState')!='quarantined','QUARANTINE','Recurso en cuarentena',403)
    return jsonify(url=cloud().url(pid,a['object']))
@app.get('/projects/<pid>/assets/<aid>/waveform')
def waveform(pid,aid):
    owned(pid);a=cloud().entity(pid,'assets',aid);require(a.get('waveform'),'WAVEFORM','Onda pendiente');return jsonify(a['waveform'])
@app.post('/projects/<pid>/shots/<shot>/frames')
def frames(pid,shot):return submit(pid,'frames',{'shotId':ident(shot),'start':body().get('start',0),'count':body().get('count',48)})

@app.route('/projects/<pid>/cues/<cid>',methods=['PATCH'])
def cue_edit(pid,cid):
    p=owned(pid);d=body();ref=cloud().entity_ref(pid,'cues',cid)
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict();require(cue,'CUE','Efecto inexistente')
        candidate=edit_cue(cue,d['patch'],d['cueRevision']);correction={'id':new_id(),'before':cue,'after':candidate,'author':p['owner'],'at':time.time()}
        tx.create(cloud().entity_ref(pid,'corrections',correction['id']),correction);tx.set(ref,candidate)
        current['timelineStale']=True
        return {'cue':candidate,'correctionId':correction['id']}
    result,_=cloud().mutate(pid,expected(),change);return jsonify(result)
@app.post('/projects/<pid>/cues/<cid>:approve')
def cue_approve(pid,cid):
    p=owned(pid);d=body();preview=cloud().entity(pid,'previews',d['previewId']);ref=cloud().entity_ref(pid,'cues',cid)
    from shorts.core.contracts import cue_render_data
    requests=cloud().entity(pid,'developments',p['activeDevelopment'])['data']['soundRequests']
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict()
        require(preview.get('state')=='ready' and preview.get('cueHashes',{}).get(cid)==digest(cue_render_data(cue)),'STALE_PREVIEW','Escucha una preview de este ajuste',409)
        sound=next((r for r in requests if r['id']==cue['requestId']),None);require(sound,'SOUND_REQUEST','Solicitud ya no vigente')
        require(cue['shotId']==sound['shotId'],'SOUND_SHOT_CHANGED','La solicitud cambió de toma. Vuelve a seleccionar el archivo para crear su nueva candidata.')
        cue.update(approvalState='approved',manualLock=cue.get('correctionSource')=='manual',approvedBy=p['owner'],approvedAt=time.time(),requestFingerprint=digest(sound))
        tx.set(ref,cue);current['timelineStale']=True
        current.setdefault('cueSelections',{})[cue['requestId']]=cid
        tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':'cue','entity':cid,'snapshot':cue,'author':p['owner'],'at':time.time()})
        return cue
    result,_=cloud().mutate(pid,expected(),change);return jsonify(result)
@app.post('/projects/<pid>/cues/<cid>:analyze')
@app.post('/projects/<pid>/cues/<cid>:correct')
def analyze(pid,cid):
    owned(pid);cue=cloud().entity(pid,'cues',cid);require(cue.get('analysisAttempts',0)<2,'ANALYSIS_LIMIT','Usa ajuste manual o autoriza una revisión nueva')
    d=body()
    if d.get('occurrenceIndex') is not None:
        from shorts.core.events import choose_contact
        choose_contact(cue.get('analysisScan',{}).get('options',[]),d['occurrenceIndex'])
    return submit(pid,'analyze',{'cueId':cid,'reason':d.get('reason','Localizar contacto'),'occurrenceIndex':d.get('occurrenceIndex')})
@app.post('/projects/<pid>/corrections/<correction>:undo')
def undo(pid,correction):
    owned(pid);c=cloud().entity(pid,'corrections',correction);ref=cloud().entity_ref(pid,'cues',c['before']['id'])
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict();require(cue['revision']==c['after']['revision'],'UNDO_CONFLICT','Existe una edición posterior',409)
        old={**c['before'],'revision':cue['revision']+1,'approvalState':'candidate'};tx.set(ref,old);current['timelineStale']=True;return old
    result,_=cloud().mutate(pid,expected(),change);return jsonify(result)

@app.post('/projects/<pid>/timeline:compile')
def timeline(pid):
    p=owned(pid)
    from shorts.service.timeline import assemble_plan
    overrides=body().get('cueOverrides',{})
    require(isinstance(overrides,dict) and len(overrides)<=100,'CUE_OVERRIDES','Selecciones inválidas')
    for sid,cid in overrides.items():require(cloud().entity(pid,'cues',cid)['requestId']==sid,'CUE_REQUEST','Efecto de otra solicitud')
    m=assemble_plan(cloud(),p,overrides);compiled=compile_timeline(m,False)
    entity={'id':new_id(),'data':m,'compiledHash':compiled['manifestHash'],'revision':1,'approvalState':'candidate','created':time.time()}
    def change(tx,current):tx.create(cloud().entity_ref(pid,'timelines',entity['id']),entity);current['candidateTimeline']=entity['id'];current['timelineStale']=False
    cloud().mutate(pid,expected(),change);return jsonify(entity)

@app.post('/projects/<pid>/mix-policy')
def mix_policy(pid):
    owned(pid);d=body()
    require(set(d)<={'normalize','duckMusic'} and all(type(v)is bool for v in d.values()),'MIX_POLICY','Selección de mezcla inválida')
    def change(tx,current):
        current['mixPolicy']={'normalization':{'enabled':d.get('normalize',False),'integratedLufs':-16,'truePeakDb':-1,'approved':True},'ducking':{'enabled':d.get('duckMusic',False),'approved':True,'threshold':.05,'ratio':4,'releaseMs':350}}
        current['timelineStale']=True
    _,p=cloud().mutate(pid,expected(),change);return jsonify(p)
def cached_render(pid,tid,start,end,final):
    from google.cloud.firestore_v1.base_query import FieldFilter
    plan=compile_timeline(cloud().entity(pid,'timelines',tid)['data'],final)
    key=digest([plan['manifestHash'],start,end,final,plan['compilerVersion']])
    docs=cloud().project_ref(pid).collection('previews').where(filter=FieldFilter('cacheKey','==',key)).limit(1).stream()
    found=next((x.to_dict() for x in docs),None)
    if found and found.get('state')=='ready' and found.get('jobId'):
        return jsonify(jobId=found['jobId'],previewId=found['id'],cached=True,state='awaiting_review'),200
    return None

@app.post('/projects/<pid>/previews')
def previews(pid):
    p=owned(pid);d=body();tid=d.get('timelineId') or p.get('candidateTimeline') or p.get('activeTimeline');require(tid,'TIMELINE','Compila el montaje primero')
    require(not p.get('timelineStale'),'TIMELINE_STALE','Recompila el ajuste actual')
    assert_current_timeline(p,tid)
    end=d.get('endFrame',cloud().entity(pid,'timelines',tid)['data']['frames'])
    cached=cached_render(pid,tid,d.get('startFrame',0),end,False)
    if cached:return cached
    return submit(pid,'preview',{'timelineId':tid,'startFrame':d.get('startFrame',0),'endFrame':end})
@app.post('/projects/<pid>/renders')
def renders(pid):
    p=owned(pid);require(p.get('activeTimeline') and not p.get('timelineStale'),'TIMELINE','Aprueba el montaje actual')
    assert_current_timeline(p,p['activeTimeline'])
    end=cloud().entity(pid,'timelines',p['activeTimeline'])['data']['frames']
    cached=cached_render(pid,p['activeTimeline'],0,end,True)
    if cached:return cached
    return submit(pid,'render',{'timelineId':p['activeTimeline'],'startFrame':0,'endFrame':end})

def assert_current_timeline(p,tid):
    from shorts.service.timeline import assemble_plan
    snapshot=cloud().entity(p['id'],'timelines',tid)['data']
    require(digest(assemble_plan(cloud(),p,snapshot.get('cueOverrides',{})))==digest(snapshot),'TIMELINE_STALE','Los recursos o ajustes cambiaron. Recompila sin perder la preview anterior.',409)
@app.get('/projects/<pid>/previews/<rid>')
def preview(pid,rid):
    p=owned(pid);r=cloud().entity(pid,'previews',rid)
    if r.get('state')=='ready':r['url']=cloud().url(pid,r['object'])
    try:
        assert_current_timeline(p,r['timelineId']);r['current']=True
        r['fullProgram']=r.get('startFrame')==0 and r.get('endFrame')==cloud().entity(pid,'timelines',r['timelineId'])['data']['frames']
    except ContractError:r['current']=False
    return jsonify(r)
@app.get('/projects/<pid>/exports/<rid>')
def exports(pid,rid):
    owned(pid);r=cloud().entity(pid,'previews',rid);require(r.get('final') and r['state']=='ready','EXPORT','Exportación pendiente')
    return jsonify(files=[{'name':n,'url':cloud().url(pid,path)} for n,path in r['files'].items()])

# Cloud Run request timeout of the service (infra/shorts/install.py --timeout=1800s), plus margin.
SERVICE_REQUEST_LIMIT=1800+60

def public_job(j):
    result={k:v for k,v in j.items() if k not in ('payload','session')}
    from shorts.core.jobs import service_startable
    result['canStartInService']=service_startable(j)
    if j.get('operation')=='develop' and j.get('settled') and j.get('state')=='failed' and j.get('result',{}).get('code')=='REFERENCE_LINK':
        result['recoveryIdeaId']=j.get('payload',{}).get('ideaId')
    return result

@app.get('/jobs/<jid>')
def job(jid):
    owner=uid();j=cloud().db.collection('animeShortsJobs').document(ident(jid)).get().to_dict();require(j and j['owner']==owner,'JOB','Trabajo no disponible',404)
    return jsonify(public_job(j))
def update_job_review(ref,expected_revision,fields):
    from google.cloud import firestore
    @firestore.transactional
    def change(tx):
        current=ref.get(transaction=tx).to_dict();revision(current,expected_revision)
        require(not current.get('settled'),'JOB_FINISHED','El trabajo ya terminó; actualiza su resultado',409)
        tx.update(ref,{**fields,'revision':current['revision']+1})
    change(cloud().db.transaction())

@app.post('/jobs/<jid>:<action>')
def job_action(jid,action):
    owner=uid();ref=cloud().db.collection('animeShortsJobs').document(ident(jid));j=ref.get().to_dict();require(j and j['owner']==owner,'JOB','Trabajo no disponible',404)
    if action=='inspect':
        revision(j,expected())
        if j.get('settled'):return jsonify(state=j['state'],message='Trabajo cerrado; no se repitió.')
        if j.get('executionMode')=='service':
            # A service job runs inside one request, which Cloud Run ends after
            # 30 minutes: past that, it is certainly not running any more.
            if j['state'] in ('running','cancel_requested') and time.time()-j.get('started',time.time())>SERVICE_REQUEST_LIMIT:
                if any(c['state']=='submitted_unknown' for c in j.get('providerCalls',[])):
                    update_job_review(ref,j['revision'],{'state':'submitted_unknown','errorCode':'SERVICE_STOPPED_UNKNOWN'})
                    cloud().release_slot(jid)
                    return jsonify(state='submitted_unknown',message='La generación se detuvo con un envío sin confirmar. Puedes cerrarla sin repetir.')
                cloud().finish(jid,'failed',{'code':'SERVICE_STOPPED','error':'La generación se detuvo sin publicar resultado. No se repitió ninguna llamada.'})
                return jsonify(state='failed',message='Trabajo cerrado sin repetir llamadas.')
            if j['state']=='submitted_unknown':
                return jsonify(state=j['state'],message='No se confirmó si Google procesó el envío. «Cerrar sin repetir» libera el motor y no vuelve a enviarlo.')
            return jsonify(state=j['state'],message='Estado de generación: '+j['state']+'. No se envió otra llamada.')
        path=j.get('workerExecution') or j.get('workerOperation')
        require(path and path.startswith('projects/') and '..' not in path and '://' not in path,'INSPECT_PENDING','No existe identificador de ejecución confirmado; consulta su estado antes de continuar.',409)
        response=cloud().http.get('https://run.googleapis.com/v2/'+path,timeout=30)
        require(response.ok,'INSPECT_PENDING','No se pudo consultar Cloud Run',503)
        result=response.json()
        if path==j.get('workerOperation') and result.get('done') and not result.get('error'):
            execution=result.get('response',{}).get('name')
            prefix=f'projects/{cloud().c["project"]}/locations/{cloud().c["region"]}/jobs/{cloud().c["job"]}/executions/'
            require(isinstance(execution,str) and execution.startswith(prefix) and '/' not in execution[len(prefix):],'INSPECT_PENDING','El arranque terminó pero aún no se confirmó el estado del worker; no se enviará otra tarea.',409)
            response=cloud().http.get('https://run.googleapis.com/v2/'+execution,timeout=30)
            require(response.ok,'INSPECT_PENDING','No se confirmó el estado de la ejecución',503)
            result=response.json()
        ended=bool(result.get('completionTime') or result.get('done'))
        if not ended:return jsonify(state=j['state'],message='La ejecución sigue activa; no se envió otra generación.')
        if j.get('providerOperation') and j['operation'] in ('veo','transcribe'):
            state='waiting_provider';update_job_review(ref,j['revision'],{'state':state,'errorCode':'VEO_PENDING' if j['operation']=='veo' else 'SPEECH_PENDING'})
            return jsonify(state=state,message='Operación conocida recuperable. Continuar consultará el mismo identificador.')
        if any(c['state']=='submitted_unknown' for c in j.get('providerCalls',[])):
            update_job_review(ref,j['revision'],{'state':'submitted_unknown','errorCode':'WORKER_STOPPED_UNKNOWN'})
            cloud().release_slot(jid)
            return jsonify(state='submitted_unknown',message='Worker detenido con envío incierto. No se repetirá automáticamente; puedes cerrarlo sin repetir.')
        cloud().finish(jid,'failed',{'code':'WORKER_STOPPED','error':'El worker terminó sin publicar resultado. Se conservan los recursos ya guardados.'})
        return jsonify(state='failed',message='Trabajo cerrado sin repetir llamadas. Revisa los recursos conservados.')
    if action=='close':
        # Explicit owner decision for an uncertain job: settle it without any
        # new provider call and free its engine (shorts.core.jobs.close_uncertain).
        revision(j,expected())
        cloud().close_uncertain(jid)
        return jsonify(state='failed',message='Cerrado sin repetir. El motor queda libre; puedes pedirlo otra vez cuando quieras.')
    require(action in ('pause','cancel','resume','start'),'ACTION','Acción inválida')
    from google.cloud import firestore
    @firestore.transactional
    def apply(tx):
        v=ref.get(transaction=tx).to_dict();revision(v,expected())
        if action=='start':
            from shorts.core.jobs import service_startable
            require(service_startable(v),'JOB_STARTED','El trabajo ya comenzó o necesita comprobar su estado.',409)
            # Both the old worker and service must claim this SAME job in a
            # transaction. Whichever claims second cannot submit a provider call.
            v.update(session=ident(body()['session']),dispatchState=None,dispatchError=None,queueError=None,dispatchAttempt=v.get('dispatchAttempt',0)+1)
        elif action=='resume':
            require((v['state']=='queued' and not v.get('started') and not v.get('settled') and not v.get('dispatchState')) or (v['state']=='waiting_provider' and v.get('providerOperation') and v.get('errorCode') in ('VEO_PENDING','SPEECH_PENDING')),'UNKNOWN','Un envío incierto no se reenvía. Solo se recuperan operaciones conocidas o pendientes sin despachar.',409)
            require(not v.get('dispatchUnknown'),'DISPATCH_UNKNOWN','El arranque no se confirmó. Diagnostica antes de reenviar.',409)
            if v.get('started'):
                from shorts.core.recovery import resume_known
                v=resume_known(v)
            v.update(state='queued',session=body()['session'],dispatchState=None,dispatchError=None,queueError=None,dispatchAttempt=v.get('dispatchAttempt',0)+1)
        else:
            require(not v.get('settled') and v['state'] in ('queued','running','waiting_provider','cancel_requested'),'JOB_FINISHED','Este trabajo no admite cancelación',409)
            v['state']='cancelled' if v['state']=='queued' else 'cancel_requested'
        v['revision']+=1;tx.set(ref,v);return v
    j=apply(cloud().db.transaction())
    if action in ('resume','start'):cloud().enqueue(j)
    elif j['state']=='cancelled':cloud().finish(jid,'cancelled',{'reason':'Cancelado antes de despachar'})
    return jsonify(state=j['state'],message='Los trabajos ya iniciados pueden terminar; no se iniciarán otros con esta cancelación.')

def internal_identity():
    c=config();token=request.headers.get('Authorization','').removeprefix('Bearer ')
    try:claims=id_token.verify_oauth2_token(token,Request(),c['service'])
    except Exception:raise ContractError('INTERNAL_AUTH','Identidad interna inválida',403)
    require(claims.get('email')==c['serviceAccount'] and claims.get('email_verified'),'INTERNAL_AUTH','Identidad no autorizada',403)
    return c

@app.post('/internal/diagnostic')
def diagnostic_callback():
    c=internal_identity();key=ident(body()['key']);ref=cloud().db.collection('animeShortsDiagnostics').document(key)
    require(key.startswith('diagnostic_') and ref.get().exists,'DIAGNOSTIC','Prueba no registrada',404)
    from google.cloud import firestore
    @firestore.transactional
    def claim_probe(tx):
        current=ref.get(transaction=tx).to_dict()
        require(current,'DIAGNOSTIC','Prueba terminada',404)
        if current.get('probeSubmitted'):return False
        tx.update(ref,{'queueDelivered':True,'probeSubmitted':True});return True
    if not claim_probe(cloud().db.transaction()):return jsonify(delivered=True)
    # Exercise the SAME jobs:run permission and environment override as real
    # work, but the child only acknowledges this temporary diagnostic record.
    try:
        response=start_worker(c,[{'name':'SHORTS_DISPATCH_PROBE','value':key}])
        if not response.ok:
            ref.update({'probeError':'Cloud Run rechazó la prueba de arranque ('+str(response.status_code)+')'})
        elif not response.json().get('name'):
            ref.update({'probeError':'No se confirmó la operación de arranque de prueba'})
    except Exception:
        ref.update({'probeError':'No se confirmó el arranque de prueba; no se reenvió'})
    return jsonify(delivered=True)

def start_worker(c,environment):
    return cloud().http.post(f'https://run.googleapis.com/v2/projects/{c["project"]}/locations/{c["region"]}/jobs/{c["job"]}:run',json={'overrides':{'containerOverrides':[{'env':environment}]}},timeout=30)

@app.post('/internal/dispatch')
def dispatch():
    c=internal_identity()
    jid=ident(body()['jobId']);j,should_dispatch=cloud().acquire_dispatch(jid)
    if not should_dispatch:return jsonify(dispatched=False)
    ref=cloud().db.collection('animeShortsJobs').document(jid)
    if j['operation'] in ('ideas','develop','revise','image','tts','music'):
        from shorts.service.execution import execute_job
        execute_job(cloud(),jid)
        return jsonify(dispatched=True)
    try:r=start_worker(c,[{'name':'SHORTS_JOB_ID','value':jid}])
    except Exception:
        ref.update({'dispatchUnknown':True});return jsonify(dispatched=False,unknown=True),202
    if not r.ok:
        if r.status_code<500:
            # Explicit rejection is known to precede worker execution.
            cloud().finish(jid,'cancelled',{'code':'DISPATCH_REJECTED','error':'Cloud Run rechazó el arranque'})
        else:ref.update({'dispatchUnknown':True})
        raise ContractError('DISPATCH','No se confirmó el arranque; consulta el trabajo antes de continuar',503)
    try:result=r.json()
    except ValueError:result={}
    if not result.get('name'):
        ref.update({'dispatchUnknown':True,'dispatchError':{'code':'DISPATCH_UNKNOWN','message':'Google no confirmó el identificador del arranque. No se enviará otra ejecución.'}})
        return jsonify(dispatched=False,unknown=True),202
    ref.update({'workerOperation':result['name']})
    return jsonify(dispatched=True)

@app.get('/projects/<pid>/frames/<fid>')
def indexed_frames(pid,fid):
    owned(pid);record=cloud().entity(pid,'references',fid);require(record.get('kind')=='indexed_frames','FRAMES','Recurso inválido')
    return jsonify(assetRevision=record['assetRevision'],frames=[{**f,'url':cloud().url(pid,f['object'])} for f in record['frames']])

@app.post('/projects/<pid>/cues/<cid>/anchor')
def manual_anchor(pid,cid):
    p=owned(pid);d=body();frames=cloud().entity(pid,'references',d['framesId']);frame=next((f for f in frames['frames'] if f['index']==d['frameIndex']),None)
    require(frame,'FRAME','Fotograma no indexado')
    ref=cloud().entity_ref(pid,'cues',cid)
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict();revision(cue,d['cueRevision'])
        require(cue['shotId']==frames['shotId'],'FRAME_SHOT','Fotograma de otra toma')
        eid=new_id();event={'id':eid,'revision':1,'shotId':cue['shotId'],'videoRevision':frames['assetRevision'],'pts':frame['index'],'timebase':24,'visible':True,'source':'manual','approvalState':'candidate','evidence':frame['object'],'visualFingerprint':frames.get('visualFingerprint'),'coordinateSpace':frames.get('coordinateSpace','source')}
        changed=edit_cue(cue,{'eventId':eid},cue['revision']);tx.create(cloud().entity_ref(pid,'events',eid),event);tx.set(ref,changed);current['timelineStale']=True
        return changed
    cue,_=cloud().mutate(pid,expected(),change);return jsonify(cue)

@app.post('/projects/<pid>/cues/<cid>/proposal:apply')
def apply_proposal(pid,cid):
    owned(pid);ref=cloud().entity_ref(pid,'cues',cid)
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict();require(cue.get('proposedEventId'),'PROPOSAL','Sin propuesta')
        require(not cue.get('manualLock'),'MANUAL_LOCK','Desbloquea explícitamente antes de sustituir una corrección fijada',409)
        cue=edit_cue(cue,{'eventId':cue['proposedEventId']},cue['revision'],'analysis');tx.set(ref,cue);current['timelineStale']=True;return cue
    cue,_=cloud().mutate(pid,expected(),change);return jsonify(cue)

@app.get('/projects/<pid>/subtitles')
def subtitle_editor(pid):
    p=owned(pid)
    from shorts.service.timeline import approved_assets
    from shorts.core.dependencies import select_assets
    from shorts.core.subtitles import subtitle_segments,validate_segments
    dev=cloud().entity(pid,'developments',p['activeDevelopment']);d=dev['data']
    by=select_assets(approved_assets(cloud(),pid),d,dev['id'],p.get('assetSelections'));rows=[]
    for u in d['utterances']:
        audio=by.get((u['id'],'pcm'))
        if not audio:continue
        text=next(x['text'] for x in d['subtitles'] if x['utteranceId']==u['id'])
        segments,stale=subtitle_segments(u,audio,text,p.get('subtitleEdits',{}))
        rows.append({'utteranceId':u['id'],'shotId':u['shotId'],'japanese':u['japanese'],'audioRevision':audio['id'],'audioHash':audio['sha256'],'samples':audio['samples'],'segments':segments,'stale':stale,'warnings':validate_segments(segments,audio['samples'])})
    return jsonify(rows=rows)

@app.post('/projects/<pid>/subtitles/<utterance>')
def subtitle_save(pid,utterance):
    p=owned(pid);d=body()
    from shorts.core.subtitles import validate_segments
    from shorts.core.dependencies import select_assets
    from shorts.service.timeline import approved_assets
    dev=cloud().entity(pid,'developments',p['activeDevelopment'])
    by=select_assets(approved_assets(cloud(),pid),dev['data'],dev['id'],p.get('assetSelections'));a=by.get((utterance,'pcm'))
    require(a and d.get('audioRevision')==a['id'] and d.get('audioHash')==a['sha256'],'SUBTITLE_AUDIO','Cambió la voz; revisa sus tiempos antes de guardar',409)
    warnings=validate_segments(d.get('segments'),a['samples'])
    record={'utteranceId':utterance,'audioRevision':a['id'],'audioHash':a['sha256'],'segments':d['segments'],'source':'manual','author':p['owner'],'at':time.time()}
    def change(tx,current):
        before=current.get('subtitleEdits',{}).get(utterance)
        tx.create(cloud().entity_ref(pid,'corrections',new_id()),{'kind':'subtitle','before':before,'after':record,'created':time.time()})
        current.setdefault('subtitleEdits',{})[utterance]=record
        current.pop('subtitleApproval',None);current['timelineStale']=True
    _,p=cloud().mutate(pid,expected(),change)
    return jsonify(record=record,warnings=warnings)

@app.get('/projects/<pid>/alignments/<aid>')
def alignment(pid,aid):
    owned(pid);record=cloud().entity(pid,'references',aid)
    require(record.get('kind')=='speech_alignment','ALIGNMENT','Referencia incorrecta')
    return jsonify(record)

@app.post('/projects/<pid>/sound-requests/<sid>/omit')
def omit_sound(pid,sid):
    p=owned(pid);d=body();dev=cloud().entity(pid,'developments',p['activeDevelopment'])
    require(any(r['id']==sid for r in dev['data']['soundRequests']),'SOUND_REQUEST','Solicitud inexistente')
    # Omitir es una decisión del usuario sobre su propio corto: no se le
    # exige justificarla. Si no escribe motivo, queda registrado como tal.
    reason=d.get('reason') or 'Omitido por el usuario'
    require(isinstance(reason,str) and len(reason)<=2000,'REASON','Motivo demasiado largo')
    record={'requestId':sid,'developmentId':dev['id'],'reason':reason,'approvedBy':p['owner'],'approvedAt':time.time()}
    def change(tx,current):
        current.setdefault('soundOmissions',{})[sid]=record;current['timelineStale']=True
        tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':'sound_omission',**record})
    _,p=cloud().mutate(pid,expected(),change)
    return jsonify(record)

@app.post('/projects/<pid>/sound-requests/<sid>/unomit')
def unomit_sound(pid,sid):
    p=owned(pid)
    def change(tx,current):
        (current.get('soundOmissions') or {}).pop(sid,None);current['timelineStale']=True
    _,p=cloud().mutate(pid,expected(),change)
    return jsonify(removed=True)

@app.post('/projects/<pid>/sound-effects:use-latest')
def use_latest_sound_effects(pid):
    # Regla del usuario: el último efecto subido es el que se usa, sin
    # botón de aprobar. Esto pone en uso, de una vez, los efectos viejos
    # que quedaron como "Por revisar" o "Aprobado pero sin usar" antes de
    # la aprobación automática, para que en Sonido no quede ningún botón
    # de aprobar/usar. No genera nada, no sube nada y no toca imágenes,
    # videos, voces ni música.
    p=owned(pid);dev=cloud().entity(pid,'developments',p['activeDevelopment'])
    assets=[x.to_dict() for x in cloud().project_ref(pid).collection('assets').stream()]
    changed=[]
    for req in dev['data']['soundRequests']:
        rows=sorted([a for a in assets if a.get('requestId')==req['id'] and a.get('kind')=='pcm' and a.get('approvalState') in ('candidate','approved')],key=lambda a:(a.get('created',0),a['id']))
        if not rows:continue
        newest=rows[-1];key=req['id']+'|pcm'
        if newest['approvalState']=='approved' and p.get('assetSelections',{}).get(key)==newest['id']:continue
        changed.append({'requestId':req['id'],'assetId':newest['id'],'was':newest['approvalState']})
    if not changed:return jsonify(changed=False,effects=[])
    def change(tx,current):
        for item in changed:
            ref=cloud().entity_ref(pid,'assets',item['assetId']);row=ref.get(transaction=tx).to_dict()
            if row and row.get('approvalState')=='candidate':
                row.update(approvalState='approved',approvedBy=current['owner'],approvedAt=time.time(),humanReview={'reviewed':True,'at':time.time(),'by':current['owner']});tx.set(ref,row)
            current.setdefault('assetSelections',{})[item['requestId']+'|pcm']=item['assetId']
        current['timelineStale']=True
    _,p=cloud().mutate(pid,expected(),change)
    return jsonify(changed=True,effects=changed)

@app.post('/projects/<pid>/subtitles:approve')
def subtitles_approve(pid):
    p=owned(pid);ref=cloud().entity_ref(pid,'developments',p['activeDevelopment']);d=body()
    # Approved development stays immutable; subtitle approval is a separate entity.
    dev=ref.get().to_dict();require(d.get('developmentId')==dev['id'],'SUBTITLE_REVISION','Guion cambió',409)
    def change(tx,current):
        current['subtitleApproval']={'developmentId':dev['id'],'audioHashes':d['audioHashes'],'author':p['owner'],'at':time.time()};current['timelineStale']=True
    _,p=cloud().mutate(pid,expected(),change);return jsonify(p)

@app.get('/projects/<pid>/jobs')
def project_jobs(pid):
    owned(pid)
    from google.cloud.firestore_v1.base_query import FieldFilter
    jobs=cloud().db.collection('animeShortsJobs').where(filter=FieldFilter('projectId','==',pid)).stream()
    return jsonify(jobs=[public_job(x.to_dict()) for x in jobs])
