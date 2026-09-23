import copy
import unittest
from datetime import date
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.core.pricing import catalog, call_limit, reconcile, INPUT_LIMIT
from shorts.core.jobs import reserve,settle
from shorts.service.config import config
from shorts.service.providers import Providers,tts_payload

class PricingTests(unittest.TestCase):
    def test_A077_default_install_has_all_operation_estimates(self):
        rates=catalog(config(),date(2026,9,23))
        self.assertEqual(rates['render']['generationMicros'],0)
        self.assertGreater(rates['render']['workerMicros'],0)
        self.assertEqual(rates['analyze']['calls'],{'analysis':2})
        self.assertIs(rates['veo']['generateAudio'],False)
        self.assertEqual(rates['veo']['generationMicros'],1600000)
    def test_A077_model_change_and_expired_tariff_block(self):
        c=config();c['models']['music']['model']='lyria-2'
        with self.assertRaises(ContractError):catalog(c,date(2026,9,23))
        with self.assertRaises(ContractError):catalog(config(),date(2026,10,24))
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
    def test_A077_usage_refunds_unused_reservation(self):
        j={'reservation':2000000,'started':100,'revision':1,'providerCalls':[{'state':'completed','ceilingMicros':600000,'estimatedMicros':1000}]}
        b={'reserved':2000000,'spent':0};j['cost']=reconcile(j,110)
        out,b=settle(j,b,'succeeded')
        self.assertEqual(b['reserved'],0);self.assertEqual(b['spent'],3640)
        self.assertEqual(settle(out,b,'succeeded')[1],b)
    def test_A075_unknown_keeps_reserve(self):
        j={'reservation':2000000,'providerCalls':[{'state':'submitted_unknown'}]}
        with self.assertRaises(ContractError):reconcile(j,100)
        self.assertEqual(j['reservation'],2000000)
    def test_A035_tts_byte_limit_before_transport(self):
        with self.assertRaises(ContractError):tts_payload(config(),{'japanese':'あ'*1400},{'name':'Kore'})

if __name__=='__main__':unittest.main()
