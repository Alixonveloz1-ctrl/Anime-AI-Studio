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
            # Estimates come exclusively from the server tariff table, never client payload.
            rates=json.loads(__import__('os').environ.get('SHORTS_RATE_TABLE','{}'))
            rate=rates.get(operation)
            require(rate and rate.get('verifiedDate') and rate.get('maxMicros',0)>0,'PRICE_UNVERIFIED','Falta tarifa conservadora verificada para esta operación',503)
            if operation=='veo':require(rate.get('generateAudio') is False,'PRICE_MODE','Tarifa Veo sin audio no verificada')
            job,new_budget,created=reserve(current,b,{j_id:old} if old else {},operation,payload,key,expected,rate['maxMicros'],time.time(),session)
            if created:tx.set(j_ref,job);tx.set(b_ref,new_budget)
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
    def claim(self,jid):
        ref=self.db.collection('animeShortsJobs').document(ident(jid))
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();require(j,'JOB','Trabajo inexistente',404)
            p=self.project_ref(j['projectId']).get(transaction=tx).to_dict();out,dispatch=claim(j,p,time.time());tx.set(ref,out)
            return out,p,dispatch
        return apply(self.db.transaction())
    def finish(self,jid,state,result):
        ref=self.db.collection('animeShortsJobs').document(jid)
        @firestore.transactional
        def apply(tx):
            j=ref.get(transaction=tx).to_dict();br=self.db.collection('animeShortsBudgetAuthorizations').document(j['budgetId']);b=br.get(transaction=tx).to_dict()
            j,b=settle(j,b,state,result);tx.set(ref,j);tx.set(br,b)
        apply(self.db.transaction())
