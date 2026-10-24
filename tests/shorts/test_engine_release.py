"""An uncertain or dead generation never keeps an engine forever, and is never resent."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.core.contracts import ContractError
from shorts.core.jobs import close_uncertain
from shorts.service.app import app,SERVICE_REQUEST_LIMIT
from shorts.service.cloud import Cloud
from shorts.service.execution import execute_job
from shorts.service.providers import UnknownSubmission
from test_job_recovery import DB

NOW=10_000

class EngineReleaseTests(unittest.TestCase):
    def setUp(self):
        self.c=Cloud.__new__(Cloud);self.c.c={'project':'project','region':'region','job':'worker'};self.c.http=Mock()
        self.c.db=DB({'animeShortsJobs/j':{'id':'j','owner':'u','projectId':'p','operation':'image','state':'running','session':'s','revision':3,
                                          'executionMode':'service','started':NOW-60,'providerCalls':[]},
                      'animeShortsProjects/p':{'id':'p','owner':'u','lease':{'session':'s','expires':NOW+100}},
                      'animeShortsCapacity/image':{'jobId':'j'}})
        for target in ('google.cloud.firestore.transactional',):
            p=patch(target,side_effect=lambda fn:fn);p.start();self.addCleanup(p.stop)
        for target in ('shorts.service.cloud.time.time','shorts.service.app.time.time'):
            p=patch(target,return_value=NOW);p.start();self.addCleanup(p.stop)
        self.client=app.test_client()
    @property
    def job(self):return self.c.db.data['animeShortsJobs/j']
    @property
    def slot(self):return self.c.db.data['animeShortsCapacity/image']
    def run_with(self,error,calls):
        self.job['providerCalls']=calls
        claimed=(self.job,self.c.db.data['animeShortsProjects/p'],True)
        with patch.object(Cloud,'claim',return_value=claimed),patch('shorts.service.production.run_job',side_effect=error):execute_job(self.c,'j')
    def action(self,name):
        with patch('shorts.service.app.cloud',return_value=self.c),patch('shorts.service.app.uid',return_value='u'):
            return self.client.post(f'/jobs/j:{name}',json={'session':'s'},headers={'If-Match':str(self.job['revision'])})

    def test_uncertain_submission_frees_the_engine_and_waits_for_the_owner(self):
        self.run_with(UnknownSubmission(),[{'kind':'image','state':'submitted_unknown'}])
        self.assertEqual(self.job['state'],'submitted_unknown');self.assertFalse(self.job.get('settled'))
        self.assertIsNone(self.slot['jobId'],'nothing runs for it any more: other jobs may use the engine')

    def test_a_failure_after_every_call_finished_is_a_plain_failure(self):
        # e.g. Firestore rejecting the asset document after a paid TTS call.
        self.run_with(RuntimeError('Cannot convert an array value in an array value'),[{'kind':'tts','state':'completed'}])
        self.assertEqual(self.job['state'],'failed');self.assertTrue(self.job['settled'])
        self.assertEqual(self.job['result']['code'],'SAVE_FAILED');self.assertIsNone(self.slot['jobId'])

    def test_an_exception_during_a_call_stays_uncertain_but_frees_the_engine(self):
        self.run_with(RuntimeError('connection reset'),[{'kind':'image','state':'submitted_unknown'}])
        self.assertEqual(self.job['state'],'submitted_unknown');self.assertIsNone(self.slot['jobId'])

    def test_owner_closes_an_uncertain_job_without_any_new_call(self):
        self.job.update(state='submitted_unknown',providerCalls=[{'kind':'image','state':'submitted_unknown','requestHash':'h'}])
        r=self.action('close')
        self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(self.job['state'],'failed');self.assertTrue(self.job['settled'])
        self.assertEqual(self.job['result']['code'],'CLOSED_UNCERTAIN')
        self.assertEqual(self.job['providerCalls'],[{'kind':'image','state':'abandoned_unknown','requestHash':'h'}],'the journal keeps the call')
        self.assertIsNone(self.slot['jobId']);self.c.http.post.assert_not_called()
        self.assertEqual(self.action('close').status_code,409,'a closed job cannot be closed twice')

    def test_only_uncertain_jobs_can_be_closed(self):
        for state in ('queued','running','awaiting_review'):
            with self.assertRaises(ContractError):close_uncertain({'state':state,'revision':1,'providerCalls':[]})
        self.assertEqual(self.action('close').status_code,409);self.assertEqual(self.job['state'],'running')

    def test_inspect_closes_a_service_job_that_outlived_cloud_run(self):
        self.job.update(started=NOW-SERVICE_REQUEST_LIMIT-1)
        r=self.action('inspect')
        self.assertEqual(r.json['state'],'failed');self.assertTrue(self.job['settled']);self.assertIsNone(self.slot['jobId'])

    def test_inspect_marks_a_dead_service_call_uncertain_and_frees_the_engine(self):
        self.job.update(state='cancel_requested',started=NOW-SERVICE_REQUEST_LIMIT-1,providerCalls=[{'kind':'image','state':'submitted_unknown'}])
        r=self.action('inspect')
        self.assertEqual(r.json['state'],'submitted_unknown');self.assertFalse(self.job.get('settled'));self.assertIsNone(self.slot['jobId'])

    def test_inspect_never_touches_a_service_job_that_may_still_run(self):
        r=self.action('inspect')
        self.assertEqual(r.json['state'],'running');self.assertEqual(self.slot['jobId'],'j');self.assertEqual(self.job['state'],'running')

if __name__=='__main__':unittest.main()
