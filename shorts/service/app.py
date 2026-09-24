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

@app.route('/projects/<pid>',methods=['GET','PATCH'])
def project_route(pid):
    p=owned(pid)
    if request.method=='GET':
        result={**p,'entityCursors':{}}
        for k in ('ideas','developments','assets','cues','events','timelines','previews'):
            page=entity_page(pid,k);result[k]=page['items']
            if page['next']:result['entityCursors'][k]=page['next']
        return jsonify(result)
    d=body();require(set(d)<={'title','archived'},'FIELDS','Edita el contenido como una nueva revisión')
    def patch(tx,current):current.update(d)
    _,p=cloud().mutate(pid,expected(),patch);return jsonify(p)

def entity_page(pid,kind,cursor=None):
    require(kind in ('ideas','developments','assets','cues','events','timelines','previews'),'ENTITY','Lista inválida')
    query=cloud().project_ref(pid).collection(kind).order_by('__name__').limit(51)
    if cursor:
        snapshot=cloud().entity_ref(pid,kind,ident(cursor)).get();require(snapshot.exists,'CURSOR','Página inexistente');query=query.start_after(snapshot)
    docs=list(query.stream());items=[x.to_dict() for x in docs[:50]]
    for row in items:
        if kind=='developments':row['dataHash']=digest(row['data'])
        if kind=='assets':row.pop('waveform',None) # retrieved on demand by its dedicated route
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
        p['lease']={'device':device,'session':session,'expires':time.time()+(30 if d.get('active',True) else 0)}
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
    p=owned(pid);require(p.get('selectedIdea'),'IDEA','Elige una idea');return submit(pid,'develop',{'ideaId':p['selectedIdea']['id']})
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
    record={'id':new_id(),'revision':1,'approvalState':'candidate','data':candidate,'previousId':eid,
            'created':time.time(),'source':'manual','impact':report,'ideaId':old.get('ideaId')}
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
        if kind=='assets':
            require(body().get('reviewed') is True,'ASSET_REVIEW','Abre el recurso y aprueba su contenido')
            require(entity['kind'] in ('image','veo_silent_validated','pcm'),'ASSET_REVIEW','Tipo de recurso no aprobable')
            entity['humanReview']={'reviewed':True,'at':time.time(),'by':p['owner']}
        if kind=='timelines':
            compile_timeline(entity['data'],True)
            require(not current.get('timelineStale') and current.get('candidateTimeline')==eid,'TIMELINE_STALE','Compila el montaje actual antes de aprobar',409)
        entity.update(approvalState='approved',approvedBy=p['owner'],approvedAt=time.time())
        tx.set(ref,entity);tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'entity':eid,'kind':kind,'hash':digest(entity),'author':p['owner'],'at':time.time()})
        if kind=='developments':current['activeDevelopment']=eid;current['stage']='tomas';current['timelineStale']=True
        if kind=='assets':
            current['timelineStale']=True
            current.setdefault('assetSelections',{})[entity['entityId']+'|'+entity['kind']]=eid
        if kind=='timelines':current['activeTimeline']=eid
        return entity
    entity,_=cloud().mutate(pid,expected(),change);return jsonify(entity)

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
    return submit(pid,d['operation'],{k:d[k] for k in ('entityId','assetId','referenceIds','seconds','variantPrompt') if k in d})

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
    if node['operation']=='veo':payload['seconds']=8
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
    record={'id':new_id(),'revision':1,'created':time.time(),'approvalState':'candidate','data':candidate,'previousId':old['id'],'ideaId':old.get('ideaId'),'impact':report,'source':'manual_visual'}
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
    require(d.get('mime') in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/flac','audio/ogg'),'MIME','Formato no admitido')
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
    return submit(pid,'media',{'uploadId':u['id'],'requestId':sid,'developmentId':u['developmentId']},key_override='upload-complete-'+u['id'],pin=False)

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
    cached=cached_render(pid,tid,d.get('startFrame',0),d.get('endFrame',7200),False)
    if cached:return cached
    return submit(pid,'preview',{'timelineId':tid,'startFrame':d.get('startFrame',0),'endFrame':d.get('endFrame',7200)})
@app.post('/projects/<pid>/renders')
def renders(pid):
    p=owned(pid);require(p.get('activeTimeline') and not p.get('timelineStale'),'TIMELINE','Aprueba el montaje actual')
    assert_current_timeline(p,p['activeTimeline'])
    cached=cached_render(pid,p['activeTimeline'],0,7200,True)
    if cached:return cached
    return submit(pid,'render',{'timelineId':p['activeTimeline'],'startFrame':0,'endFrame':7200})

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
    except ContractError:r['current']=False
    return jsonify(r)
@app.get('/projects/<pid>/exports/<rid>')
def exports(pid,rid):
    owned(pid);r=cloud().entity(pid,'previews',rid);require(r.get('final') and r['state']=='ready','EXPORT','Exportación pendiente')
    return jsonify(files=[{'name':n,'url':cloud().url(pid,path)} for n,path in r['files'].items()])

@app.get('/jobs/<jid>')
def job(jid):
    owner=uid();j=cloud().db.collection('animeShortsJobs').document(ident(jid)).get().to_dict();require(j and j['owner']==owner,'JOB','Trabajo no disponible',404)
    return jsonify({k:v for k,v in j.items() if k not in ('payload','session')})
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
            return jsonify(state='submitted_unknown',message='Worker detenido con envío incierto. No se repetirá automáticamente.')
        cloud().finish(jid,'failed',{'code':'WORKER_STOPPED','error':'El worker terminó sin publicar resultado. Se conservan los recursos ya guardados.'})
        return jsonify(state='failed',message='Trabajo cerrado sin repetir llamadas. Revisa los recursos conservados.')
    require(action in ('pause','cancel','resume'),'ACTION','Acción inválida')
    from google.cloud import firestore
    @firestore.transactional
    def apply(tx):
        v=ref.get(transaction=tx).to_dict();revision(v,expected())
        if action=='resume':
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
    if action=='resume':cloud().enqueue(j)
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
    if j['operation'] in ('ideas','develop','revise'):
        from shorts.service.execution import execute_text
        execute_text(cloud(),jid)
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
    reason=d.get('reason','');require(isinstance(reason,str) and 3<=len(reason)<=2000,'REASON','Describe la decisión editorial')
    record={'requestId':sid,'developmentId':dev['id'],'reason':reason,'approvedBy':p['owner'],'approvedAt':time.time()}
    def change(tx,current):
        current.setdefault('soundOmissions',{})[sid]=record;current['timelineStale']=True
        tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':'sound_omission',**record})
    _,p=cloud().mutate(pid,expected(),change)
    return jsonify(record)

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
    return jsonify(jobs=[{k:v for k,v in x.to_dict().items() if k not in ('payload','session')} for x in jobs])
