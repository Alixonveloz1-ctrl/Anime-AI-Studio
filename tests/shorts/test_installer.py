import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('shorts_install',Path(__file__).resolve().parents[2]/'infra/shorts/install.py');install=importlib.util.module_from_spec(spec);spec.loader.exec_module(install)
ROOT=Path(__file__).resolve().parents[2]
class InstallerTests(unittest.TestCase):
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
            self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true'})
            row=api.call_args.args[-1][0]
            self.assertEqual(row['target'],['preview']);self.assertEqual(row['gitBranch'],'feature/cortos-anime-v2')
    def test_A090_cannot_overwrite_legacy_environment(self):
        with patch.object(self.c,'vercel') as api:
            with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{'GCP_SERVICE_ACCOUNT':'no'})
            api.assert_not_called()
    def test_A092_partial_environment_not_ready(self):
        with patch.object(self.c,'vercel',return_value={'failed':[{'key':'SHORTS_ENABLED'}]}):
            with self.assertRaises(RuntimeError):self.c.branch_vars(None,'project','team',{'SHORTS_ENABLED':'true'})
