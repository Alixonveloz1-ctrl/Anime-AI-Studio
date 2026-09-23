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
from shorts.core.pricing import catalog
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
def body():return request.get_json(silent=False) or {}
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
    job=cloud().submit(p,operation,payload,key_override or request.headers.get('Idempotency-Key',''),expected(),d.get('budgetId',''),d.get('session',''))
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
        result={**p}
        for k in ('ideas','developments','assets','cues','events','timelines','previews'):
            result[k]=[x.to_dict() for x in cloud().project_ref(pid).collection(k).limit(300).stream()]
            if k=='developments':
                for item in result[k]:item['dataHash']=digest(item['data'])
        return jsonify(result)
    d=body();require(set(d)<={'title','archived'},'FIELDS','Edita el contenido como una nueva revisión')
    def patch(tx,current):current.update(d)
    _,p=cloud().mutate(pid,expected(),patch);return jsonify(p)

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

@app.post('/projects/<pid>/budgets')
def budget(pid):
    p=owned(pid);d=body();require(expected()==p['revision'],'REVISION_CONFLICT','Revisión cambió',409)
    from shorts.core.contracts import integer
    amount=integer(d.get('limitMicros'),'presupuesto',1,10**10)
    allowed={'ideas','develop','revise','image','veo','tts','music','analyze','review','transcribe','media','preview','render','frames'}
    require(isinstance(d.get('operations'),list) and set(d['operations'])<=allowed,'OPERATIONS','Operaciones inválidas')
    b={'id':new_id(),'projectId':pid,'owner':p['owner'],'limit':amount,'spent':0,'reserved':0,'operations':d['operations'],'expires':time.time()+86400,'created':time.time()}
    cloud().db.collection('animeShortsBudgetAuthorizations').document(b['id']).create(b);return jsonify(b),201

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
    return submit(pid,'revise',{'kind':kind,'entityId':eid,'instruction':d['instruction']})
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
        if entity.get('approvalState')=='approved':return entity
        if kind=='assets':
            checks=body().get('checks',{})
            needed={'image':{'visualContinuity'},'veo_silent_validated':{'visualContinuity','mouthCoverage'},'pcm':{'contentHeard','contentMatchesRequest'}}.get(entity['kind'],set())
            require(needed and all(checks.get(k) is True for k in needed),'ASSET_REVIEW','Revisa el contenido y marca las comprobaciones antes de aprobar')
            entity['humanReview']={'checks':checks,'at':time.time(),'by':p['owner']}
        if kind=='timelines':
            compile_timeline(entity['data'],True)
            require(not current.get('timelineStale') and current.get('candidateTimeline')==eid,'TIMELINE_STALE','Compila el montaje actual antes de aprobar',409)
        entity.update(approvalState='approved',approvedBy=p['owner'],approvedAt=time.time())
        tx.set(ref,entity);tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'entity':eid,'kind':kind,'hash':digest(entity),'author':p['owner'],'at':time.time()})
        if kind=='developments':current['activeDevelopment']=eid;current['stage']='tomas';current['timelineStale']=True
        if kind=='assets':current['timelineStale']=True
        if kind=='timelines':current['activeTimeline']=eid
        return entity
    entity,_=cloud().mutate(pid,expected(),change);return jsonify(entity)

@app.post('/projects/<pid>/assets:generate')
def generate(pid):
    p=owned(pid);d=body();require(d.get('operation') in ('image','veo','tts','music','transcribe','review'),'OPERATION','Motor inválido')
    require(p.get('activeDevelopment'),'DEVELOPMENT','Aprueba guion y biblias primero')
    return submit(pid,d['operation'],{k:d[k] for k in ('entityId','assetId','referenceIds','seconds') if k in d})

