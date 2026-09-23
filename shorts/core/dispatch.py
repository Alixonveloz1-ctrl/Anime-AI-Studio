"""One in-flight worker per resource class, independent of queue delivery speed."""
import copy
from .contracts import require
from .jobs import GENERATION_OPERATIONS


def resource_class(operation):
    if operation in ('media','preview','render','frames','import'):return 'media'
    if operation in ('ideas','develop','revise','analyze','review','transcribe'):return 'text-analysis'
    return operation


def acquire(job,project,slot,now):
    if job['state']!='queued' or job.get('dispatchState')=='submitted':return job,slot,False
    require(not slot or slot.get('jobId') in (None,job['id']),'CAPACITY_BUSY','Otro trabajo usa este motor. La tarea sigue pendiente.',429)
    if job['operation'] in GENERATION_OPERATIONS:
        require(project.get('lease',{}).get('session')==job['session'] and project['lease']['expires']>now,'LEASE','Sesión pausada; continúa el pendiente desde Producción',409)
    out=copy.deepcopy(job);out.update(dispatchState='submitted',dispatchStarted=now)
    return out,{'jobId':job['id'],'since':now},True
