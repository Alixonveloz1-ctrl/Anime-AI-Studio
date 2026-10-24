import copy
import unittest
from shorts.core.contracts import ContractError
from shorts.core.revisions import apply_edits,changes,impact,replace_scope
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

    def test_A009_AI_scope_cannot_replace_unrelated_bible(self):
        replacement={**self.d['utterances'][0],'acting':'whisper','bible':{'evil':'ignored outside target'}}
        result=replace_scope(self.d,{'group':'utterances','entityId':'u'},replacement)
        self.assertEqual(result['bible'],self.d['bible'])
        self.assertEqual(result['utterances'][0]['acting'],'whisper')
        with self.assertRaises(ContractError):replace_scope(self.d,{'group':'utterances','entityId':'u'},{'id':'other'})

class ReorderWithEditTests(unittest.TestCase):
    """A reorder and a field edit in the same dialog must both land correctly."""
    def setUp(self):
        self.d={'shots':[{'id':'a','prompt':'uno','frames':48},{'id':'b','prompt':'dos','frames':48}],
                'utterances':[],'soundRequests':[],'musicRequests':[],'subtitles':[],'beats':[],
                'bible':{'characters':[],'locations':[],'props':[]}}
    def reorder(self):return {'path':['shots'],'value':[self.d['shots'][1],self.d['shots'][0]]}

    def test_the_edit_follows_the_shot_the_owner_edited(self):
        # Move the first shot down, then edit what was the second one (index 1).
        for patches in ([self.reorder(),{'path':['shots',1,'prompt'],'value':'editado'}],
                        [{'path':['shots',1,'prompt'],'value':'editado'},self.reorder()]):
            with self.subTest(patches=len(patches)):
                out=apply_edits(self.d,patches)
                self.assertEqual([s['id'] for s in out['shots']],['b','a'],'the reorder was applied')
                self.assertEqual({s['id']:s['prompt'] for s in out['shots']},{'a':'uno','b':'editado'},
                                 'the edit stayed on the shot it was typed into')

    def test_a_reorder_alone_still_works_and_cannot_rewrite_a_shot(self):
        self.assertEqual([s['id'] for s in apply_edits(self.d,[self.reorder()])['shots']],['b','a'])
        rewritten=copy.deepcopy(self.d['shots']);rewritten[0]['prompt']='otro'
        with self.assertRaises(ContractError):apply_edits(self.d,[{'path':['shots'],'value':rewritten}])
