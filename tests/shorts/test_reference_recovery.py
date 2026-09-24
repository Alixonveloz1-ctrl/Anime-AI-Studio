import copy
import unittest
from unittest.mock import Mock
from shorts.core.contracts import ContractError
from shorts.service.references import link_references
from shorts.service.development import recover, recovery_source
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
    def test_recovery_reuses_saved_story_and_keeps_old_draft(self):
        c=Mock();raw=development();raw['shots'][0]['referenceEntityIds']=[]
        source={'jobId':'old','ideaId':'idea','data':raw}
        c.entity.return_value=source
        c.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={'projectId':'p','owner':'owner','operation':'develop','settled':True,'state':'failed','result':{'code':'REFERENCE_LINK'},'payload':{'ideaId':'idea'},'providerCalls':[]}
        result=recover(c,{'id':'new','payload':{'resumeFrom':'old'}},{'id':'p','owner':'owner'},{'id':'idea'})
        validate_development(result);self.assertEqual(source['data']['shots'][0]['referenceEntityIds'],[])
        self.assertEqual(c.put_entity.call_args.args[2]['sourceJobId'],'old')
        c.http.post.assert_not_called()
    def test_cross_owner_other_idea_running_and_uncertain_are_rejected(self):
        base={'projectId':'p','owner':'owner','operation':'develop','settled':True,'state':'failed','result':{'code':'REFERENCE_LINK'},'payload':{'ideaId':'idea'},'providerCalls':[]}
        for change in ({'owner':'other'},{'payload':{'ideaId':'other'}},{'settled':False},{'providerCalls':[{'state':'submitted_unknown'}]}):
            c=Mock();c.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={**base,**change}
            with self.assertRaises(ContractError):recovery_source(c,{'id':'p','owner':'owner'},'old','idea')
            c.entity.assert_not_called()
