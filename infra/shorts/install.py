#!/usr/bin/env python3
"""Mobile installer. No key creation, destructive checkout or legacy mutations."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
PREFIX='anime-shorts-preview'

def command(args, capture=True, check=True, cwd=None):
    result=subprocess.run(args,cwd=cwd,text=True,stdout=subprocess.PIPE if capture else None,stderr=subprocess.PIPE if capture else None)
    if check and result.returncode:
        raise RuntimeError(f'Falló {args[0]} {args[1] if len(args)>1 else ""}. Código {result.returncode}. Revisa permisos/configuración; la versión activa no se sustituye.')
    return result.stdout.strip() if capture else result.returncode

def g(*args,**kw):return command(['gcloud',*args],**kw)
def pick(title,choices):
    if not choices:raise RuntimeError('No hay opciones disponibles: '+title)
    print('\n'+title)
    for i,item in enumerate(choices,1):print(f'{i}. {item}')
    while True:
        try:
            value=int(input('Número: '))
            if 1<=value<=len(choices):return choices[value-1]
        except ValueError:pass
        print('Selecciona un número de la lista.')

def account_project():
    account=g('auth','list','--filter=status:ACTIVE','--format=value(account)').splitlines()
    if not account:raise RuntimeError('Inicia sesión de Google en Cloud Shell desde el navegador y vuelve a ./c.')
    projects=json.loads(g('projects','list','--format=json(projectId,name)'))
    labels=[f'{x["name"]} ({x["projectId"]})' for x in projects]
    label=pick('Proyecto autorizado para Cortos (no modifica Animes)',labels)
    return account[0],projects[labels.index(label)]['projectId']

def exists(*args):
    return subprocess.run(['gcloud',*args],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0

def state_load(bucket):
    path=f'gs://{bucket}/installation/active.json'
    if not exists('storage','objects','describe',path):return None
    return json.loads(g('storage','cat',path))

def state_save(bucket,state,temp):
    file=Path(temp)/'active.json';file.write_text(json.dumps(state,indent=2))
    g('storage','cp',str(file),f'gs://{bucket}/installation/active.json')

def check_owned(bucket,project):
    if exists('storage','buckets','describe',f'gs://{bucket}'):
        b=json.loads(g('storage','buckets','describe',f'gs://{bucket}','--format=json'))
        labels=b.get('labels',{})
        if labels.get('managed-by')!='anime-shorts-v2':raise RuntimeError('El bucket existente no pertenece a este instalador. No se modificó.')
        return True
    return False

def health(project,region,state):
    checks={}
    checks['worker']=exists('run','jobs','describe',state['job'],'--project',project,'--region',region)
    checks['database']=exists('firestore','databases','describe','--database',PREFIX,'--project',project)
    checks['queue']=exists('tasks','queues','describe',PREFIX,'--location',region,'--project',project)
    checks['storage']=exists('storage','buckets','describe','gs://'+state['bucket'])
    try:
        with urllib.request.urlopen(state['url']+'/health',timeout=15) as response:checks['service']=json.load(response).get('schemaVersion')==2
    except Exception:checks['service']=False
    for key,value in checks.items():print(f'{key}: {"OK" if value else "PENDIENTE/FALLÓ"}')
    print('Acceso a modelos: pendiente de pruebas autorizadas. Health no genera contenido.')
    return all(checks.values())

def install(account,project,region,bucket):
    billing=json.loads(g('billing','projects','describe',project,'--format=json'))
    if not billing.get('billingEnabled'):raise RuntimeError('La facturación no está habilitada en el proyecto seleccionado.')
    sha=command(['git','rev-parse','HEAD'],cwd=ROOT)
    old=state_load(bucket) if check_owned(bucket,project) else None
    print(f'\nCuenta: {account}\nProyecto: {project}\nEntorno: preview\nRegión de infraestructura: {region}\nCommit: {sha}')
    print('Recursos aislados: bucket, base Firestore, cola, servicio y Job. Cloud Build, almacenamiento y render pueden generar cargos. No se pagarán modelos durante instalación.')
    if pick('¿Autorizar estos cambios de infraestructura?', ['Cancelar','Autorizar instalación/actualización'])=='Cancelar':return
    with tempfile.TemporaryDirectory(prefix='anime-shorts-install-') as tmp:
        work=Path(tmp)/'source';work.mkdir()
        archive=Path(tmp)/'source.tar'
        command(['git','archive','--format=tar','-o',str(archive),sha],cwd=ROOT)
        command(['tar','-xf',str(archive),'-C',str(work)])
        command(['python3','-m','unittest','discover','-s','tests/shorts','-p','test_contracts.py'],cwd=work,capture=False)
        for api in ['run','cloudbuild','artifactregistry','storage','firestore','cloudtasks','iamcredentials','aiplatform','texttospeech','speech','identitytoolkit','firebase']:
            g('services','enable',api+'.googleapis.com','--project',project,'--quiet')
        sa=f'{PREFIX}@{project}.iam.gserviceaccount.com'
        if not exists('iam','service-accounts','describe',sa,'--project',project):g('iam','service-accounts','create',PREFIX,'--project',project,'--display-name','Anime Cortos preview')
        if not check_owned(bucket,project):
            g('storage','buckets','create','gs://'+bucket,'--project',project,'--location',region,'--uniform-bucket-level-access')
            g('storage','buckets','update','gs://'+bucket,'--update-labels=managed-by=anime-shorts-v2,environment=preview')
        g('storage','buckets','add-iam-policy-binding','gs://'+bucket,'--member=serviceAccount:'+sa,'--role=roles/storage.objectAdmin')
        for role in ['roles/aiplatform.user','roles/datastore.user','roles/cloudtasks.enqueuer','roles/run.jobsExecutorWithOverrides','roles/serviceusage.serviceUsageConsumer','roles/firebaseauth.viewer']:
            g('projects','add-iam-policy-binding',project,'--member=serviceAccount:'+sa,'--role='+role,'--quiet')
        g('iam','service-accounts','add-iam-policy-binding',sa,'--project',project,'--member=serviceAccount:'+sa,'--role=roles/iam.serviceAccountTokenCreator','--quiet')
        if not exists('firestore','databases','describe','--database',PREFIX,'--project',project):g('firestore','databases','create','--database',PREFIX,'--location',region,'--type=firestore-native','--project',project,'--quiet')
        if not exists('tasks','queues','describe',PREFIX,'--location',region,'--project',project):g('tasks','queues','create',PREFIX,'--location',region,'--project',project,'--max-concurrent-dispatches=1','--max-dispatches-per-second=1','--max-attempts=3')
        if not exists('artifacts','repositories','describe',PREFIX,'--location',region,'--project',project):g('artifacts','repositories','create',PREFIX,'--repository-format=docker','--location',region,'--project',project)
        image=f'{region}-docker.pkg.dev/{project}/{PREFIX}/worker:{sha}'
        build={'steps':[{'name':'gcr.io/cloud-builders/docker','args':['build','-t',image,'-f','worker/montage-shorts/Dockerfile','.']},{'name':'gcr.io/cloud-builders/docker','args':['run','--rm','-e','SHORTS_SELF_TEST=1',image]}],'images':[image],'timeout':'1800s'}
        buildfile=Path(tmp)/'build.json';buildfile.write_text(json.dumps(build))
        g('builds','submit',str(work),'--config',str(buildfile),'--project',project,'--quiet',capture=False)
        image_digest=g('artifacts','docker','images','describe',image,'--project',project,'--format=value(image_summary.digest)')
        if not image_digest.startswith('sha256:'):raise RuntimeError('No se pudo verificar el digest. No se activó la candidata.')
        immutable=image.rsplit(':',1)[0]+'@'+image_digest
        job=PREFIX+'-'+sha[:10];service=PREFIX
        env={'SHORTS_GCP_PROJECT_ID':project,'SHORTS_GCS_BUCKET':bucket,'SHORTS_GCS_PREFIX':PREFIX,'SHORTS_ENVIRONMENT':'preview','SHORTS_FIRESTORE_DATABASE':PREFIX,'SHORTS_REGION':region,'SHORTS_RENDER_JOB':job,'SHORTS_QUEUE':PREFIX,'SHORTS_SERVICE_ACCOUNT':sa,'SHORTS_ALLOWED_EMAILS':account,'SHORTS_AUTH_PROJECT_ID':project}
        envfile=Path(tmp)/'env.json';envfile.write_text(json.dumps(env))
        g('run','jobs','deploy',job,'--image',immutable,'--region',region,'--project',project,'--service-account',sa,'--env-vars-file',str(envfile),'--cpu=2','--memory=4Gi','--task-timeout=3600s','--max-retries=0','--labels=managed-by=anime-shorts-v2','--quiet')
        deploy=['run','deploy',service,'--image',immutable,'--region',region,'--project',project,'--service-account',sa,'--command=gunicorn','--args=--bind,:8080,--workers,2,--timeout,240,shorts.service.app:app','--env-vars-file',str(envfile),'--cpu=1','--memory=1Gi','--max-instances=2','--allow-unauthenticated','--tag=candidate','--no-traffic','--labels=managed-by=anime-shorts-v2','--quiet']
        g(*deploy)
        info=json.loads(g('run','services','describe',service,'--region',region,'--project',project,'--format=json'))
        url=info['status']['url'];env['SHORTS_PRODUCTION_URL']=url;envfile.write_text(json.dumps(env))
        # Preserve saved tariff configuration on updates; no invented defaults.
        if old and old.get('rateTable'):env['SHORTS_RATE_TABLE']=old['rateTable'];envfile.write_text(json.dumps(env))
        g(*deploy)
        info=json.loads(g('run','services','describe',service,'--region',region,'--project',project,'--format=json'))
        revision=info['status']['latestReadyRevisionName'];candidate_url=next(t['url'] for t in info['status'].get('traffic',[]) if t.get('tag')=='candidate')
        candidate={'project':project,'bucket':bucket,'region':region,'job':job,'service':service,'revision':revision,'image':immutable,'commit':sha,'url':candidate_url,'previous':old,'auth':'pending','vercel':'pending'}
        if not health(project,region,candidate):raise RuntimeError('Health de candidata falló. Se conserva la versión anterior.')
        g('run','jobs','update',job,'--region',region,'--project',project,'--env-vars-file',str(envfile),'--quiet')
        # Activation only after image self-tests and service health.
        g('run','services','update-traffic',service,'--to-revisions',revision+'=100','--region',region,'--project',project,'--quiet')
        candidate['url']=url;state_save(bucket,candidate,tmp)
        print('\nWorker instalado y probado con fixtures. Generación sigue bloqueada sin tarifas y autorización.')
        print('Configuración recuperable guardada en nube. A continuación se verifica autenticación y conexión Vercel.')
        from connect import connect
        connect(command,g,pick,candidate,lambda s:state_save(bucket,s,tmp))

def rollback(project,region,bucket):
    state=state_load(bucket);old=state.get('previous') if state else None
    if not old:raise RuntimeError('No existe versión anterior registrada. No se cambió nada.')
    if pick(f'Restaurar {old["commit"][:12]} (sin borrar datos)', ['Cancelar','Restaurar'])=='Cancelar':return
    if not health(project,region,old):raise RuntimeError('La versión anterior no pasa diagnóstico.')
    g('run','services','update-traffic',old['service'],'--to-revisions',old['revision']+'=100','--region',region,'--project',project,'--quiet')
    # Old service revision points to old immutable Job: no Job traffic assumption.
    with tempfile.TemporaryDirectory() as tmp:state_save(bucket,{**old,'previous':state},tmp)
    print('Versión anterior restaurada; datos y aprobaciones intactos.')

def main():
    if '--help' in sys.argv:
        print('./c: 1 instalar/actualizar; 2 diagnóstico; 3 rollback; 4 salir; 5 conectar/recuperar Vercel; 6 buscar actualización. Sin generaciones ocultas.');return
    while True:
        choice=pick('Cortos de anime', ['Instalar/actualizar','Diagnóstico','Restaurar versión anterior','Salir','Conectar/recuperar Vercel','Buscar actualización de la rama'])
        if choice=='Salir':return
        try:
            if choice=='Buscar actualización de la rama':
                # Fetch without checking out/resetting a dirty working directory.
                command(['git','fetch','https://github.com/Alixonveloz1-ctrl/Anime-AI-Studio.git','feature/cortos-anime-v2'],cwd=ROOT)
                latest=command(['git','rev-parse','FETCH_HEAD'],cwd=ROOT)
                current=command(['git','rev-parse','HEAD'],cwd=ROOT)
                if latest==current:print('Ya tienes el commit actual.');continue
                work=Path(tempfile.mkdtemp(prefix='anime-shorts-update-'))
                command(['git','worktree','add','--detach',str(work/'source'),latest],cwd=ROOT)
                print('Actualización aislada; tu checkout y archivos locales se conservan.')
                subprocess.run(['bash','c'],cwd=work/'source',check=True)
                continue
            account,project=account_project();region='us-central1';bucket=project+'-anime-shorts-preview'
            if choice=='Instalar/actualizar':install(account,project,region,bucket)
            elif choice=='Restaurar versión anterior':rollback(project,region,bucket)
            elif choice=='Conectar/recuperar Vercel':
                state=state_load(bucket)
                if not state:raise RuntimeError('Primero instala el worker aislado con la opción 1.')
                from connect import connect
                with tempfile.TemporaryDirectory() as tmp:connect(command,g,pick,state,lambda s:state_save(bucket,s,tmp))
            else:
                state=state_load(bucket)
                if not state:print('No hay instalación registrada.')
                else:
                    print('Commit:',state['commit']);health(project,region,state)
                    print('Autenticación:',state.get('auth','pending'),'Vercel:',state.get('vercel','pending'))
        except (RuntimeError,FileNotFoundError,ValueError) as e:print('\nNo se completó:',str(e))
if __name__=='__main__':main()
