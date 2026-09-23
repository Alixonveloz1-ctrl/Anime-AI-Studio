import copy
import unittest
from shorts.core.contracts import ContractError
from shorts.core.revisions import apply_edits,changes,impact
from shorts.core.dependencies import fingerprint

class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.d={'title':'Historia','bible':{'characters':[{'id':'c','name':'A','voice':{'name':'Kore'}}],'locations':[],'props':[]},'shots':[],
                'utterances':[{'id':'u','speakerId':'c','japanese':'本。','spanish':'Un libro.','acting':'calm'}],'musicRequests':[]}
    def test_A009_manual_keeps_original_approval_and_voice(self):
        old=copy.deepcopy(self.d)
        new=apply_edits(self.d,[{'path':['utterances',0,'spanish'],'value':'El libro.'}])
        voice={'id':'voice','entityId':'u','kind':'pcm','approvalState':'approved','inputFingerprint':fingerprint(old,'u','pcm')}
        result=impact(old,new,[voice],'old')
        self.assertEqual(self.d,old);self.assertEqual(result['retainedApprovedAssetIds'],['voice']);self.assertEqual(result['paidCalls'],0)
    def test_A040_japanese_change_only_invalidates_voice(self):
        voice={'id':'voice','entityId':'u','kind':'pcm','approvalState':'approved','inputFingerprint':fingerprint(self.d,'u','pcm')}
        new=apply_edits(self.d,[{'path':['utterances',0,'japanese'],'value':'別の本。'}])
        self.assertEqual(impact(self.d,new,[voice],'old')['assetsNeedingReview'][0]['assetId'],'voice')
    def test_A076_protect_ids_types_and_paths(self):
        for path,value in [(['bible','characters',0,'id'],'other'),(['unknown'],'a'),(['title'],3),(['utterances',9,'spanish'],'x')]:
            with self.assertRaises(ContractError):apply_edits(self.d,[{'path':path,'value':value}])
    def test_A009_actual_diff_does_not_trust_reported_ids(self):
        new=copy.deepcopy(self.d);new['utterances'][0]['acting']='angry'
        self.assertEqual(changes(self.d,new)[0]['path'],['utterances',0,'acting'])
