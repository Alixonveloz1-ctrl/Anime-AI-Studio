import copy
from .contracts import require
from .pricing import WORKER_SECONDS,WORKER_MICROS_PER_SECOND

def reserve_poll_worker(job,budget,now):
    """A known LRO may be polled again; compute still needs its own reservation."""
    require(job.get('providerOperation') and job['state']=='waiting_provider','RECOVERY','Solo se recupera una operación conocida')
    require(budget['expires']>now and job['operation'] in budget['operations'],'BUDGET_AUTH','Renueva la autorización antes de recuperar',403)
    amount=WORKER_SECONDS*WORKER_MICROS_PER_SECOND
    require(budget['spent']+budget['reserved']+amount<=budget['limit'],'BUDGET_LIMIT','Falta saldo autorizado para otro worker de consulta',403)
    j,b=copy.deepcopy(job),copy.deepcopy(budget)
    # Conservative prior execution ceiling; waiting time outside Cloud Run is
    # not counted as CPU, and each resume is accounted exactly once.
    j['workerMicrosAccrued']=j.get('workerMicrosAccrued',0)+amount
    j['reservation']+=amount;b['reserved']+=amount
    return j,b
