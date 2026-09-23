"""Cloud persistence, identity and object boundary. No browser media passthrough."""
import datetime
import json
import time
import uuid
from google.cloud import firestore, storage, tasks_v2
from google.auth import default
from google.auth.transport.requests import AuthorizedSession, Request
from google.oauth2 import id_token
from shorts.core.contracts import require, ident, revision, digest
from shorts.core.jobs import reserve, claim, settle
from shorts.core.pricing import catalog, CALLS, call_limit, reconcile
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
        require(k in ('ideas','developments','assets','cues','events','timelines','previews','corrections','approvals','uploads','references'),'ENTITY','Entidad inválida',400)
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
    def submit(self,p,operation,payload,key,expected,budget_id,session):
        b_ref=self.db.collection('animeShortsBudgetAuthorizations').document(ident(budget_id))
        j_id=digest([p['id'],key]);j_ref=self.db.collection('animeShortsJobs').document(j_id)
        @firestore.transactional
        def save(tx):
            current=self.project_ref(p['id']).get(transaction=tx).to_dict();b=b_ref.get(transaction=tx).to_dict();old=j_ref.get(transaction=tx).to_dict()
            require(b and b['owner']==p['owner'] and b['projectId']==p['id'],'BUDGET_AUTH','Autorización ajena',403)
            rate=catalog(self.c).get(operation)
            require(rate,'OPERATION','Operación no presupuestable')
            job,new_budget,created=reserve(current,b,{j_id:old} if old else {},operation,payload,key,expected,rate['maxMicros'],time.time(),session)
            if created:
                job['priceEstimate']=rate;job['providerCalls']=[]
                tx.set(j_ref,job);tx.set(b_ref,new_budget)
            return job
        job=save(self.db.transaction())
        if job['state']=='queued':self.enqueue(job)
        return job
    def enqueue(self,j):
        client=tasks_v2.CloudTasksClient();parent=client.queue_path(self.c['project'],self.c['region'],self.c['queue'])
        from google.api_core.exceptions import AlreadyExists
        task={'name':parent+'/tasks/'+j['id']+'-'+str(j.get('dispatchAttempt',0)), 'http_request':{'http_method':tasks_v2.HttpMethod.POST,'url':self.c['service']+'/internal/dispatch','headers':{'Content-Type':'application/json'},'body':json.dumps({'jobId':j['id']}).encode(),'oidc_token':{'service_account_email':self.c['serviceAccount'],'audience':self.c['service']}}}
        try:client.create_task(parent=parent,task=task)
        except AlreadyExists:pass
    def acquire_dispatch(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            p=self.project_ref(j['projectId']).get(transaction=tx).to_dict()
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']))
            slot=sr.get(transaction=tx).to_dict()
            out,slot,dispatch=acquire(j,p,slot,time.time())
            if dispatch:tx.set(ref,out);tx.set(sr,slot)
            return out,dispatch
        return apply(self.db.transaction())

    def claim(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            p=self.project_ref(j['projectId']).get(transaction=tx).to_dict()
            b=self.db.collection('animeShortsBudgetAuthorizations').document(j['budgetId']).get(transaction=tx).to_dict()
            if j['state']=='queued' and (b.get('expires',0)<=time.time() or j['operation'] not in b.get('operations',[])):
                out={**j,'state':'cancelled','reason':'Autorización vencida'};dispatch=False
            else:out,dispatch=claim(j,p,time.time())
            if dispatch:
                import os
                execution=os.environ.get('CLOUD_RUN_EXECUTION','')
                if execution:out['workerExecution']=f'projects/{self.c["project"]}/locations/{self.c["region"]}/jobs/{self.c["job"]}/executions/{ident(execution)}'
            tx.set(ref,out)
            return out,p,dispatch
        return apply(self.db.transaction())
    def finish(self,jid,state,result):
        ref=self.db.collection('animeShortsJobs').document(jid)
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();br=self.db.collection('animeShortsBudgetAuthorizations').document(j['budgetId']);b=br.get(transaction=tx).to_dict()
            sr=self.db.collection('animeShortsCapacity').document(resource_class(j['operation']));slot=sr.get(transaction=tx).to_dict()
            if not j.get('settled') and j.get('started'):j['cost']=reconcile(j,time.time())
            j,b=settle(j,b,state,result);tx.set(ref,j);tx.set(br,b)
            if slot and slot.get('jobId')==jid:tx.set(sr,{'jobId':None})
        apply(self.db.transaction())


class JobMeter:
    """Journal every paid request before transport, with an independent lease check."""
    def __init__(self,cloud,jid):self.cloud,self.jid=cloud,jid
    def begin_call(self,kind,url,payload):
        @firestore.transactional
        def apply(tx):
            ref=self.cloud.db.collection('animeShortsJobs').document(self.jid)
            job=ref.get(transaction=tx).to_dict()
            p=self.cloud.project_ref(job['projectId']).get(transaction=tx).to_dict()
            require(job['state'] not in ('cancel_requested','cancelled'),'CANCELLED','Se detuvieron nuevas llamadas',409)
            require(p.get('lease',{}).get('session')==job['session'] and p['lease']['expires']>time.time(),'LEASE','Sesión pausada antes de llamar al proveedor',409)
            budget=self.cloud.db.collection('animeShortsBudgetAuthorizations').document(job['budgetId']).get(transaction=tx).to_dict()
            require(budget.get('expires',0)>time.time() and job['operation'] in budget.get('operations',[]),'BUDGET_AUTH','Autorización vencida o pausada',403)
            catalog(self.cloud.c)
            calls=job.get('providerCalls',[])
            require(sum(c['kind']==kind for c in calls)<CALLS[job['operation']].get(kind,0),'CALL_LIMIT','Límite de llamadas del encargo agotado')
            call={'id':uuid.uuid4().hex,'kind':kind,'state':'submitted_unknown','requestHash':digest([url,payload]),'started':time.time(),'ceilingMicros':call_limit(kind)}
            tx.update(ref,{'providerCalls':calls+[call]})
            return call['id']
        return apply(self.cloud.db.transaction())
    def end_call(self,cid,state,cost,basis):
        @firestore.transactional
        def apply(tx):
            ref=self.cloud.db.collection('animeShortsJobs').document(self.jid)
            job=ref.get(transaction=tx).to_dict();calls=job['providerCalls']
            row=next(c for c in calls if c['id']==cid)
            row.update(state=state,estimatedMicros=cost,basis=basis,finished=time.time())
            tx.update(ref,{'providerCalls':calls})
        apply(self.cloud.db.transaction())
