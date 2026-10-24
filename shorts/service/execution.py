"""Execute a claimed task synchronously; duplicate deliveries cannot claim twice."""
from shorts.core.contracts import ContractError
from shorts.service.providers import UnknownSubmission

def execute_job(cloud,jid):
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
        # Nothing runs for this job any more: the engine is free for other work,
        # and the uncertain job waits for the owner (never resent by itself).
        cloud.release_slot(jid)
    except ContractError as error:
        cloud.finish(jid,'cancelled' if error.code=='CANCELLED' else 'failed',{'code':error.code,'error':str(error)})
    except Exception as error:
        calls=(ref.get().to_dict() or {}).get('providerCalls',[])
        if any(c.get('state')=='submitted_unknown' for c in calls):
            ref.update({'state':'submitted_unknown','errorCode':'WORKER_EXCEPTION','errorType':type(error).__name__})
            cloud.release_slot(jid)
        else:
            # Every provider call has a known outcome, so the failure came after
            # it (saving the result). That is a plain failure, not an unknown.
            cloud.finish(jid,'failed',{'code':'SAVE_FAILED','error':f'La generación terminó pero no se pudo guardar su resultado ({type(error).__name__}). No se repitió ninguna llamada.'})
