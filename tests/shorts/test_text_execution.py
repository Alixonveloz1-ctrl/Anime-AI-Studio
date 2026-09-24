"""Text dispatch never launches a second Cloud Run job or retries Gemini."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.service.app import app
from shorts.service.execution import execute_text
from shorts.service.providers import UnknownSubmission
from shorts.core.contracts import ContractError

class TextExecutionTests(unittest.TestCase):
    def test_direct_text_dispatch_is_authenticated_and_claimed(self):
        for op in ('ideas','develop','revise'):
            c=Mock();c.acquire_dispatch.return_value=({'operation':op},True)
            c.claim.return_value=({'id':'j'}, {'id':'p'}, True)
            with patch('shorts.service.app.internal_identity',return_value={}) as auth,patch('shorts.service.app.cloud',return_value=c),patch('shorts.service.app.start_worker') as start,patch('shorts.service.production.run_job',return_value={'ok':True}) as run:
                response=app.test_client().post('/internal/dispatch',json={'jobId':'j'})
            self.assertEqual(response.status_code,200);auth.assert_called_once();start.assert_not_called()
            run.assert_called_once();c.finish.assert_called_once_with('j','awaiting_review',{'ok':True})
    def test_duplicate_claim_never_calls_model(self):
        c=Mock();c.claim.return_value=({'state':'running'}, {}, False)
        with patch('shorts.service.production.run_job') as run:execute_text(c,'j')
        run.assert_not_called();c.finish.assert_not_called()
    def test_known_rejection_settles_but_unknown_never_retries(self):
        for error in (ContractError('PROVIDER_QUOTA','429'),UnknownSubmission()):
            c=Mock();c.claim.return_value=({'id':'j'}, {'id':'p'}, True)
            with patch('shorts.service.production.run_job',side_effect=error) as run:execute_text(c,'j')
            run.assert_called_once()
            if isinstance(error,UnknownSubmission):
                c.finish.assert_not_called()
                self.assertEqual(c.db.collection.return_value.document.return_value.update.call_args.args[0]['state'],'submitted_unknown')
            else:self.assertEqual(c.finish.call_args.args[1],'failed')
    def test_expired_session_stops_before_generation(self):
        c=Mock();c.claim.return_value=({'state':'cancelled'}, {}, False)
        with patch('shorts.service.production.run_job') as run:execute_text(c,'j')
        run.assert_not_called();self.assertEqual(c.finish.call_args.args[1],'cancelled')
