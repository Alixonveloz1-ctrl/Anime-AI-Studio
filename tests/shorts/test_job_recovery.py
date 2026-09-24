"""Queue/dispatch contract fixtures. No Google credentials or model calls."""
import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
from google.api_core.exceptions import PermissionDenied,AlreadyExists
from shorts.service.cloud import Cloud
from shorts.service.app import app

class Snapshot:
    def __init__(self,data):self.data=copy.deepcopy(data);self.exists=data is not None
    def to_dict(self):return copy.deepcopy(self.data)
class Ref:
    def __init__(self,db,key):self.db,self.key=db,key
    def get(self,transaction=None):
        if transaction and transaction.written:raise AssertionError('Firestore read after write')
        return Snapshot(self.db.data.get(self.key))
    def update(self,values):self.db.data[self.key].update(copy.deepcopy(values))
class Tx:
    def __init__(self,db):self.db=db;self.written=False
    def set(self,ref,values):self.written=True;self.db.data[ref.key]=copy.deepcopy(values)
    def update(self,ref,values):self.written=True;ref.update(values)
class DB:
    def __init__(self,data):self.data=copy.deepcopy(data)
    def collection(self,name):return Mock(document=lambda key:Ref(self,name+'/'+key))
    def transaction(self):return Tx(self)

class DispatchRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.c=Cloud.__new__(Cloud);self.c.c={'project':'project','region':'region','queue':'queue','job':'worker','service':'https://service.run.app','serviceAccount':'sa@example.invalid'};self.c.http=Mock()
        self.c.db=DB({'animeShortsJobs/j':{'id':'j','owner':'u','projectId':'p','operation':'ideas','state':'queued','session':'s','revision':1},'animeShortsProjects/p':{'id':'p','lease':{'session':'s','expires':200}},'animeShortsCapacity/text-analysis':{'jobId':'old'},'animeShortsJobs/old':{'id':'old','state':'running'}})
        self.client=app.test_client()
        self.txpatch=patch('google.cloud.firestore.transactional',side_effect=lambda fn:fn);self.txpatch.start();self.addCleanup(self.txpatch.stop)
        self.timepatch=patch('shorts.service.cloud.time.time',return_value=100);self.timepatch.start();self.addCleanup(self.timepatch.stop)
    def test_A074_busy_queue_records_reason_without_start_or_retry(self):
        with patch('shorts.service.app.internal_identity',return_value=self.c.c),patch('shorts.service.app.cloud',return_value=self.c):
            r=self.client.post('/internal/dispatch',json={'jobId':'j'})
        self.assertEqual(r.status_code,200);self.assertFalse(r.json['dispatched']);self.c.http.post.assert_not_called()
        j=self.c.db.data['animeShortsJobs/j'];self.assertEqual(j['dispatchError']['code'],'CAPACITY_BUSY');self.assertEqual(j['dispatchError']['blockingJobId'],'old')
    def test_A072_expired_lease_is_visible_and_resumable_not_silent(self):
        self.c.db.data['animeShortsCapacity/text-analysis']={};self.c.db.data['animeShortsProjects/p']['lease']['expires']=90
        j,send=self.c.acquire_dispatch('j');self.assertFalse(send);self.assertEqual(j['dispatchError']['code'],'LEASE');self.assertNotIn('dispatchState',j)
    def test_A077_only_settled_job_releases_stale_slot(self):
        self.c.db.data['animeShortsJobs/old'].update(state='failed',settled=True)
        j,send=self.c.acquire_dispatch('j');self.assertTrue(send);self.assertEqual(j['dispatchState'],'submitted')
        self.assertFalse(self.c.acquire_dispatch('j')[1])
    def test_A075_uncertain_slot_never_released_by_age(self):
        self.c.db.data['animeShortsJobs/old'].update(state='submitted_unknown',created=0)
        j,send=self.c.acquire_dispatch('j');self.assertFalse(send);self.assertEqual(j['dispatchError']['code'],'CAPACITY_BUSY')
        self.assertEqual(self.c.db.data['animeShortsCapacity/text-analysis']['jobId'],'old')
    def test_A078_enqueue_permission_error_visible_and_no_second_create(self):
        client=Mock();client.queue_path.return_value='projects/p/locations/r/queues/q';client.create_task.side_effect=PermissionDenied('fixture denied')
        with patch('shorts.service.cloud.tasks_v2.CloudTasksClient',return_value=client):self.assertFalse(self.c.enqueue(self.c.db.data['animeShortsJobs/j']))
        self.assertEqual(self.c.db.data['animeShortsJobs/j']['queueError']['code'],'PermissionDenied');self.assertEqual(client.create_task.call_count,1)
    def test_A074_existing_task_does_not_create_alternate_name(self):
        client=Mock();client.queue_path.return_value='projects/p/locations/r/queues/q';client.create_task.side_effect=AlreadyExists('fixture')
        with patch('shorts.service.cloud.tasks_v2.CloudTasksClient',return_value=client):self.assertTrue(self.c.enqueue(self.c.db.data['animeShortsJobs/j']))
        self.assertTrue(client.create_task.call_args.kwargs['task']['name'].endswith('/j-0'));self.assertEqual(client.create_task.call_count,1)
    def test_A075_missing_operation_is_uncertain_not_retried(self):
        self.c.db.data['animeShortsCapacity/text-analysis']={};self.c.http.post.return_value=Mock(ok=True,json=lambda:{})
        with patch('shorts.service.app.internal_identity',return_value=self.c.c),patch('shorts.service.app.cloud',return_value=self.c):
            r=self.client.post('/internal/dispatch',json={'jobId':'j'});again=self.client.post('/internal/dispatch',json={'jobId':'j'})
        self.assertEqual(r.status_code,202);self.assertTrue(r.json['unknown']);self.assertFalse(again.json['dispatched']);self.assertEqual(self.c.http.post.call_count,1)
        self.assertTrue(self.c.db.data['animeShortsJobs/j']['dispatchUnknown'])
    def test_A092_cloud_probe_starts_worker_once_not_just_queue_callback(self):
        self.c.db.data['animeShortsDiagnostics/diagnostic_test']={'check':'test'}
        self.c.http.post.return_value=Mock(ok=True,json=lambda:{'name':'projects/p/locations/r/operations/o'})
        with patch('shorts.service.app.internal_identity',return_value=self.c.c),patch('shorts.service.app.cloud',return_value=self.c):
            for _ in range(2):self.assertEqual(self.client.post('/internal/diagnostic',json={'key':'diagnostic_test'}).status_code,200)
        self.assertEqual(self.c.http.post.call_count,1)
        self.assertEqual(self.c.http.post.call_args.kwargs['json']['overrides']['containerOverrides'][0]['env'],[{'name':'SHORTS_DISPATCH_PROBE','value':'diagnostic_test'}])
        self.assertTrue(self.c.db.data['animeShortsDiagnostics/diagnostic_test']['queueDelivered'])
    def test_A092_probe_worker_has_no_provider_or_generation_claim(self):
        path=Path(__file__).resolve().parents[2]/'worker/montage-shorts';sys.path.insert(0,str(path))
        spec=importlib.util.spec_from_file_location('probe_runner',path/'runner.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
        self.c.db.data['animeShortsDiagnostics/diagnostic_test']={'check':'test'}
        with patch.dict(os.environ,{'SHORTS_DISPATCH_PROBE':'diagnostic_test','SHORTS_BUILD_COMMIT':'fixture-commit'}),patch.object(runner,'Cloud',return_value=self.c),patch.object(runner,'run_job',side_effect=AssertionError('No generations in probe')):
            runner.main()
        state=self.c.db.data['animeShortsDiagnostics/diagnostic_test'];self.assertTrue(state['workerStarted']);self.assertEqual(state['workerCommit'],'fixture-commit')

if __name__=='__main__':unittest.main()
