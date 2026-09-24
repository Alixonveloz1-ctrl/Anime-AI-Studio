import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location('shorts_install',Path(__file__).resolve().parents[2]/'infra/shorts/install.py');install=importlib.util.module_from_spec(spec);spec.loader.exec_module(install)
ROOT=Path(__file__).resolve().parents[2]
class InstallerTests(unittest.TestCase):
    def test_A093_update_bucket_with_existing_conditional_builder_binding(self):
        # Updating an installed bucket must not prompt for a condition or
        # remove the builder's existing restriction to build-source/.
        condition="expression=resource.name.startsWith('projects/_/buckets/owned-bucket/objects/build-source/'),title=shorts-build-source"
        builder='serviceAccount:anime-shorts-preview-build@project.iam.gserviceaccount.com'
        runtime='serviceAccount:anime-shorts-preview@project.iam.gserviceaccount.com'
        policy={(builder,'roles/storage.objectViewer',condition)}
        def g(*args,**kwargs):
            if args[:2]==('billing','projects'):return '{"billingEnabled":true}'
            if args[:3]==('storage','buckets','add-iam-policy-binding'):
                flags=dict(x[2:].split('=',1) for x in args if x.startswith('--') and '=' in x)
                if 'condition' not in flags:
                    raise RuntimeError('Adding a binding without specifying a condition to a policy containing conditions is prohibited in non-interactive mode')
                self.assertEqual(args[3],'gs://owned-bucket')
                policy.add((flags['member'],flags['role'],flags['condition']))
            return ''
        with patch.object(install,'current_release',return_value='a'*40),patch.object(install,'g',side_effect=g),patch.object(install,'check_owned',return_value=True),patch.object(install,'state_load',return_value={'commit':'old'}),patch.object(install,'pick',return_value='Autorizar instalación/actualización'),patch.object(install,'command'),patch.object(install,'exists',return_value=True),patch.object(install,'build_config',side_effect=RuntimeError('fixture stop before build')),patch.object(install,'activate') as activate:
            for _ in range(2):
                with self.assertRaisesRegex(RuntimeError,'fixture stop before build'):
                    install.install('account','project','us-central1','owned-bucket')
            activate.assert_not_called()
        self.assertEqual(policy,{(builder,'roles/storage.objectViewer',condition),(runtime,'roles/storage.objectAdmin','None')})

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

    def test_A091_environment_uses_individual_json_objects_and_upsert(self):
        values={'SHORTS_ENABLED':'true','SHORTS_FIREBASE_WEB_CONFIG':'{"apiKey":"fixture"}','STUDIO_ALLOWED_EMAILS':'owner@example.com'}
        with patch.object(self.c,'vercel',return_value={}) as api:
            self.c.branch_vars(None,'project','team',values)
        self.assertEqual(api.call_count,len(values))
        for call,(key,value) in zip(api.call_args_list,values.items()):
            self.assertIn('upsert=true',call.args[1]);self.assertIn('teamId=team',call.args[1])
            self.assertEqual(call.args[2],'POST')
            self.assertEqual(call.args[3],{'key':key,'value':value,'type':'encrypted','target':['production']})

    def test_A091_pinned_cli_receives_private_json_file(self):
        payload={'key':'SHORTS_ENABLED','value':'true','type':'encrypted','target':['production']}
        paths=[]
        def run(args,**kwargs):
            self.assertEqual(args[:3],['npx','--yes','vercel@59.25.4'])
            self.assertIn('--non-interactive',args)
            path=Path(args[args.index('--input')+1]);paths.append(path)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads(path.read_text()),payload)
            self.assertEqual(kwargs['stdin'],subprocess.DEVNULL)
            self.assertEqual(kwargs['timeout'],120)
            self.assertEqual(kwargs['env']['NO_UPDATE_NOTIFIER'],'1')
            return subprocess.CompletedProcess(args,0,'{"created":[]}','')
        with patch.object(self.c.subprocess,'run',side_effect=run):
            self.assertEqual(self.c.vercel(None,'/fixture','POST',payload),{'created':[]})
        self.assertFalse(paths[0].exists())

    def test_A091_cli_rejects_top_level_arrays_before_execution(self):
        with patch.object(self.c.subprocess,'run') as run:
            with self.assertRaisesRegex(ValueError,'no una lista'):
                self.c.vercel(None,'/fixture','POST',[{'key':'SHORTS_ENABLED'}])
            run.assert_not_called()

    def test_A092_vercel_error_keeps_reason_but_never_values(self):
        cfg='{"apiKey":"private-fixture-key","appId":"private-fixture-app"}'
        payload={'key':'SHORTS_FIREBASE_WEB_CONFIG','value':cfg}
        stdout=json.dumps({'error':{'code':'bad_request','message':'Invalid JSON '+cfg},'value':'stdout-never-print'})
        stderr='Error: HTTP 400 Bearer bearer-secret vcp_vercel-secret apiKey="private-fixture-key"'
        result=subprocess.CompletedProcess([],1,stdout,stderr)
        with patch.object(self.c.subprocess,'run',return_value=result) as run:
            with self.assertRaises(RuntimeError) as caught:
                self.c.vercel(None,'/v10/projects/p/env','POST',payload)
        message=str(caught.exception)
        self.assertIn('POST /v10/projects/p/env',message)
        self.assertIn('bad_request',message);self.assertIn('Invalid JSON',message)
        for secret in ('private-fixture-key','private-fixture-app','stdout-never-print','bearer-secret','vcp_vercel-secret'):
            self.assertNotIn(secret,message)
        self.assertEqual(run.call_count,1)

    def test_A092_vercel_timeout_and_invalid_response_do_not_retry(self):
        for outcome in (subprocess.TimeoutExpired(['npx'],120),subprocess.CompletedProcess([],0,'<html>private-body</html>','')):
            with self.subTest(outcome=type(outcome).__name__):
                with patch.object(self.c.subprocess,'run',side_effect=[outcome] if isinstance(outcome,Exception) else None,return_value=outcome) as run:
                    with self.assertRaises(RuntimeError) as caught:
                        self.c.vercel(None,'/v13/deployments','POST',{'name':'fixture'})
                self.assertEqual(run.call_count,1);self.assertNotIn('private-body',str(caught.exception))

    def test_A092_environment_failure_stops_before_later_variables(self):
        with patch.object(self.c,'vercel',side_effect=[{},RuntimeError('fixture rejected')]) as api:
            with self.assertRaisesRegex(RuntimeError,'fixture rejected'):
                self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true','SHORTS_ENVIRONMENT':'production','STUDIO_ALLOWED_EMAILS':'owner@example.com'})
        self.assertEqual(api.call_count,2)

    def test_A092_environment_failure_cannot_start_deployment(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        state={'project':'gcp','bucket':'b','url':'https://fixture.invalid','commit':'a'*40,'revision':'r','region':'us-central1'}
        def g(*args):
            if args[:2]==('auth','list'):return 'owner@example.com'
            return json.dumps({'spec':{'containers':[{'env':[{'name':'SHORTS_ALLOWED_EMAILS','value':'owner@example.com'}]}]}})
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'connection_release',return_value='a'*40),patch.object(self.c,'firebase',return_value={'projectId':'gcp'}),patch.object(self.c,'branch_vars',side_effect=RuntimeError('env rejected')),patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'env rejected'):
                self.c.connect(None,g,lambda *_:'Autorizar conexión',state,Mock())
            api.assert_not_called()

    def test_A092_google_rejection_retains_reason_and_selected_quota_project(self):
        token='private-oauth-value'
        body={'error':{'status':'PERMISSION_DENIED','message':'Quota project required. Bearer '+token,
                       'details':[{'reason':'USER_PROJECT_DENIED','metadata':{'access_token':'metadata-secret'}}]},
              'config':{'apiKey':'config-secret'}}
        error=self.c.urllib.error.HTTPError('https://firebase.googleapis.com',403,'Forbidden',{},io.BytesIO(json.dumps(body).encode()))
        with patch.object(self.c.urllib.request,'urlopen',side_effect=error) as request:
            with self.assertRaises(RuntimeError) as caught:
                self.c.google(lambda *_:token,'firebase.googleapis.com','/v1beta1/projects/selected:addFirebase','POST',{},project='selected')
        message=str(caught.exception)
        self.assertIn('POST firebase.googleapis.com',message)
        self.assertIn('USER_PROJECT_DENIED',message);self.assertIn('Quota project required',message)
        for secret in (token,'metadata-secret','config-secret'):self.assertNotIn(secret,message)
        self.assertEqual(request.call_count,1)
        self.assertEqual(request.call_args.args[0].get_header('X-goog-user-project'),'selected')

    def test_A092_missing_flag_only_accepts_google_404(self):
        for status in (404,403,500):
            with self.subTest(status=status):
                error=self.c.urllib.error.HTTPError('https://firebase.googleapis.com',status,'error',{},io.BytesIO(b'{}'))
                with patch.object(self.c.urllib.request,'urlopen',side_effect=error):
                    if status==404:
                        self.assertIsNone(self.c.google(lambda *_:'token','firebase.googleapis.com','/v1beta1/projects/p',missing=True,project='p'))
                    else:
                        with self.assertRaises(RuntimeError):
                            self.c.google(lambda *_:'token','firebase.googleapis.com','/v1beta1/projects/p',missing=True,project='p')

    def test_A092_google_error_redacts_credentials_and_handles_non_json(self):
        detail=self.c.google_detail({'message':'Bearer secret ya29.access AIzaFirebaseKey refresh_token="refresh-secret" apiKey="api-secret" -----BEGIN PRIVATE KEY-----key-material-----END PRIVATE KEY-----'})
        for secret in ('Bearer secret','ya29.access','AIzaFirebaseKey','refresh-secret','api-secret','key-material'):
            self.assertNotIn(secret,detail)
        error=self.c.urllib.error.HTTPError('https://firebase.googleapis.com',403,'error',{},io.BytesIO(b'<html>private server response</html>'))
        with patch.object(self.c.urllib.request,'urlopen',side_effect=error):
            with self.assertRaisesRegex(RuntimeError,'no devolvió un diagnóstico legible'):
                self.c.google(lambda *_:'token','firebase.googleapis.com','/v1beta1/projects/p',project='p')

    def test_A091_firebase_setup_keeps_project_through_operations_and_identity(self):
        responses=[None,{'name':'operations/firebase-add'}, {'done':True,'response':{}},
                   {'apps':[]},{'name':'operations/web-add'},
                   {'done':True,'response':{'name':'projects/chosen/webApps/app'}},
                   {'apiKey':'public-config','authDomain':'chosen.firebaseapp.com','projectId':'chosen','appId':'app'},
                   {'enabled':True}]
        with patch.object(self.c,'google',side_effect=responses) as api,patch.object(self.c.time,'sleep'):
            result=self.c.firebase(None,None,'chosen')
        self.assertEqual(result['projectId'],'chosen')
        self.assertEqual(len(api.call_args_list),8)
        for call in api.call_args_list:self.assertEqual(call.kwargs['project'],'chosen')
        self.assertEqual(api.call_args_list[2].args[2],'/v1beta1/operations/firebase-add')
        self.assertEqual(api.call_args_list[-1].args[1],'identitytoolkit.googleapis.com')

    def test_A093_connector_update_reuses_worker_only_for_allowed_changes(self):
        changed='infra/shorts/connect.py\ntests/shorts/test_installer.py\ndocs/shorts/audit.md\napi/_lib/access.js\napi/image.js\nauth/client.mjs\nlogin/index.html\nindex.html\nmiddleware.js\ncortos/app.js'
        command=Mock(side_effect=['b'*40+'\trefs/heads/main','b'*40,'',changed])
        self.assertEqual(self.c.connection_release(command,'a'*40),'b'*40)
        self.assertTrue(all(call.args[0][0]=='git' for call in command.call_args_list))
        self.assertIn('--is-ancestor',command.call_args_list[2].args[0])

    def test_A093_worker_or_runtime_changes_still_require_installation(self):
        for changed in ('shorts/service/app.py','worker/montage-shorts/Dockerfile','infra/shorts/install.py','shorts/core/timing.py','shorts/gateway.mjs','vercel.json'):
            with self.subTest(changed=changed):
                command=Mock(side_effect=['b'*40+'\trefs/heads/main','b'*40,'',changed])
                with self.assertRaisesRegex(RuntimeError,'después 1'):
                    self.c.connection_release(command,'a'*40)
        command=Mock(side_effect=['b'*40+'\trefs/heads/main','b'*40,RuntimeError('not ancestor')])
        with self.assertRaisesRegex(RuntimeError,'después 1'):
            self.c.connection_release(command,'a'*40)

    def test_A092_firebase_rejection_cannot_change_vercel_environment(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        state={'project':'gcp','commit':'a'*40}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase',side_effect=RuntimeError('403 Firebase')),patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'403 Firebase'):
                self.c.connect(lambda *_:'a'*40+'\trefs/heads/main',None,lambda *_:'Autorizar conexión',state,None)
            api.assert_not_called()
    def test_A086_environment_is_branch_preview_only(self):
        with patch.object(self.c,'vercel',return_value={}) as api:
            self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true'},target='preview',branch='feature/cortos-anime-v2')
            row=api.call_args.args[-1]
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
            for call in api.call_args_list:
                row=call.args[-1]
                self.assertEqual(row['target'],['production']);self.assertNotIn('gitBranch',row)
        with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{},branch='other')

    def test_U003_wrong_production_branch_stops_before_configuration(self):
        project={'id':'p','name':'site','link':{'productionBranch':'different','repoId':1}}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase') as firebase,patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'publicar main'):self.c.connect(None,None,None,{'commit':'a'*40},None)
            firebase.assert_not_called();api.assert_not_called()

    def test_U003_connect_targets_main_and_existing_production_alias(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        state={'project':'gcp','bucket':'own-bucket','url':'https://service.run.app','commit':'a'*40,'revision':'installed-revision','region':'us-central1'}
        deployment={'id':'d','url':'unique.vercel.app','readyState':'READY','alias':['site.vercel.app','site-git-main-owner.vercel.app']}
        calls=[];cors=[];google_calls=[]
        def api(command,path,method='GET',data=None):
            calls.append((path,method,data))
            return deployment if path.startswith('/v13/deployments') else {}
        def g(*args):
            if args[:2]==('auth','list'):return 'owner@example.com'
            if args[:3]==('run','revisions','describe'):return json.dumps({'spec':{'containers':[{'env':[{'name':'SHORTS_ALLOWED_EMAILS','value':'owner@example.com'}]}]}})
            if '--cors-file' in args:cors.append(json.loads(Path(args[-1]).read_text()))
            return '{"cors":[]}'
        def google(g,host,path,method='GET',data=None,*,project):
            self.assertEqual(project,'gcp')
            google_calls.append((method,data));return {'authorizedDomains':['existing.example']}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase',return_value={'projectId':'gcp'}),patch.object(self.c,'vercel',side_effect=api),patch.object(self.c,'google',side_effect=google):
            result=self.c.connect(lambda *_:'a'*40+'\trefs/heads/main',g,lambda *_:'Autorizar conexión',state,lambda s:None)
        create=next(data for path,method,data in calls if path.startswith('/v13/deployments') and method=='POST')
        self.assertEqual(create['target'],'production');self.assertEqual(create['gitSource']['ref'],'main');self.assertEqual(create['gitSource']['sha'],'a'*40)
        env=[data for path,method,data in calls if path.startswith('/v10/projects')]
        self.assertTrue(all((row['key'].startswith('SHORTS_') or row['key']=='STUDIO_ALLOWED_EMAILS') and row['target']==['production'] for row in env))
        self.assertEqual(next(row['value'] for row in env if row['key']=='STUDIO_ALLOWED_EMAILS'),'owner@example.com')
        self.assertEqual(result['siteUrl'],'https://site.vercel.app');self.assertEqual(result['vercel'],'production_ready')
        domains=next(data['authorizedDomains'] for method,data in google_calls if method=='PATCH')
        self.assertIn('existing.example',domains);self.assertIn('site.vercel.app',domains)
        self.assertIn('https://site.vercel.app',cors[0][0]['origin'])

        # A compatible connector update publishes current main but preserves the
        # actual immutable worker commit for health checks and rollback.
        calls.clear()
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'connection_release',return_value='b'*40),patch.object(self.c,'firebase',return_value={'projectId':'gcp'}),patch.object(self.c,'vercel',side_effect=api),patch.object(self.c,'google',side_effect=google):
            result=self.c.connect(None,g,lambda *_:'Autorizar conexión',state,lambda s:None)
        create=next(data for path,method,data in calls if path.startswith('/v13/deployments') and method=='POST')
        self.assertEqual(create['gitSource']['sha'],'b'*40)
        self.assertEqual(result['commit'],'a'*40);self.assertEqual(result['siteCommit'],'b'*40)

    def test_U003_reconnection_cannot_publish_an_outdated_worker_commit(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'firebase') as firebase,patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'Elige 6'):
                self.c.connect(lambda *_:'b'*40+'\trefs/heads/main',None,None,{'commit':'a'*40},None)
            firebase.assert_not_called();api.assert_not_called()

    def test_U005_private_owner_is_only_new_shared_environment_setting(self):
        with patch.object(self.c,'vercel',return_value={}) as api:
            self.c.branch_vars(None,'project','team',{'STUDIO_ALLOWED_EMAILS':'owner@example.com'})
            self.assertEqual(api.call_args.args[-1]['key'],'STUDIO_ALLOWED_EMAILS')
            for key in ('STUDIO_DISABLE_AUTH','GCS_OUTPUT_BUCKET','GCP_SERVICE_ACCOUNT'):
                with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{key:'value'})

    def test_U005_mismatching_cloud_owner_cannot_change_site_access(self):
        project={'id':'p','name':'site','link':{'productionBranch':'main','repoId':1}}
        state={'project':'gcp','bucket':'b','url':'https://service.run.app','commit':'a'*40,'revision':'r','region':'us-central1'}
        def g(*args):
            if args[:2]==('auth','list'):return 'other@example.com'
            return json.dumps({'spec':{'containers':[{'env':[{'name':'SHORTS_ALLOWED_EMAILS','value':'owner@example.com'}]}]}})
        with patch.object(self.c,'find_project',return_value=(project,'team')),patch.object(self.c,'connection_release',return_value='a'*40),patch.object(self.c,'firebase',return_value={'projectId':'gcp'}),patch.object(self.c,'vercel') as api:
            with self.assertRaisesRegex(RuntimeError,'no coincide'):
                self.c.connect(None,g,lambda *_:'Autorizar conexión',state,None)
            api.assert_not_called()
