"""Transactional job transitions. User actions, not money, authorize a task."""
import copy
from .contracts import require, digest, revision
from .requests import CALLS

GENERATION_OPERATIONS={k for k,v in CALLS.items() if v}

def create_job(project,jobs,operation,payload,key,expected,now,session):
    require(operation in CALLS,'OPERATION','Acción desconocida')
    require(isinstance(key,str) and 8<=len(key)<=128,'IDEMPOTENCY_KEY','Falta clave idempotente',400)
    job_id=digest([project['id'],key]);fingerprint=digest([operation,payload])
    if job_id in jobs:
        require(jobs[job_id]['fingerprint']==fingerprint,'IDEMPOTENCY_CONFLICT','Clave reutilizada con otro encargo',409)
        return copy.deepcopy(jobs[job_id]),False
    revision(project,expected)
    require(project.get('lease',{}).get('session')==session and project['lease']['expires']>now,'LEASE','La sesión cambió; vuelve a solicitar la acción',409)
    return {'id':job_id,'projectId':project['id'],'owner':project['owner'],'operation':operation,'payload':payload,
        'inputRevision':expected,'fingerprint':fingerprint,'state':'queued','session':session,'created':now,
        'dispatchAttempt':0,'revision':1,'providerCalls':[]},True

def claim(job,project,now):
    if job['state']!='queued':return job,False
    out=copy.deepcopy(job)
    if job['operation'] in GENERATION_OPERATIONS and (project.get('lease',{}).get('session')!=job['session'] or project['lease']['expires']<=now):
        out['state']='cancelled';out['reason']='La sesión de producción se pausó';return out,False
    # A crash after this write never authorizes another provider submission.
    out.update(state='running',submissionMayHaveSucceeded=True,dispatchAttempt=out['dispatchAttempt']+1,started=now)
    return out,True

def settle(job,state,result=None):
    require(state in ('succeeded','failed','cancelled','awaiting_review'),'JOB_STATE','Estado inválido')
    if job.get('settled'):return job
    require(not any(c['state']=='submitted_unknown' for c in job.get('providerCalls',[])),'UNSETTLED_CALL','Hay un envío sin resultado confirmado',409)
    j=copy.deepcopy(job);j.update(state=state,result=result,settled=True,revision=j['revision']+1)
    return j
