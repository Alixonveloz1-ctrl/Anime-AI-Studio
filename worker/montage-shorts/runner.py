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
    if os.environ.get('SHORTS_DISPATCH_PROBE'):
        from shorts.core.contracts import ident,require
        key=ident(os.environ['SHORTS_DISPATCH_PROBE']);require(key.startswith('diagnostic_'),'DIAGNOSTIC','Prueba inválida')
        cloud=Cloud(config());ref=cloud.db.collection('animeShortsDiagnostics').document(key)
        require(ref.get().exists,'DIAGNOSTIC','Prueba terminada')
        ref.update({'workerStarted':True,'workerCommit':os.environ.get('SHORTS_BUILD_COMMIT')})
        print('Cloud Tasks → service → Cloud Run worker: OK. No model calls.')
        return
    if os.environ.get('SHORTS_SELF_TEST')=='1':
        import subprocess
        # Container fixtures exercise the shipped media/service code. Repository
        # history/installer checks run in CI's full checkout, outside this image.
        for pattern in ('test_contracts.py','test_dependencies.py','test_media.py','test_api.py','test_requests.py','test_revisions.py','test_subtitles.py','test_dispatch.py','test_workflow.py','test_ideas.py','test_job_recovery.py'):
            subprocess.run([sys.executable,'-m','unittest','discover','-s','tests/shorts','-p',pattern],check=True)
        return
    if os.environ.get('SHORTS_CLOUD_SELF_TEST')=='1':
        import uuid
        cloud=Cloud(config());key='diagnostic_'+uuid.uuid4().hex
        doc=cloud.db.collection('animeShortsDiagnostics').document(key)
        obj=cloud.bucket.blob(cloud.c['prefix']+'/diagnostics/'+key)
        try:
            doc.create({'check':key,'schemaVersion':2})
            if doc.get().to_dict()['check']!=key:raise RuntimeError('Firestore readback failed')
            obj.upload_from_string(key,if_generation_match=0)
            if obj.download_as_text()!=key:raise RuntimeError('Storage readback failed')
            # Exercise ADC signing required for direct media URLs, without exposing URL.
            from google.auth.transport.requests import Request
            import datetime
            cloud.credentials.refresh(Request())
            url=obj.generate_signed_url(version='v4',expiration=datetime.timedelta(minutes=1),method='GET',service_account_email=cloud.c['serviceAccount'],access_token=cloud.credentials.token)
            import requests,time
            try:response=requests.get(url,timeout=20)
            except requests.RequestException:raise RuntimeError('Signed media request failed') from None
            if not response.ok or response.text!=key:raise RuntimeError('Signed media readback failed')
            # An actual Cloud Tasks delivery verifies both caller actAs and the
            # managed agent's OIDC token. It never creates a production job.
            from google.cloud import tasks_v2
            client=tasks_v2.CloudTasksClient();parent=client.queue_path(cloud.c['project'],cloud.c['region'],cloud.c['queue'])
            target=os.environ['SHORTS_DIAGNOSTIC_URL']
            from urllib.parse import urlparse
            parsed=urlparse(target)
            if parsed.scheme!='https' or not parsed.hostname.endswith('.run.app'):raise RuntimeError('Diagnostic target invalid')
            client.create_task(parent=parent,task={'name':parent+'/tasks/'+key,'http_request':{'http_method':tasks_v2.HttpMethod.POST,'url':target+'/internal/diagnostic','headers':{'Content-Type':'application/json'},'body':json.dumps({'key':key}).encode(),'oidc_token':{'service_account_email':cloud.c['serviceAccount'],'audience':cloud.c['service']}}})
            deadline=time.time()+600;next_notice=0
            while time.time()<deadline:
                state=doc.get().to_dict()
                if state.get('probeError'):raise RuntimeError(state['probeError'])
                if state.get('workerStarted') and state.get('workerCommit')==os.environ.get('SHORTS_BUILD_COMMIT'):break
                if time.time()>=next_notice:
                    print('Comprobando arranque real del worker…' if state.get('queueDelivered') else 'Esperando entrega autenticada de la cola…',flush=True)
                    next_notice=time.time()+20
                time.sleep(2)
            else:raise RuntimeError('No se verificó cola → servicio → worker de esta versión; la candidata no se activa')
            print('Cloud identity, Firestore, Storage, signed media and queue → service → worker: OK. No model calls.')
        finally:
            doc.delete();obj.delete()
        return
    cloud=Cloud(config());jid=os.environ['SHORTS_JOB_ID'];job,project,dispatch=cloud.claim(jid)
    if not dispatch:
        if job['state']=='cancelled':cloud.finish(jid,'cancelled',{'reason':'Permiso de despacho vencido'})
        return
    try:
        result=run_job(cloud,job,project);cloud.finish(jid,'awaiting_review',result)
    except UnknownSubmission:
        # Keep the unknown state; never submit again automatically.
        cloud.db.collection('animeShortsJobs').document(jid).update({'state':'submitted_unknown','errorCode':'SUBMITTED_UNKNOWN'})
        raise SystemExit(2)
    except ContractError as e:
        if e.code in ('VEO_PENDING','SPEECH_PENDING'):
            cloud.db.collection('animeShortsJobs').document(jid).update({'state':'waiting_provider','errorCode':e.code})
        else:cloud.finish(jid,'failed',{'code':e.code,'error':str(e)})
        raise SystemExit(1)
    except Exception as e:
        # Unknown crash after claim can include an accepted paid call.
        cloud.db.collection('animeShortsJobs').document(jid).update({'state':'submitted_unknown','errorCode':'WORKER_EXCEPTION','errorType':type(e).__name__})
        raise SystemExit(2)
if __name__=='__main__':main()
