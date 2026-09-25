"""Execute a claimed task synchronously; duplicate deliveries cannot claim twice."""
from shorts.core.contracts import ContractError
from shorts.service.providers import UnknownSubmission

def execute_text(cloud,jid):
    from shorts.service.production import run_job
    job,project,claimed=cloud.claim(jid)
    if not claimed:
        if job['state']=='cancelled':cloud.finish(jid,'cancelled',{'reason':'Permiso de despacho vencido'})
        return
    ref=cloud.db.collection('animeShortsJobs').document(jid)
    try:
        ref.update({'executionMode':'service'})
        result=run_job(cloud,job,project)
        cloud.finish(jid,'awaiting_review',result)
    except UnknownSubmission:
        ref.update({'state':'submitted_unknown','errorCode':'SUBMITTED_UNKNOWN'})
    except ContractError as error:
        cloud.finish(jid,'cancelled' if error.code=='CANCELLED' else 'failed',{'code':error.code,'error':str(error)})
    except Exception as error:
        ref.update({'state':'submitted_unknown','errorCode':'WORKER_EXCEPTION','errorType':type(error).__name__})
