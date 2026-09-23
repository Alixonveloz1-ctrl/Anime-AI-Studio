import unittest
from shorts.core.dispatch import acquire,resource_class
from shorts.core.contracts import ContractError

class DispatchTests(unittest.TestCase):
    def setUp(self):
        self.p={'lease':{'session':'s','expires':200}}
        self.j={'id':'j','state':'queued','operation':'veo','session':'s'}
    def test_A074_duplicate_queue_message_never_starts_second_worker(self):
        j,slot,dispatch=acquire(self.j,self.p,None,100)
        self.assertTrue(dispatch);self.assertFalse(acquire(j,self.p,slot,101)[2])
    def test_A077_capacity_held_across_long_provider_operation(self):
        with self.assertRaises(ContractError) as error:acquire(self.j,self.p,{'jobId':'other','since':0},100)
        self.assertEqual(error.exception.code,'CAPACITY_BUSY')
    def test_A072_expired_lease_stops_dispatch(self):
        with self.assertRaises(ContractError):acquire(self.j,self.p,None,201)
    def test_A055_media_not_blocked_by_analysis_capacity(self):
        self.assertNotEqual(resource_class('analyze'),resource_class('frames'))
        self.assertEqual(resource_class('render'),resource_class('preview'))
