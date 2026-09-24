import copy
import unittest
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.service.references import link_references
from shorts.service.development import recover_story
from shorts.service.director import validate_development
from test_workflow import development

class ReferenceRecoveryTests(unittest.TestCase):
    def test_missing_index_is_derived_without_changing_content(self):
        raw=development();raw['shots'][0]['referenceEntityIds']=[];before=copy.deepcopy(raw)
        fixed=link_references(raw)
        self.assertEqual(raw,before)
        self.assertEqual(fixed['shots'][0]['referenceEntityIds'],['room','hero'])
        validate_development(fixed)
        fixed['shots'][0]['referenceEntityIds']=[]
        self.assertEqual(fixed,before)
    def test_unknown_ids_are_never_guessed_or_removed(self):
        for key,value in [('locationId','other'),('visibleCharacters',['other']),('referenceEntityIds',['other'])]:
            raw=development();raw['shots'][0][key]=value
            with self.assertRaises(ContractError):link_references(raw)
    def test_explicit_props_are_included_and_duplicates_removed(self):
        raw=development();raw['bible']['props']=[{'id':'book'}];raw['shots'][0].update(props=['book'],referenceEntityIds=['hero','hero'])
        self.assertEqual(link_references(raw)['shots'][0]['referenceEntityIds'],['hero','room','book'])
    def test_recovery_preserves_old_story_and_does_not_call_provider(self):
        from test_manual_development import complete
        c=Mock();raw=complete();raw['shots'][0]['referenceEntityIds']=[]
        c.entity.return_value={'jobId':'old','ideaId':'idea','data':raw}
        c.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={'projectId':'p','owner':'owner','settled':True,'providerCalls':[]}
        result=recover_story(c,{'id':'p','owner':'owner','selectedIdea':{'id':'idea'}},'old','new')
        self.assertEqual(result['data']['story'],raw['story']);self.assertEqual(raw['shots'][0]['referenceEntityIds'],[])
        c.http.post.assert_not_called()
    def test_cross_owner_and_unsettled_recovery_are_rejected(self):
        from test_manual_development import complete
        for change in ({'owner':'other'},{'settled':False},{'providerCalls':[{'state':'submitted_unknown'}]}):
            c=Mock();c.entity.return_value={'jobId':'old','ideaId':'idea','data':complete()}
            c.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={'projectId':'p','owner':'owner','settled':True,'providerCalls':[],**change}
            with self.assertRaises(ContractError):recover_story(c,{'id':'p','owner':'owner','selectedIdea':{'id':'idea'}},'old','new')
            c.put_entity.assert_not_called()