@app.post('/projects/<pid>/sound-requests/<sid>/upload-session')
def upload(pid,sid):
    p=owned(pid);d=body();ident(sid);require(expected()==p['revision'],'REVISION_CONFLICT','Revisión cambió',409)
    dev=cloud().entity(pid,'developments',p['activeDevelopment'])['data']
    require(any(r['id']==sid for r in dev['soundRequests']),'SOUND_REQUEST','Solicitud inexistente')
    require(d.get('mime') in ('audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/flac','audio/ogg'),'MIME','Formato no admitido')
    require(type(d.get('size'))is int and 0<d['size']<=250*1024*1024,'SIZE','Máximo 250 MB',413)
    file_key=d.get('fileKey','');require(isinstance(file_key,str) and len(file_key)==64 and all(c in '0123456789abcdef' for c in file_key),'FILE_KEY','Falta huella del archivo')
    aid=digest([pid,sid,file_key]);ref=cloud().entity_ref(pid,'uploads',aid);existing=ref.get().to_dict()
    if existing:
        require(existing['size']==d['size'] and existing['mimeType']==d['mime'],'UPLOAD_CONFLICT','Archivo distinto',409)
        return jsonify(assetId=aid,uploadUrl=existing['uploadUrl'],resumed=True),200
    name=cloud().object_name(pid,aid,'original');blob=cloud().blob(pid,name)
    url=blob.create_resumable_upload_session(content_type=d['mime'],size=d['size'],origin=request.headers.get('X-Shorts-Origin'),if_generation_match=0)
    record={'id':aid,'requestId':sid,'developmentId':p['activeDevelopment'],'sha256':file_key,'object':name,'size':d['size'],'mimeType':d['mime'],'state':'uploading','revision':1,'uploadUrl':url,'created':time.time()}
    cloud().put_entity(pid,'uploads',record)
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
    def change(tx,current):
        cue=ref.get(transaction=tx).to_dict()
        require(preview.get('state')=='ready' and preview.get('cueHashes',{}).get(cid)==digest(cue),'STALE_PREVIEW','Escucha una preview de este ajuste',409)
        cue.update(approvalState='approved',manualLock=cue.get('correctionSource')=='manual',approvedBy=p['owner'],approvedAt=time.time())
        tx.set(ref,cue);current['timelineStale']=True
        current.setdefault('cueSelections',{})[cue['requestId']]=cid
        tx.create(cloud().entity_ref(pid,'approvals',new_id()),{'kind':'cue','entity':cid,'snapshot':cue,'author':p['owner'],'at':time.time()})
        return cue
    result,_=cloud().mutate(pid,expected(),change);return jsonify(result)
@app.post('/projects/<pid>/cues/<cid>:analyze')
@app.post('/projects/<pid>/cues/<cid>:correct')
def analyze(pid,cid):
    owned(pid);cue=cloud().entity(pid,'cues',cid);require(cue.get('analysisAttempts',0)<2,'ANALYSIS_LIMIT','Usa ajuste manual o autoriza una revisión nueva')
    return submit(pid,'analyze',{'cueId':cid,'reason':body().get('reason','Localizar contacto')})
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
        if j.get('settled'):return jsonify(state=j['state'],message='Trabajo conciliado; no se repitió.')
        path=j.get('workerExecution') or j.get('workerOperation')
        require(path and path.startswith('projects/') and '..' not in path and '://' not in path,'INSPECT_PENDING','No existe identificador de ejecución confirmado; conserva la reserva y consulta diagnóstico.',409)
        response=cloud().http.get('https://run.googleapis.com/v2/'+path,timeout=30)
        require(response.ok,'INSPECT_PENDING','No se pudo consultar Cloud Run',503)
        result=response.json()
        ended=bool(result.get('completionTime') or result.get('done'))
        if not ended:return jsonify(state=j['state'],message='La ejecución sigue activa; no se envió otra generación.')
        if j.get('providerOperation') and j['operation'] in ('veo','transcribe'):
            state='waiting_provider';update_job_review(ref,j['revision'],{'state':state,'errorCode':'VEO_PENDING' if j['operation']=='veo' else 'SPEECH_PENDING'})
            return jsonify(state=state,message='Operación conocida recuperable. Continuar consultará el mismo identificador.')
        if any(c['state']=='submitted_unknown' for c in j.get('providerCalls',[])):
            update_job_review(ref,j['revision'],{'state':'submitted_unknown','errorCode':'WORKER_STOPPED_UNKNOWN'})
            return jsonify(state='submitted_unknown',message='Worker detenido con envío incierto. Reserva conservada; no se repetirá automáticamente.')
        cloud().finish(jid,'failed',{'code':'WORKER_STOPPED','error':'El worker terminó sin publicar resultado. Recursos ya guardados y gasto estimado conservados.'})
        return jsonify(state='failed',message='Trabajo conciliado sin repetir llamadas. Revisa los recursos conservados.')
    require(action in ('pause','cancel','resume'),'ACTION','Acción inválida')
    from google.cloud import firestore
    @firestore.transactional
    def apply(tx):
        v=ref.get(transaction=tx).to_dict();revision(v,expected())
        if action=='resume':
            require((v['state']=='queued' and not v.get('started') and not v.get('settled') and not v.get('dispatchState')) or (v['state']=='waiting_provider' and v.get('providerOperation') and v.get('errorCode') in ('VEO_PENDING','SPEECH_PENDING')),'UNKNOWN','Un envío incierto no se reenvía. Solo se recuperan operaciones conocidas o pendientes sin despachar.',409)
            require(not v.get('dispatchUnknown'),'DISPATCH_UNKNOWN','El arranque no se confirmó. Diagnostica antes de reenviar.',409)
            v.update(state='queued',session=body()['session'],dispatchState=None,dispatchAttempt=v.get('dispatchAttempt',0)+1)
        else:
            require(not v.get('settled') and v['state'] in ('queued','running','waiting_provider','cancel_requested'),'JOB_FINISHED','Este trabajo no admite cancelación',409)
            v['state']='cancelled' if v['state']=='queued' else 'cancel_requested'
        v['revision']+=1;tx.set(ref,v);return v
    j=apply(cloud().db.transaction())
    if action=='resume':cloud().enqueue(j)
    elif j['state']=='cancelled':cloud().finish(jid,'cancelled',{'reason':'Cancelado antes de despachar'})
    return jsonify(state=j['state'],message='Las operaciones aceptadas por Google pueden terminar y facturarse.')

