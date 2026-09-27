"""The real service contract: approved script -> media -> sound -> final review."""
import copy
import unittest
from unittest.mock import Mock, patch
from shorts.core.contracts import ContractError, compile_timeline
from shorts.core.dependencies import fingerprint, select_assets
from shorts.core.generation import generation_inputs
from shorts.service.development import production_draft
from shorts.service.timeline import assemble_plan
from test_manual_development import complete


def draft(stage=2):
    data=complete()
    if stage==2:
        for key in ('soundRequests','musicRequests','subtitles'):data.pop(key)
    return {'id':'script','ideaId':'idea','stage':stage,'status':'ready',
            'approvalState':'approved','data':data}


class ProductionEntryTests(unittest.TestCase):
    def test_complete_script_opens_media_without_fabricating_sound_or_final_review(self):
        row=draft();original=copy.deepcopy(row);data=production_draft(row)
        self.assertEqual(row,original)
        self.assertEqual(data['soundRequests'],[]);self.assertEqual(data['musicRequests'],[])
        self.assertEqual(data['subtitles'][0]['text'],data['utterances'][0]['spanish'])
        generation_inputs(data,'early',[],{},'image','hero')
        generation_inputs(data,'early',[],{},'tts','voice')
        # Referential continuity is still required for an actual shot.
        with self.assertRaises(ContractError):generation_inputs(data,'early',[],{},'image','shot')
        refs=[{'id':e,'entityId':e,'kind':'image','approvalState':'approved',
               'inputFingerprint':fingerprint(data,e,'image')} for e in ('hero','room')]
        generation_inputs(data,'early',refs,{},'image','shot')

    def test_unapproved_partial_or_story_only_never_opens_media(self):
        for patch_value in ({'stage':1},{'status':'partial'},{'approvalState':'candidate'}):
            with self.subTest(patch_value=patch_value),self.assertRaises(ContractError):
                production_draft({**draft(),**patch_value})

    def test_media_survives_sound_plan_and_final_review(self):
        early=production_draft(draft());later=production_draft(draft(3))
        assets=[{'id':e,'entityId':e,'kind':k,'developmentId':'early','approvalState':'approved',
                 'inputFingerprint':fingerprint(early,e,k)} for e,k in
                [('hero','image'),('room','image'),('shot','image'),('voice','pcm')]]
        self.assertEqual(len(select_assets(assets,later,'sound-plan')),4)
        self.assertEqual(len(select_assets(assets,later,'final')),4)

    def test_preview_allowed_but_export_keeps_editorial_requirements(self):
        c=Mock();data=production_draft(draft());c.entity.return_value={
            'id':'early','data':data,'approvalState':'approved','editorialStage':2}
        c.project_ref.return_value.collection.return_value.stream.return_value=[]
        manifest=assemble_plan(c,{'id':'p','format':'16:9','activeDevelopment':'early'})
        self.assertTrue(any('continuidad' in issue for issue in manifest['draftIssues']))
        compile_timeline(manifest,False)
        with self.assertRaises(ContractError):compile_timeline(manifest,True)


class ProductionEntryApiTests(unittest.TestCase):
    def setUp(self):
        from shorts.service.app import app
        self.client=app.test_client();self.row=draft()
        self.project={'id':'p','owner':'u','revision':1,'activeDraft':'script','selectedIdea':{'id':'idea'}}
        self.rows={('developmentDrafts','script'):self.row};self.c=Mock()
        def entity_ref(pid,kind,eid):
            ref=Mock();ref.key=(kind,eid)
            ref.get.return_value.to_dict.side_effect=lambda:copy.deepcopy(self.rows.get(ref.key))
            return ref
        self.c.entity_ref.side_effect=entity_ref
        def mutate(pid,revision,fn):
            tx=Mock();tx.create.side_effect=lambda ref,data:self.rows.__setitem__(ref.key,copy.deepcopy(data))
            result=fn(tx,self.project)
            return result,self.project
        self.c.mutate.side_effect=mutate
    def send(self):
        with patch('shorts.service.app.owned',return_value=self.project),patch('shorts.service.app.cloud',return_value=self.c):
            return self.client.post('/projects/p/drafts/script:produce',json={},headers={'If-Match':'1'})
    def test_existing_approved_mobile_project_opens_without_paid_work_and_is_repeatable(self):
        first=self.send();self.assertEqual(first.status_code,200,first.json)
        second=self.send();self.assertEqual(second.json['id'],first.json['id'])
        self.assertEqual(self.project['activeDevelopment'],first.json['id'])
        self.assertEqual(first.json['editorialStage'],2)
        self.assertEqual(len([key for key in self.rows if key[0]=='developments']),1)
        self.c.submit.assert_not_called()
    def test_old_or_different_idea_is_rejected_without_changes(self):
        for field,value in [('activeDraft','new'),('selectedIdea',{'id':'other'})]:
            with self.subTest(field=field):
                old=copy.deepcopy(self.project);self.project[field]=value
                self.assertEqual(self.send().status_code,409)
                self.assertNotIn('activeDevelopment',self.project)
                self.project=old
