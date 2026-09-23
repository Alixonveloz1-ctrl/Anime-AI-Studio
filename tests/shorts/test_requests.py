import copy
import unittest
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.core.requests import verify_models, check_call_scope, INPUT_LIMIT
from shorts.core.jobs import settle
from shorts.service.config import config
from shorts.service.providers import Providers,tts_payload

class RequestTests(unittest.TestCase):
    def test_A077_verified_models_have_no_calendar_price_gate(self):
        verify_models(config())
    def test_A032_model_change_still_requires_verification(self):
        c=config();c['models']['music']['model']='lyria-2'
        with self.assertRaises(ContractError):verify_models(c)
    def test_A077_action_scope_limits_provider_calls(self):
        check_call_scope('image',[],'image')
        with self.assertRaises(ContractError):check_call_scope('image',[{'kind':'image','state':'completed'}],'image')
        with self.assertRaises(ContractError):check_call_scope('frames',[],'image')
    def test_A077_token_preflight_rejects_before_paid_call(self):
        session=Mock();session.post.return_value=Mock(status_code=200,ok=True,json=lambda:{'totalTokens':INPUT_LIMIT+1})
        meter=Mock()
        with self.assertRaises(ContractError):Providers(config(),session,meter).text('oversized')
        meter.begin_call.assert_not_called();self.assertEqual(session.post.call_count,1)
        self.assertTrue(session.post.call_args.args[0].endswith(':countTokens'))
    def test_A075_failure_after_submit_is_not_retried(self):
        session=Mock();session.post.side_effect=TimeoutError();meter=Mock()
        with self.assertRaises(ContractError):Providers(config(),session,meter).post('https://aiplatform.googleapis.com',{},'music')
        self.assertEqual(session.post.call_count,1);meter.end_call.assert_not_called()
    def test_A075_unknown_submission_cannot_be_closed_or_repeated(self):
        j={'revision':1,'providerCalls':[{'kind':'image','state':'submitted_unknown'}]}
        with self.assertRaises(ContractError):settle(j,'failed')
        with self.assertRaises(ContractError):check_call_scope('image',j['providerCalls'],'image')
    def test_A077_provider_journal_records_result_without_price(self):
        session=Mock();session.post.return_value=Mock(status_code=200,ok=True,json=lambda:{'status':'completed'})
        meter=Mock();meter.begin_call.return_value='call'
        Providers(config(),session,meter).post('https://aiplatform.googleapis.com',{},'music')
        meter.end_call.assert_called_once_with('call','completed')
    def test_A035_tts_byte_limit_before_transport(self):
        with self.assertRaises(ContractError):tts_payload(config(),{'japanese':'あ'*1400},{'name':'Kore'})

if __name__=='__main__':unittest.main()
