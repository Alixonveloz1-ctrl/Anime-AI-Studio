import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"worker/montage-shorts"))
from unittest.mock import Mock,patch
from shorts.service.providers import Providers,UnknownSubmission,quota_delay
from shorts.service.config import config
from shorts.core.contracts import ContractError
from shorts.core.requests import check_call_scope
from shorts.service.cloud import RequestJournal


def response(status,headers=None,data=None):
    return Mock(status_code=status,ok=status==200,headers=headers or {},json=lambda:data or {'ok':True})

class Meter:
    def __init__(self):self.calls=[];self.waits=[];self.paces=0
    def pace_text(self):self.paces+=1
    def begin_call(self,kind,url,payload):
        check_call_scope('develop',self.calls,kind)
        self.calls.append({'kind':kind,'state':'submitted_unknown'});return len(self.calls)
    def end_call(self,cid,state):self.calls[cid-1]['state']=state
    def wait_for_provider(self,*args):self.waits.append(args)

class QuotaTests(unittest.TestCase):
    def test_retries_same_request_until_success_once(self):
        session=Mock();session.post.side_effect=[response(429),response(429),response(200)]
        meter=Meter();p=Providers(config(),session,meter)
        with patch('shorts.service.providers.random.uniform',return_value=0):self.assertEqual(p.post('url',{'prompt':'same'},'text'),{'ok':True})
        self.assertEqual([w[0] for w in meter.waits],[60,120]);self.assertEqual(meter.paces,3)
        self.assertEqual([c['state'] for c in meter.calls],['quota_rejected','quota_rejected','completed'])
        self.assertTrue(all(c.kwargs['json']=={'prompt':'same'} for c in session.post.call_args_list))
        with self.assertRaises(ContractError):check_call_scope('develop',meter.calls,'text')
    def test_quota_exhaustion_is_finite(self):
        session=Mock();session.post.return_value=response(429);meter=Meter()
        with patch('shorts.service.providers.random.uniform',return_value=0),self.assertRaises(ContractError) as error:Providers(config(),session,meter).post('url',{},'text')
        self.assertEqual(error.exception.code,'PROVIDER_QUOTA');self.assertEqual(session.post.call_count,4)
        self.assertEqual([w[0] for w in meter.waits],[60,120,240])
        with self.assertRaises(ContractError):check_call_scope('develop',meter.calls,'text')
    def test_unknown_result_never_retried(self):
        for failure in (TimeoutError(),response(503)):
            s=Mock();s.post.side_effect=[response(429),failure];m=Meter()
            with self.assertRaises(UnknownSubmission):Providers(config(),s,m).post('url',{},'text')
            self.assertEqual(s.post.call_count,2);self.assertEqual(m.calls[-1]['state'],'submitted_unknown')
    def test_other_rejection_does_not_retry(self):
        s=Mock();s.post.return_value=response(403);m=Meter()
        with self.assertRaises(ContractError):Providers(config(),s,m).post('url',{},'text')
        self.assertEqual(s.post.call_count,1);self.assertFalse(m.waits)
    def test_retry_after_and_retry_info_respected(self):
        with patch('shorts.service.providers.random.uniform',return_value=0):
            self.assertEqual(quota_delay(response(429,{'Retry-After':'150'}),0),150)
            self.assertEqual(quota_delay(response(429,data={'error':{'details':[{'@type':'type.googleapis.com/google.rpc.RetryInfo','retryDelay':'180s'}]}}),0),180)
        s=Mock();s.post.return_value=response(429,{'Retry-After':'86400'});m=Meter()
        with self.assertRaises(ContractError):Providers(config(),s,m).post('url',{},'text')
        self.assertEqual(s.post.call_count,1);self.assertFalse(m.waits)
    def test_cancel_during_wait_prevents_another_submission(self):
        s=Mock();s.post.return_value=response(429);m=Mock();m.wait_for_provider.side_effect=ContractError('CANCELLED','cancel')
        with self.assertRaises(ContractError):Providers(config(),s,m).post('url',{},'text')
        self.assertEqual(s.post.call_count,1)
    def test_token_preflight_can_wait_without_spending_generation_slot(self):
        s=Mock();s.post.side_effect=[response(429),response(200,data={'totalTokens':10}),response(200,data={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'{"title":"ok"}'}]}}]})];m=Meter()
        self.assertEqual(Providers(config(),s,m).text('prompt'),{'title':'ok'})
        self.assertEqual(len(m.calls),1);self.assertEqual(len(m.waits),1)
    def test_cancel_wait_settles_as_cancelled(self):
        from shorts.service.execution import execute_text
        c=Mock();c.claim.return_value=({'id':'j'}, {}, True)
        with patch('shorts.service.production.run_job',side_effect=ContractError('CANCELLED','cancel')):execute_text(c,'j')
        self.assertEqual(c.finish.call_args.args[1],'cancelled')
    def test_shared_pacing_reserves_minute_between_jobs(self):
        c=Mock();ref=c.db.collection.return_value.document.return_value;ref.get.return_value.to_dict.return_value={'nextAt':150}
        journal=RequestJournal(c,'j');journal.wait_for_provider=Mock()
        with patch('shorts.service.cloud.firestore.transactional',side_effect=lambda fn:fn),patch('shorts.service.cloud.time.time',return_value=100):journal.pace_text()
        c.db.transaction.return_value.set.assert_called_once_with(ref,{'nextAt':210})
        journal.wait_for_provider.assert_called_once_with(50,'spacing')
    def test_wait_checks_cancel_and_session_loss(self):
        for state,expiry,code in [('cancel_requested',200,'CANCELLED'),('running',99,'LEASE')]:
            c=Mock();ref=c.db.collection.return_value.document.return_value;ref.get.return_value.to_dict.return_value={'state':state,'projectId':'p','session':'s'}
            c.project_ref.return_value.get.return_value.to_dict.return_value={'lease':{'session':'s','expires':expiry}}
            with patch('shorts.service.cloud.time.time',return_value=100),patch('shorts.service.cloud.time.sleep') as sleep,self.assertRaises(ContractError) as error:RequestJournal(c,'j').wait_for_provider(60,'quota',1)
            self.assertEqual(error.exception.code,code);sleep.assert_not_called()

if __name__=='__main__':unittest.main()
