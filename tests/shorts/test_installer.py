import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('shorts_install',Path(__file__).resolve().parents[2]/'infra/shorts/install.py');install=importlib.util.module_from_spec(spec);spec.loader.exec_module(install)
ROOT=Path(__file__).resolve().parents[2]
class InstallerTests(unittest.TestCase):
    def test_A092_storage_failure_keeps_google_reason_without_retry(self):
        reason='ERROR: Service account new@fixture.iam.gserviceaccount.com does not exist.'
        result=subprocess.CompletedProcess([],1,'not a diagnostic',reason)
        with patch.object(install.subprocess,'run',return_value=result) as run:
            with self.assertRaises(RuntimeError) as error:
                install.command(['gcloud','storage','buckets','add-iam-policy-binding','gs://fixture'])
        self.assertIn('storage buckets add-iam-policy-binding',str(error.exception))
        self.assertIn(reason,str(error.exception));self.assertNotIn('not a diagnostic',str(error.exception))
        self.assertEqual(run.call_count,1)

    def test_A092_google_diagnostic_redacts_credentials(self):
        raw='PERMISSION_DENIED\nAuthorization: Bearer secret-token\naccess_token="another-secret"\nrefresh_token=refresh-secret\nya29.google-secret\n-----BEGIN PRIVATE KEY-----\\nprivate-material\\n-----END PRIVATE KEY-----'
        safe=install.google_error(raw)
        self.assertIn('PERMISSION_DENIED',safe)
        for secret in ('secret-token','another-secret','refresh-secret','google-secret','private-material'):
            self.assertNotIn(secret,safe)

    def test_A092_resource_check_cannot_wait_for_hidden_input(self):
        result=subprocess.CompletedProcess([],1,'','ERROR: NOT_FOUND: resource does not exist')
        with patch.object(install.subprocess,'run',return_value=result) as run,patch('sys.stdout',new_callable=io.StringIO) as output:
            self.assertFalse(install.exists('firestore','databases','describe','fixture'))
            self.assertIn('Comprobando: base de datos',output.getvalue())
        self.assertIn('--quiet',run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['stdin'],subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs['timeout'],90)

    def test_A092_permission_failure_is_not_an_absent_resource(self):
        result=subprocess.CompletedProcess([],1,'','PERMISSION_DENIED: caller cannot inspect resource')
        with patch.object(install.subprocess,'run',return_value=result):
            with self.assertRaisesRegex(RuntimeError,'No se pudo comprobar'):
                install.exists('run','services','describe','fixture')

    def test_A092_read_timeout_stops_namespace_checks(self):
        with patch.object(install.subprocess,'run',side_effect=subprocess.TimeoutExpired(['gcloud'],90)) as run:
            with self.assertRaisesRegex(RuntimeError,'Google no respondió'):
                install.check_fresh_namespace('fixture','us-central1')
        self.assertEqual(run.call_count,1)

    def test_A092_google_noninteractive_preserves_vercel_browser_login(self):
        result=subprocess.CompletedProcess([],0,'{}','')
        with patch.object(install.subprocess,'run',return_value=result) as run:
            install.command(['gcloud','services','enable','example.googleapis.com'])
            self.assertEqual(run.call_args.kwargs['stdin'],subprocess.DEVNULL)
            self.assertIn('--quiet',run.call_args.args[0])
            install.command(['npx','vercel','login'],capture=False)
            self.assertIsNone(run.call_args.kwargs['stdin'])
            self.assertNotIn('--quiet',run.call_args.args[0])

    def test_A092_google_timeout_does_not_repeat_uncertain_change(self):
        with patch.object(install.subprocess,'run',side_effect=subprocess.TimeoutExpired(['gcloud'],300)) as run:
            with self.assertRaisesRegex(RuntimeError,'no se repetirá automáticamente'):
                install.command(['gcloud','services','enable','example.googleapis.com'])
        self.assertEqual(run.call_count,1)

    def test_A092_authorized_api_enable_precedes_namespace_queries(self):
        events=[]
        def g(*args,**kwargs):
            events.append(args)
            return '{"billingEnabled":true}' if args[:2]==('billing','projects') else ''
        def namespace(*args):
            self.assertIn(('services','enable','firestore.googleapis.com','--project','fixture','--quiet'),events)
            raise RuntimeError('fixture stop before resource creation')
        with patch.object(install,'current_release',return_value='a'*40),patch.object(install,'g',side_effect=g),patch.object(install,'check_owned',return_value=False),patch.object(install,'pick',return_value='Autorizar instalación/actualización'),patch.object(install,'command'),patch.object(install,'check_fresh_namespace',side_effect=namespace):
            with self.assertRaisesRegex(RuntimeError,'fixture stop'):
                install.install('account','fixture','us-central1','fixture-bucket')

    def test_A087_launcher(self):
        r=subprocess.run(['bash','c','--help'],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(r.returncode,0);self.assertIn('./c',r.stdout)
    def test_A090_old_installers_unchanged(self):
        sha='958248ec2fe90fb4a2b0b5004d2a53642a274995'
        for f in ('setup.sh','i','worker/montage/runner.sh','worker/montage/Dockerfile'):
            old=subprocess.check_output(['git','show',f'{sha}:{f}'],cwd=ROOT)
            self.assertEqual((ROOT/f).read_bytes(),old)
    def test_A089_failed_health_cannot_rollback(self):
        state={'previous':{'commit':'abc123','job':'old-job','service':'old','revision':'r1','bucket':'b','url':'https://example.invalid'}}
        with patch.object(install,'state_load',return_value=state),patch.object(install,'pick',return_value='Restaurar'),patch.object(install,'health',return_value=False),patch.object(install,'g') as g:
            with self.assertRaises(RuntimeError):install.rollback('p','us-central1','b')
            g.assert_not_called()
    def test_A089_rollback_restores_old_revision_pointer(self):
        old={'commit':'abc123','job':'old-job','service':'service','revision':'old-r','bucket':'b','url':'https://example.invalid'}
        with patch.object(install,'state_load',return_value={'previous':old}),patch.object(install,'pick',return_value='Restaurar'),patch.object(install,'health',return_value=True),patch.object(install,'g') as g,patch.object(install,'state_save') as save:
            install.rollback('p','us-central1','b')
            self.assertIn('old-r=100',g.call_args.args);self.assertEqual(save.call_args.args[1]['job'],'old-job')
    def test_A090_refuses_foreign_bucket(self):
        with patch.object(install,'exists',return_value=True),patch.object(install,'g',return_value='{"labels":{}}'):
            with self.assertRaisesRegex(RuntimeError,'no pertenece'):install.check_owned('b','p')
    def test_A090_refuses_unowned_namespace(self):
        with patch.object(install,'exists',side_effect=lambda *args:args[0]=='firestore'),patch.object(install,'g') as g:
            with self.assertRaisesRegex(RuntimeError,'sin registro de propiedad'):install.check_fresh_namespace('p','us-central1')
            g.assert_not_called()
    def test_A094_cancel_before_infrastructure(self):
        calls=[]
        def g(*args,**kw):calls.append(args);return '{"billingEnabled":true}'
        with patch.object(install,'g',side_effect=g),patch.object(install,'command',return_value='a'*40),patch.object(install,'check_owned',return_value=False),patch.object(install,'pick',return_value='Cancelar'):
            install.install('account','project','us-central1','bucket')
        self.assertEqual(len(calls),1);self.assertEqual(calls[0][:2],('billing','projects'))

    def test_U003_outdated_checkout_stops_before_cloud_changes(self):
        with patch.object(install,'command',side_effect=['a'*40,'b'*40+'\trefs/heads/main']),patch.object(install,'g') as g:
            with self.assertRaisesRegex(RuntimeError,'Elige 6'):install.install('account','project','us-central1','bucket')
            g.assert_not_called()

    def test_A089_connection_failure_restores_old_worker(self):
        old={'commit':'old','service':'service','revision':'old-r'}
        candidate={'commit':'new','service':'service','revision':'new-r'}
        with patch.object(install,'g') as g,patch.object(install,'state_save') as save:
            with self.assertRaises(RuntimeError):install.activate('p','r','b',candidate,old,'/tmp',lambda *a:(_ for _ in ()).throw(RuntimeError('connection failed')))
            self.assertIn('old-r=100',g.call_args.args)
            self.assertEqual(save.call_args.args[1],old)

    def test_A082_builder_isolated_from_runtime_identity(self):
        with patch.object(install,'exists',return_value=True),patch.object(install,'g') as g:
            builder=install.prepare_builder('project','us-central1','owned-bucket')
        config=install.build_config('image:commit',builder)
        self.assertEqual(config['options']['logging'],'CLOUD_LOGGING_ONLY')
        self.assertEqual(config['options']['machineType'],'E2_STANDARD_2')
        self.assertEqual(config['timeout'],'1800s')
        self.assertIn('anime-shorts-preview-build@',config['serviceAccount'])
        calls=[c.args for c in g.call_args_list]
        self.assertTrue(any('--role=roles/artifactregistry.writer' in x and x[:2]==('artifacts','repositories') for x in calls))
        source=next(x for x in calls if '--role=roles/storage.objectViewer' in x)
        self.assertTrue(any('objects/build-source/' in value for value in source))
        self.assertFalse(any('--role=roles/editor' in x or '--role=roles/owner' in x for x in calls))

class ConnectorTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('shorts_connect',ROOT/'infra/shorts/connect.py')
        self.c=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.c)
    def test_A086_environment_is_branch_preview_only(self):
        with patch.object(self.c,'vercel',return_value={}) as api:
            self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true'},target='preview',branch='feature/cortos-anime-v2')
            row=api.call_args.args[-1][0]
            self.assertEqual(row['target'],['preview']);self.assertEqual(row['gitBranch'],'feature/cortos-anime-v2')
    def test_A090_cannot_overwrite_legacy_environment(self):
        with patch.object(self.c,'vercel') as api:
            with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{'GCP_SERVICE_ACCOUNT':'no'})
            api.assert_not_called()
    def test_A092_partial_environment_not_ready(self):
        with patch.object(self.c,'vercel',return_value={'failed':[{'key':'SHORTS_ENABLED'}]}):
            with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true'})

    def test_U003_production_variables_do_not_use_preview_branch_scope(self):
        with patch.object(self.c,'vercel',return_value={}) as api:
            self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true','SHORTS_ENVIRONMENT':'production'})
            for row in api.call_args.args[-1]:
                self.assertEqual(row['target'],['production']);self.assertNotIn('gitBranch',row)
        with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{},branch='other')

    def test_U003_wrong_production_branch_stops_before_configuration(self):
        project={'id':'p','name':'site','link':{'productionBranch':'different','repoId':1}}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase') as firebase,patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'publicar main'):self.c.connect(None,None,None,{'commit':'a'*40},None)
            firebase.assert_not_called();api.assert_not_called()

    def test_U003_connect_targets_main_and_existing_production_alias(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        state={'project':'gcp','bucket':'own-bucket','url':'https://service.run.app','commit':'a'*40}
        deployment={'id':'d','url':'unique.vercel.app','readyState':'READY','alias':['site.vercel.app','site-git-main-owner.vercel.app']}
        calls=[];cors=[];google_calls=[]
        def api(command,path,method='GET',data=None):
            calls.append((path,method,data))
            return deployment if path.startswith('/v13/deployments') else {}
        def g(*args):
            if '--cors-file' in args:cors.append(json.loads(Path(args[-1]).read_text()))
            return '{"cors":[]}'
        def google(g,host,path,method='GET',data=None):
            google_calls.append((method,data));return {'authorizedDomains':['existing.example']}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase',return_value={'projectId':'gcp'}),patch.object(self.c,'vercel',side_effect=api),patch.object(self.c,'google',side_effect=google):
            result=self.c.connect(lambda *_:'a'*40+'\trefs/heads/main',g,lambda *_:'Autorizar conexión',state,lambda s:None)
        create=next(data for path,method,data in calls if path.startswith('/v13/deployments') and method=='POST')
        self.assertEqual(create['target'],'production');self.assertEqual(create['gitSource']['ref'],'main');self.assertEqual(create['gitSource']['sha'],'a'*40)
        env=next(data for path,method,data in calls if path.startswith('/v10/projects'))
        self.assertTrue(all(row['key'].startswith('SHORTS_') and row['target']==['production'] for row in env))
        self.assertEqual(result['siteUrl'],'https://site.vercel.app');self.assertEqual(result['vercel'],'production_ready')
        domains=next(data['authorizedDomains'] for method,data in google_calls if method=='PATCH')
        self.assertIn('existing.example',domains);self.assertIn('site.vercel.app',domains)
        self.assertIn('https://site.vercel.app',cors[0][0]['origin'])

    def test_U003_reconnection_cannot_publish_an_outdated_worker_commit(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase') as firebase,patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'Elige 6'):
                self.c.connect(lambda *_:'b'*40+'\trefs/heads/main',None,None,{'commit':'a'*40},None)
            firebase.assert_not_called();api.assert_not_called()