@app.post('/internal/dispatch')
def dispatch():
    c=config();token=request.headers.get('Authorization','').removeprefix('Bearer ')
    try:claims=id_token.verify_oauth2_token(token,Request(),c['service'])
    except Exception:raise ContractError('INTERNAL_AUTH','Identidad interna inválida',403)
    require(claims.get('email')==c['serviceAccount'] and claims.get('email_verified'),'INTERNAL_AUTH','Identidad no autorizada',403)
    jid=ident(body()['jobId']);j,should_dispatch=cloud().acquire_dispatch(jid)
    if not should_dispatch:return jsonify(dispatched=False)
    ref=cloud().db.collection('animeShortsJobs').document(jid)
    try:r=cloud().http.post(f'https://run.googleapis.com/v2/projects/{c["project"]}/locations/{c["region"]}/jobs/{c["job"]}:run',json={'overrides':{'containerOverrides':[{'env':[{'name':'SHORTS_JOB_ID','value':jid}]}]}},timeout=30)
    except Exception:
        ref.update({'dispatchUnknown':True});return jsonify(dispatched=False,unknown=True),202
    if not r.ok:
        if r.status_code<500:
            # Explicit rejection is known to precede worker execution.
            cloud().finish(jid,'cancelled',{'code':'DISPATCH_REJECTED','error':'Cloud Run rechazó el arranque'})
        else:ref.update({'dispatchUnknown':True})
        raise ContractError('DISPATCH','No se confirmó el arranque; consulta el trabajo antes de continuar',503)
    result=r.json();require(result.get('name'),'DISPATCH','No se recibió operación de Cloud Run',503)
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
    by=select_assets(approved_assets(cloud(),pid),d,dev['id']);rows=[]
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
    by=select_assets(approved_assets(cloud(),pid),dev['data'],dev['id']);a=by.get((utterance,'pcm'))
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

@app.get('/projects/<pid>/budgets')
def budgets_get(pid):
    p=owned(pid)
    from google.cloud.firestore_v1.base_query import FieldFilter
    docs=cloud().db.collection('animeShortsBudgetAuthorizations').where(filter=FieldFilter('projectId','==',pid)).stream()
    return jsonify(budgets=[x.to_dict() for x in docs if x.to_dict()['owner']==p['owner']],rates=catalog(config()))
@app.get('/projects/<pid>/jobs')
def project_jobs(pid):
    owned(pid)
    from google.cloud.firestore_v1.base_query import FieldFilter
    jobs=cloud().db.collection('animeShortsJobs').where(filter=FieldFilter('projectId','==',pid)).limit(100).stream()
    return jsonify(jobs=[{k:v for k,v in x.to_dict().items() if k not in ('payload','session')} for x in jobs])
