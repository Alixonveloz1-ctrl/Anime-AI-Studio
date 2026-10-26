"""Cloud persistence, identity and object boundary. No browser media passthrough."""
import datetime
import json
import time
import uuid
from google.cloud import firestore, storage, tasks_v2
from google.auth import default
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2 import id_token
from shorts.core.contracts import require, ident, revision, digest, ContractError
from shorts.core.jobs import create_job, claim, settle, close_uncertain
from shorts.core.requests import check_call_scope, verify_models
from shorts.core.dispatch import resource_class, acquire

class Cloud:
    def __init__(self,c):
        self.c=c
        self.db=firestore.Client(project=c['project'],database=c['database'])
        self.storage=storage.Client(project=c['project']);self.bucket=self.storage.bucket(c['bucket'])
        self.credentials,_=default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        self.http=AuthorizedSession(self.credentials)
    def project_ref(self,p):return self.db.collection('animeShortsProjects').document(ident(p))
    def project(self,p,owner):
        d=self.project_ref(p).get().to_dict()
        require(d and d['owner']==owner,'PROJECT_ACCESS','Proyecto no disponible',404)
        return d
    def entity_ref(self,p,k,i):
        require(k in ('ideas','developments','developmentDrafts','assets','cues','events','timelines','previews','corrections','approvals','uploads','references','batches'),'ENTITY','Entidad inválida',400)
        return self.project_ref(p).collection(k).document(ident(i))
    def entity(self,p,k,i):
        d=self.entity_ref(p,k,i).get().to_dict();require(d,'NOT_FOUND','Recurso no encontrado',404);return d
    def put_entity(self,p,k,data):
        self.entity_ref(p,k,data['id']).create(data)
        return data
    def mutate(self,p,expected,fn):
        @firestore.transactional
        def apply(tx):
            ref=self.project_ref(p);current=ref.get(transaction=tx).to_dict();revision(current,expected)
            result=fn(tx,current);current['revision']+=1;current['updated']=time.time();tx.set(ref,current)
            return result,current
        return apply(self.db.transaction())
    def delete_project(self,pid,owner):
        # Borrarlo todo, no esconderlo: documento, todas sus colecciones,
        # todos sus trabajos y todos sus objetos en el bucket del proyecto.
        # Una generación que ya está en marcha con el proveedor no se borra:
        # borrar su registro dejaría una llamada sin dueño y sin resultado.
        from google.cloud.firestore_v1.base_query import FieldFilter
        ident(pid);ref=self.project_ref(pid);project=ref.get().to_dict()
        require(project and project['owner']==owner,'PROJECT_ACCESS','Proyecto no disponible',404)
        jobs=[x.to_dict() for x in self.db.collection('animeShortsJobs').where(filter=FieldFilter('projectId','==',pid)).stream()]
        in_flight=[j for j in jobs if j.get('state') in ('running','waiting_provider','submitted_unknown') and not j.get('settled')]
        require(not in_flight,'JOB_RUNNING','Hay una generación en curso en este proyecto. Espera a que termine o cancélala antes de eliminarlo.',409)
        for job in jobs:
            try:self.release_slot(job['id'])
            except Exception:pass
        for job in jobs:
            try:
                client=tasks_v2.CloudTasksClient();parent=client.queue_path(self.c['project'],self.c['region'],self.c['queue'])
                for attempt in range(int(job.get('dispatchAttempt',0))+1):
                    try:client.delete_task(name=parent+'/tasks/'+job['id']+'-'+str(attempt))
                    except Exception:pass
            except Exception:pass
        deleted_objects=0
        for blob in self.bucket.list_blobs(prefix=f"{self.c['prefix']}/projects/{pid}/"):
            try:blob.delete();deleted_objects+=1
            except Exception:pass
        def delete_collection(collection):
            count=0
            for doc in collection.stream():
                for sub in doc.reference.collections():count+=delete_collection(sub)
                doc.reference.delete();count+=1
            return count
        deleted_entities=0
        for collection in ref.collections():deleted_entities+=delete_collection(collection)
        for job in jobs:self.db.collection('animeShortsJobs').document(job['id']).delete()
        ref.delete()
        return {'deleted':True,'deletedEntities':deleted_entities,'deletedJobs':len(jobs),'deletedObjects':deleted_objects}
    def object_name(self,p,asset,name):
        ident(p);ident(asset);require(name and '/' not in name and '..' not in name,'OBJECT','Nombre inválido')
        return f'{self.c["prefix"]}/projects/{p}/assets/{asset}/{name}'
    def blob(self,p,name):
        require(name.startswith(f'{self.c["prefix"]}/projects/{ident(p)}/') and '..' not in name and '\\' not in name,'OBJECT_SCOPE','Objeto fuera del proyecto')
        return self.bucket.blob(name)
    def url(self,p,name):
        blob=self.blob(p,name)
        self.credentials.refresh(Request())
        return blob.generate_signed_url(version='v4',expiration=datetime.timedelta(minutes=15),method='GET',service_account_email=self.c['serviceAccount'],access_token=self.credentials.token)
    def upload_file(self,p,aid,path,name,mime):
        obj=self.object_name(p,aid,name);self.blob(p,obj).upload_from_filename(str(path),content_type=mime,if_generation_match=0)
        return obj
    def download(self,p,name,path):
        b=self.blob(p,name);b.reload();require(b.size<=250*1024*1024,'SIZE','Recurso supera 250 MB');b.download_to_filename(str(path))
    def submit(self,p,operation,payload,key,expected,session):
        j_id=digest([p['id'],key]);j_ref=self.db.collection('animeShortsJobs').document(j_id)
        @firestore.transactional
        def save(tx):
            current=self.project_ref(p['id']).get(transaction=tx).to_dict();old=j_ref.get(transaction=tx).to_dict()
            require(current and current['owner']==p['owner'],'PROJECT_ACCESS','Historia no disponible',404)
            job,created=create_job(current,{j_id:old} if old else {},operation,payload,key,expected,time.time(),session)
            if created:
                from shorts.core.requests import selected_models
                job['models']=selected_models(self.c,current.get('generators',{}))
                tx.set(j_ref,job)
            return job
        job=save(self.db.transaction())
        if job['state']=='queued':self.enqueue(job)
        return job
    def enqueue(self,j):
        client=tasks_v2.CloudTasksClient();parent=client.queue_path(self.c['project'],self.c['region'],self.c['queue'])
        from google.api_core.exceptions import AlreadyExists
        task={'dispatch_deadline':{'seconds':1800},'name':parent+'/tasks/'+j['id']+'-'+str(j.get('dispatchAttempt',0)), 'http_request':{'http_method':tasks_v2.HttpMethod.POST,'url':self.c['service']+'/internal/dispatch','headers':{'Content-Type':'application/json'},'body':json.dumps({'jobId':j['id']}).encode(),'oidc_token':{'service_account_email':self.c['serviceAccount'],'audience':self.c['service']}}}
        ref=self.db.collection('animeShortsJobs').document(j['id'])
        try:client.create_task(parent=parent,task=task)
        except AlreadyExists:pass # Same task name: never submit a second copy.
        except Exception as error:
            ref.update({'queueError':{'code':type(error).__name__,'message':'No se confirmó la entrega a la cola. Comprueba el estado antes de continuar.','at':time.time()}})
            return False
        ref.update({'queueSubmitted':time.time(),'queueError':None})
        return True
    def acquire_dispatch(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            p=self.project_ref(j['projectId']).get(transaction=tx).to_dict()
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']))
            slot=sr.get(transaction=tx).to_dict()
            # A job that cannot run any more must not keep an engine. Age alone
            # never frees one: what frees it is knowing nothing is executing.
            if slot and slot.get('jobId') and slot['jobId']!=j['id']:
                previous=self.db.collection('animeShortsJobs').document(slot['jobId']).get(transaction=tx).to_dict()
                # A record that is no longer there cannot be protecting a
                # running submission: nothing exists that could report its
                # outcome or free it, so it held that engine for good.
                # An uncertain submission is not executing either — release_slot
                # frees it for exactly this reason when the worker reaches it —
                # and the job still stays open, unsettled and never resent, for
                # the owner to close. A worker killed before releasing it left
                # the engine held forever by something that is not running.
                stopped=previous.get('state')=='submitted_unknown' if previous else False
                if not previous or previous.get('settled') or stopped:slot=None
            try:out,slot,dispatch=acquire(j,p,slot,time.time())
            except ContractError as error:
                if error.code not in ('CAPACITY_BUSY','LEASE'):raise
                out={**j,'dispatchError':{'code':error.code,'message':str(error),'at':time.time()}}
                if error.code=='CAPACITY_BUSY':
                    out['dispatchError']['blockingJobId']=slot.get('jobId')
                    # Its Cloud Task finishes with 200, so nothing would retry
                    # it. The engine remembers who is waiting and starts the
                    # first of them as soon as it is free.
                    queue=[x for x in (slot.get('waiting') or []) if x!=j['id']][:19]+[j['id']]
                    tx.set(sr,{**slot,'waiting':queue})
                tx.set(ref,out)
                # A known pre-dispatch pause is resumable by the owner. Do not
                # silently exhaust Cloud Tasks' three retries and abandon it.
                return out,False
            if dispatch:out.update(dispatchError=None,queueError=None)
            if dispatch:tx.set(ref,out);tx.set(sr,slot)
            return out,dispatch
        return apply(self.db.transaction())

    def claim(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            p=self.project_ref(j['projectId']).get(transaction=tx).to_dict()
            out,dispatch=claim(j,p,time.time())
            if dispatch:
                import os
                execution=os.environ.get('CLOUD_RUN_EXECUTION','')
                if execution:out['workerExecution']=f'projects/{self.c["project"]}/locations/{self.c["region"]}/jobs/{self.c["job"]}/executions/{ident(execution)}'
            tx.set(ref,out)
            return out,p,dispatch
        return apply(self.db.transaction())
    def release_slot(self,jid):
        """Free the engine once a job's execution is over, even when its outcome is
        uncertain: nothing runs for it any more. The job stays open for the owner."""
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict()
            if not j:return
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']));slot=sr.get(transaction=tx).to_dict()
            if slot and slot.get('jobId')==j['id']:return self._free(tx,sr,slot,j['id'])
        self.wake(apply(self.db.transaction()))
    def _free(self,tx,sr,slot,jid):
        """Release the engine and return the job that was waiting for it."""
        queue=[x for x in (slot.get('waiting') or []) if x!=jid]
        tx.set(sr,{'jobId':None,'waiting':queue[1:]})
        return queue[0] if queue else None
    def wake(self,jid):
        if not jid:return
        row=self.db.collection('animeShortsJobs').document(ident(jid)).get().to_dict()
        if row and row.get('state')=='queued' and not row.get('settled') and not row.get('dispatchState'):self.enqueue(row)
    def close_uncertain(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']));slot=sr.get(transaction=tx).to_dict()
            out=close_uncertain(j);tx.set(ref,out)
            woken=self._free(tx,sr,slot,j['id']) if slot and slot.get('jobId')==j['id'] else None
            return out,woken
        out,woken=apply(self.db.transaction());self.wake(woken);return out
    def finish(self,jid,state,result):
        ref=self.db.collection('animeShortsJobs').document(jid)
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict()
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']));slot=sr.get(transaction=tx).to_dict()
            j=settle(j,state,result);tx.set(ref,j)
            return self._free(tx,sr,slot,jid) if slot and slot.get('jobId')==jid else None
        self.wake(apply(self.db.transaction()))


# Seconds between the start of two consecutive Cortos text calls. See pace_text.
TEXT_SPACING_SECONDS=5

def lease_taken_over(project,job):
    """True only when ANOTHER session holds the production lease.

    A lease that merely ran out — same session, the phone locked the screen and
    its 10 s heartbeat stopped — must not kill a job that is already running:
    nobody took over, it still holds its engine slot and its calls are already
    paid for. Expiry is what lets a NEW session take the lease over (claim and
    acquire still check it), not a reason to abandon work in flight. Without
    this, the shared 60 s spacing between text calls always outlived the 30 s
    lease, so the second text step of a session could never finish.
    """
    lease=project.get('lease') or {}
    return bool(lease.get('session')) and lease['session']!=job['session']


class RequestJournal:
    """Journal every generation request before transport, with an independent lease check."""
    def __init__(self,cloud,jid):self.cloud,self.jid=cloud,jid
    def record_image_response(self,summary):
        self.cloud.db.collection('animeShortsJobs').document(self.jid).update({'imageResponse':summary})
    def wait_for_provider(self,seconds,reason,attempt=0):
        ref=self.cloud.db.collection('animeShortsJobs').document(self.jid)
        ref.update({'providerWait':{'reason':reason,'retryAt':time.time()+seconds,'attempt':attempt,'maxRetries':3}})
        deadline=time.monotonic()+seconds
        while True:
            job=ref.get().to_dict()
            p=self.cloud.project_ref(job['projectId']).get().to_dict()
            require(job['state'] not in ('cancel_requested','cancelled'),'CANCELLED','Se canceló la espera; no se envió otra generación.',409)
            require(not lease_taken_over(p,job),'LEASE','Otro dispositivo tomó la producción; se detuvo la espera. Lo terminado sigue guardado.',409)
            remaining=deadline-time.monotonic()
            if remaining<=0:break
            time.sleep(min(5,remaining))
        ref.update({'providerWait':None})
    def pace_text(self):
        # Shared across Cortos text jobs in this GCP project, not just a browser.
        #
        # It used to reserve a WHOLE MINUTE before every text call. Every text
        # operation (ideas, develop, revise, analyze, review, transcribe) shares
        # one engine, so there is only ever one Cortos text call in flight: that
        # minute bought no protection from anyone and turned a full script —
        # eight to ten calls in a row — into eight to ten minutes of waiting,
        # while Animes writes a long episode with far more calls, back to back,
        # on the same project and the same model. What actually protects the
        # quota is the 429 back-off below (Google's own retryDelay, 60/120/240
        # with jitter and a ten-minute budget), which is untouched. This is only
        # an anti-burst space between consecutive calls.
        ref=self.cloud.db.collection('animeShortsCapacity').document('text-pacing')
        @firestore.transactional
        def reserve(tx):
            row=ref.get(transaction=tx).to_dict() or {};now=time.time()
            start=max(now,row.get('nextAt',0));tx.set(ref,{'nextAt':start+TEXT_SPACING_SECONDS})
            return max(0,start-now)
        delay=reserve(self.cloud.db.transaction())
        if delay:self.wait_for_provider(delay,'spacing')
    def begin_call(self,kind,url,payload):
        @firestore.transactional
        def apply(tx):
            ref=self.cloud.db.collection('animeShortsJobs').document(self.jid)
            job=ref.get(transaction=tx).to_dict()
            p=self.cloud.project_ref(job['projectId']).get(transaction=tx).to_dict()
            require(job['state'] not in ('cancel_requested','cancelled'),'CANCELLED','Se detuvieron nuevas llamadas',409)
            require(not lease_taken_over(p,job),'LEASE','Otro dispositivo tomó la producción antes de llamar al proveedor',409)
            verify_models(self.cloud.c)
            calls=job.get('providerCalls',[])
            check_call_scope(job['operation'],calls,kind)
            rejected=[c for c in calls if c['kind']==kind and c['state']=='quota_rejected']
            if rejected:require(rejected[-1]['requestHash']==digest([url,payload]),'RETRY_CHANGED','El reintento debe conservar la misma solicitud.',409)
            call={'id':uuid.uuid4().hex,'kind':kind,'state':'submitted_unknown','requestHash':digest([url,payload]),'started':time.time()}
            tx.update(ref,{'providerCalls':calls+[call]})
            return call['id']
        return apply(self.cloud.db.transaction())
    def end_call(self,cid,state):
        @firestore.transactional
        def apply(tx):
            ref=self.cloud.db.collection('animeShortsJobs').document(self.jid)
            job=ref.get(transaction=tx).to_dict();calls=job['providerCalls']
            row=next(c for c in calls if c['id']==cid)
            row.update(state=state,finished=time.time())
            tx.update(ref,{'providerCalls':calls})
        apply(self.cloud.db.transaction())
