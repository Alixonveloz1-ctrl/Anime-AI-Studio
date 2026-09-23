"""Transactional state transitions, shared by Firestore and deterministic fixtures."""
import copy
from .contracts import require, digest, integer, revision

PAID={'ideas','develop','revise','image','veo','tts','music','analyze','transcribe','review'}

def reserve(project, budget, jobs, operation, payload, key, expected, estimate, now, session):
    require(isinstance(key,str) and 8<=len(key)<=128,'IDEMPOTENCY_KEY','Falta clave idempotente',400)
    job_id=digest([project['id'],key])
    fingerprint=digest([operation,payload])
    if job_id in jobs:
        require(jobs[job_id]['fingerprint']==fingerprint,'IDEMPOTENCY_CONFLICT','Clave reutilizada con otro encargo',409)
        return copy.deepcopy(jobs[job_id]),copy.deepcopy(budget),False
    revision(project,expected)
    integer(estimate,'reserva',1,10**12)
    require(budget.get('expires',0)>now and operation in budget.get('operations',[]),'BUDGET_AUTH','Falta autorización vigente',403)
    require(budget.get('reserved',0)+budget.get('spent',0)+estimate<=budget['limit'],'BUDGET_LIMIT','Saldo autorizado insuficiente',403)
    if operation in PAID:
        require(project.get('lease',{}).get('session')==session and project['lease']['expires']>now,'LEASE','Lote pausado: continúa desde esta sesión',409)
    out=copy.deepcopy(budget);out['reserved']=out.get('reserved',0)+estimate
    job={'id':job_id,'projectId':project['id'],'owner':project['owner'],'operation':operation,'payload':payload,'inputRevision':expected,'fingerprint':fingerprint,'state':'queued','reservation':estimate,'budgetId':budget['id'],'session':session,'created':now,'dispatchAttempt':0,'revision':1}
    return job,out,True

def claim(job, project, now):
    if job['state']!='queued':return job,False
    out=copy.deepcopy(job)
    if job['operation'] in PAID and (project.get('lease',{}).get('session')!=job['session'] or project['lease']['expires']<=now):
        out['state']='cancelled';out['reason']='Permiso de despacho vencido';return out,False
    # Persist BEFORE request; a crash never authorizes a second provider request.
    out.update(state='running',submissionMayHaveSucceeded=True,dispatchAttempt=out['dispatchAttempt']+1,started=now)
    return out,True

def settle(job,budget,state,result=None):
    require(state in ('succeeded','failed','cancelled','awaiting_review'),'JOB_STATE','Estado inválido')
    if job.get('settled'):return job,budget
    j=copy.deepcopy(job); b=copy.deepcopy(budget)
    b['reserved']-=j['reservation']
    if state!='cancelled':b['spent']=b.get('spent',0)+j['reservation']
    j.update(state=state,result=result,settled=True,revision=j['revision']+1)
    return j,b
