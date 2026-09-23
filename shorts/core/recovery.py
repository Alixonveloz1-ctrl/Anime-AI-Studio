import copy
from .contracts import require

def resume_known(job):
    """Resume polling the same provider operation; never generate it again."""
    require(job.get('providerOperation') and job['state']=='waiting_provider','RECOVERY','Solo se recupera una operación conocida')
    out=copy.deepcopy(job);out['pollAttempts']=out.get('pollAttempts',0)+1
    return out
