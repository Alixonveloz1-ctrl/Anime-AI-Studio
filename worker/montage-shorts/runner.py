import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from shorts.service.config import config
from shorts.service.cloud import Cloud
from shorts.service.production import run_job
from shorts.service.providers import UnknownSubmission
from shorts.core.contracts import ContractError

def main():
    if os.environ.get('SHORTS_SELF_TEST')=='1':
        import subprocess
        # Container fixtures exercise the shipped media/service code. Repository
        # history/installer checks run in CI's full checkout, outside this image.
        for pattern in ('test_contracts.py','test_dependencies.py','test_media.py','test_api.py'):
            subprocess.run([sys.executable,'-m','unittest','discover','-s','tests/shorts','-p',pattern],check=True)
        return
    cloud=Cloud(config());jid=os.environ['SHORTS_JOB_ID'];job,project,dispatch=cloud.claim(jid)
    if not dispatch:
        if job['state']=='cancelled':cloud.finish(jid,'cancelled',{'reason':'Permiso de despacho vencido'})
        return
    try:
        result=run_job(cloud,job,project);cloud.finish(jid,'awaiting_review',result)
    except UnknownSubmission:
        # Reservation retained; never submit again automatically.
        cloud.db.collection('animeShortsJobs').document(jid).update({'state':'submitted_unknown','errorCode':'SUBMITTED_UNKNOWN'})
        raise SystemExit(2)
    except ContractError as e:
        if e.code=='VEO_PENDING':
            cloud.db.collection('animeShortsJobs').document(jid).update({'state':'waiting_provider','errorCode':e.code})
        else:cloud.finish(jid,'failed',{'code':e.code,'error':str(e)})
        raise SystemExit(1)
    except Exception as e:
        # Unknown crash after claim can include an accepted paid call.
        cloud.db.collection('animeShortsJobs').document(jid).update({'state':'submitted_unknown','errorCode':'WORKER_EXCEPTION','errorType':type(e).__name__})
        raise SystemExit(2)
if __name__=='__main__':main()
