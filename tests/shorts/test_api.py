import importlib.util
import unittest
from unittest.mock import patch
from shorts.core.contracts import ContractError

@unittest.skipUnless(importlib.util.find_spec('flask'),'Install pinned service dependencies')
class ApiTests(unittest.TestCase):
    def setUp(self):
        from shorts.service.app import app
        self.client=app.test_client()
    def test_A078_auth_required(self):
        self.assertEqual(self.client.get('/projects').status_code,401)
        self.assertEqual(self.client.post('/projects',json={'genre':'drama'}).status_code,401)
    def test_A094_health_no_provider(self):
        with patch('shorts.service.app.cloud',side_effect=AssertionError('must not access cloud')):
            r=self.client.get('/health');self.assertEqual(r.status_code,200);self.assertEqual(r.json['providerAccess'],'pending_authorized_contract_tests')
    def test_A078_internal_no_fake_queue_header(self):
        r=self.client.post('/internal/dispatch',json={'jobId':'x'},headers={'X-CloudTasks-TaskName':'fake'})
        self.assertEqual(r.status_code,403)
    def test_A076_missing_revision(self):
        with patch('shorts.service.app.uid',return_value='u'),patch('shorts.service.app.cloud') as cloud:
            cloud.return_value.project.return_value={'owner':'u','id':'p','revision':2}
            r=self.client.patch('/projects/p',json={'title':'x'})
            self.assertEqual(r.status_code,409)
    def test_A079_limit_metadata(self):
        r=self.client.post('/projects',data='x'*1000001,content_type='application/json')
        self.assertIn(r.status_code,(401,413))
