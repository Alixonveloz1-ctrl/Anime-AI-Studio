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

class WaitingQueueTests(unittest.TestCase):
    """A job refused for CAPACITY_BUSY starts on its own when the engine frees."""
    def setUp(self):
        self.c=Cloud.__new__(Cloud);self.c.c={'project':'project','region':'region','queue':'queue','job':'worker'};self.c.http=Mock()
        self.enqueued=[];self.c.enqueue=lambda row:self.enqueued.append(row['id']) or True
        self.c.db=DB({'animeShortsJobs/running':{'id':'running','owner':'u','projectId':'p','operation':'ideas','state':'running','session':'s','revision':1},
                      'animeShortsJobs/waiting':{'id':'waiting','owner':'u','projectId':'p','operation':'revise','state':'queued','session':'s','revision':1,'dispatchAttempt':0},
                      'animeShortsProjects/p':{'id':'p','owner':'u','lease':{'session':'s','expires':NOW+100}},
                      'animeShortsCapacity/text-analysis':{'jobId':'running'}})
        patcher=patch('google.cloud.firestore.transactional',side_effect=lambda fn:fn);patcher.start();self.addCleanup(patcher.stop)
        patcher=patch('shorts.service.cloud.time.time',return_value=NOW);patcher.start();self.addCleanup(patcher.stop)
    @property
    def slot(self):return self.c.db.data['animeShortsCapacity/text-analysis']

    def test_a_busy_refusal_is_remembered_and_started_when_the_engine_frees(self):
        job,dispatch=self.c.acquire_dispatch('waiting')
        self.assertFalse(dispatch);self.assertEqual(job['dispatchError']['code'],'CAPACITY_BUSY')
        self.assertEqual(self.slot['waiting'],['waiting'],'the engine remembers who is waiting')
        self.c.finish('running','awaiting_review',{})
        self.assertIsNone(self.slot['jobId']);self.assertEqual(self.slot['waiting'],[])
        self.assertEqual(self.enqueued,['waiting'],'it starts without the owner pressing anything')

    def test_closing_an_uncertain_job_also_starts_what_was_waiting(self):
        # It queues behind a job that IS executing; only afterwards does that
        # job end uncertain and get closed.
        self.c.acquire_dispatch('waiting')
        self.assertEqual(self.slot['waiting'],['waiting'])
        self.c.db.data['animeShortsJobs/running'].update(state='submitted_unknown',providerCalls=[{'kind':'text','state':'submitted_unknown'}])
        self.c.close_uncertain('running')
        self.assertEqual(self.enqueued,['waiting'])

    def test_a_job_already_dispatched_or_settled_is_not_started_again(self):
        self.c.acquire_dispatch('waiting')
        self.c.db.data['animeShortsJobs/waiting'].update(state='cancelled',settled=True)
        self.c.finish('running','awaiting_review',{})
        self.assertEqual(self.enqueued,[])

    def test_the_queue_is_bounded_and_never_repeats_a_job(self):
        for _ in range(3):self.c.acquire_dispatch('waiting')
        self.assertEqual(self.slot['waiting'],['waiting'])

    def test_an_engine_held_by_a_job_that_is_not_there_any_more_is_freed(self):
        # The slot pointed at a job record that no longer exists. Nothing could
        # ever report its outcome or free it, so every later request queued
        # behind a ghost — «Otro trabajo usa este motor» with no way out.
        self.c.db.data['animeShortsCapacity/text-analysis']={'jobId':'desaparecido'}
        job,dispatch=self.c.acquire_dispatch('waiting')
        self.assertTrue(dispatch,'el motor se libera y el trabajo arranca')
        self.assertEqual(self.slot['jobId'],'waiting')
        self.assertIsNone(job.get('dispatchError'))

    def test_an_engine_held_by_an_uncertain_submission_is_freed_without_resending_it(self):
        # The very first voice of a project reported «otro trabajo usa este
        # motor» with nothing else asked for: the engine was held by an earlier
        # submission left uncertain. Nothing executes for one of those — the
        # worker frees the engine for exactly this reason when it gets that far,
        # and a worker killed first left it held for good.
        self.c.db.data['animeShortsJobs/running'].update(state='submitted_unknown',
            providerCalls=[{'kind':'tts','state':'submitted_unknown'}])
        job,dispatch=self.c.acquire_dispatch('waiting')
        self.assertTrue(dispatch,'el motor se libera')
        self.assertEqual(self.slot['jobId'],'waiting')
        held=self.c.db.data['animeShortsJobs/running']
        self.assertFalse(held.get('settled'),'el trabajo incierto sigue abierto para su dueño')
        self.assertEqual(held['state'],'submitted_unknown','y no se reenvía ni se cierra solo')

    def test_an_engine_held_by_a_job_that_is_still_running_keeps_protecting_it(self):
        # The opposite case must not change: something that may be executing
        # keeps its engine, however old it looks.
        job,dispatch=self.c.acquire_dispatch('waiting')
        self.assertFalse(dispatch)
        self.assertEqual(job['dispatchError']['code'],'CAPACITY_BUSY')
        self.assertEqual(job['dispatchError']['blockingJobId'],'running')
