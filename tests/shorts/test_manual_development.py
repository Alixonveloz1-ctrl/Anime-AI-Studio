import copy
import unittest
from unittest.mock import Mock,patch
from shorts.core.contracts import ContractError,digest
from shorts.core.requests import check_call_scope
from shorts.service.development import develop,validate_stage,plan_shots,plan_music,recover_story,source_for_stage,STAGES
from shorts.service.director import validate_development
from test_workflow import development

def complete():
    d=development();d.update(title='Una decisión',story='Una persona entra en la habitación, encuentra el libro y decide quedarse.')
    d['bible'].update(dramatic='Una decisión',visual='Anime 2D')
    d['bible']['characters'][0]['voice']['direction']='Contenida'
    d['beats'][0].update(change='Decide quedarse',visible='Entra',audible='Silencio',intention='Entender',emotion='Duda')
    shot=d['shots'][0];shot['camera']={'start':[1,0.5,0.5],'end':[1,0.5,0.5]}
    for key in ('before','after'):shot[key]={'characters':[{'id':'hero','position':'Sentado','pose':'Quieto','physicalState':'Sano','costumeId':'coat'}],'props':[],'space':'Habitación ordenada'}
    return d

class ManualDevelopmentTests(unittest.TestCase):
    def test_each_click_calls_provider_once_and_stops(self):
        raw=complete();p={'id':'p','owner':'u','genre':'drama','subgenres':[],'concept':'','format':'16:9','selectedIdea':{'id':'idea'}}
        for stage in range(1,5):
            with self.subTest(stage=stage):
                c=Mock();provider=Mock();prior={k:v for k,v in raw.items() if k not in STAGES[stage-1][1]}
                if stage==1:prior={}
                else:
                    p['activeDraft']='previous';c.entity.return_value={'ideaId':'idea','stage':stage-1,'status':'ready','approvalState':'approved','data':prior}
                result={k:raw[k] for k in STAGES[stage-1][1]} if stage<4 else {'issues':[],'coverage':['continuidad'],'nativeQualityGuaranteed':False}
                provider.text.return_value=result
                answer=develop(c,provider,{'id':'job','payload':{'stage':stage,'sourceDraftId':'previous' if stage>1 else None}},p,{'id':'idea','data':{'title':'Idea','premise':'Encuentro'}})
                provider.text.assert_called_once()
                if stage<4:self.assertEqual(answer,{'draftId':'job','stage':stage})
                else:self.assertEqual(answer['review']['issues'],[])
                with self.assertRaises(ContractError):check_call_scope('develop',[{'kind':'text','state':'completed'}],'text')
    def test_previous_step_must_be_approved_and_matching(self):
        c=Mock();p={'id':'p','selectedIdea':{'id':'idea'},'activeDraft':'source'}
        for row in ({'ideaId':'idea','stage':1,'status':'ready','approvalState':'candidate'}, {'ideaId':'other','stage':1,'status':'ready','approvalState':'approved'}):
            c.entity.return_value=row
            with self.assertRaises(ContractError):source_for_stage(c,p,2,'source')
    def test_rate_limit_preserves_prior_step_and_never_chains(self):
        c=Mock();prior={k:complete()[k] for k in ('title','story','beats')};c.entity.return_value={'ideaId':'idea','stage':1,'status':'ready','approvalState':'approved','data':prior}
        provider=Mock();provider.text.side_effect=ContractError('PROVIDER_QUOTA','429')
        p={'id':'p','owner':'u','genre':'drama','subgenres':[],'concept':'','format':'16:9','selectedIdea':{'id':'idea'},'activeDraft':'source'}
        with self.assertRaises(ContractError):develop(c,provider,{'id':'job','payload':{'stage':2,'sourceDraftId':'source'}},p,{'id':'idea','data':{}})
        provider.text.assert_called_once();self.assertEqual(c.put_entity.call_args.args[2]['data'],prior)
        self.assertEqual(c.entity_ref.call_args.args[-1],'job')
    def test_provisional_math_fits_within_bounds_without_changing_dialogue(self):
        raw=complete();raw['shots'][0]['frames']=7100
        result=validate_stage(raw,2)
        self.assertEqual(result['shots'][0]['frames'],7200);self.assertEqual(raw['shots'][0]['frames'],7100)
        self.assertEqual(result['utterances'],raw['utterances'])
    def test_impossible_duration_and_missing_voice_stop_at_script(self):
        d=complete();d['shots'][0]['maxFrames']=7100
        with self.assertRaises(ContractError) as error:validate_stage(d,2)
        self.assertEqual(error.exception.code,'DURATION_PLAN')
        d=complete();del d['bible']['characters'][0]['voice']
        with self.assertRaises(ContractError) as error:validate_stage(d,2)
        self.assertEqual(error.exception.code,'CHARACTER_VOICE')
    def test_music_source_seconds_derived_and_long_cues_split(self):
        d=complete();d['musicRequests']=[{'id':'score','prompt':'Piano','seconds':1,'startFrame':0,'endFrame':7200,'gainDb':-18}]
        result=validate_stage(d,3)
        self.assertEqual([r['seconds'] for r in result['musicRequests']],[184,116])
        self.assertEqual([(r['startFrame'],r['endFrame']) for r in result['musicRequests']],[(0,4416),(4416,7200)])
        validate_development(result);self.assertEqual(plan_music(result),result)
    def test_story_recovery_does_not_require_voices_music_or_full_timing(self):
        c=Mock();d=complete();del d['bible']['characters'][0]['voice'];d['shots'][0]['frames']=1
        c.entity.return_value={'ideaId':'idea','jobId':'old','data':d};c.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={'projectId':'p','owner':'u','settled':True,'providerCalls':[]}
        recovered=recover_story(c,{'id':'p','owner':'u','selectedIdea':{'id':'idea'}},'old','new')
        self.assertEqual(recovered['stage'],1);self.assertEqual(set(recovered['data']),{'title','story','beats'});c.http.post.assert_not_called()


class ValidationBoundaryTests(unittest.TestCase):
    def test_structural_errors_reported_together(self):
        from shorts.service.development import validate_shape,stage_schema
        d=complete();del d['bible']['characters'][0]['voice'];del d['shots'][0]['before']
        with self.assertRaises(ContractError) as error:validate_shape({k:d[k] for k in ('bible','shots','utterances')},stage_schema(2))
        self.assertIn('voice',str(error.exception));self.assertIn('before',str(error.exception))
    def test_music_schema_does_not_delegate_duration_arithmetic(self):
        from shorts.service.development import stage_schema
        fields=stage_schema(3)['properties']['musicRequests']['items']['properties']
        self.assertNotIn('seconds',fields);self.assertNotIn('sourceInSample',fields)
    def test_bible_missing_voice_is_irrelevant_to_story_approval(self):
        from shorts.service.development import story_data
        d=complete();d['bible']['characters'][0].pop('voice')
        validate_stage(story_data(d),1)

class ManualApiTests(unittest.TestCase):
    def setUp(self):
        from shorts.service.app import app
        self.client=app.test_client()
    def test_stage_two_rejected_before_approval_without_submission(self):
        p={'id':'p','owner':'u','revision':1,'selectedIdea':{'id':'idea'},'activeDraft':'prior'}
        c=Mock();c.entity.return_value={'ideaId':'idea','stage':1,'status':'ready','approvalState':'candidate','data':{}}
        with patch('shorts.service.app.owned',return_value=p),patch('shorts.service.app.cloud',return_value=c):
            r=self.client.post('/projects/p/develop',json={'stage':2,'sourceDraftId':'prior','session':'s'},headers={'If-Match':'1'})
        self.assertEqual(r.status_code,409);c.submit.assert_not_called()
    def test_submission_pins_approved_content_hash(self):
        p={'id':'p','owner':'u','revision':1,'selectedIdea':{'id':'idea'},'activeDraft':'prior'}
        raw={k:complete()[k] for k in ('title','story','beats')};c=Mock();c.entity.return_value={'ideaId':'idea','stage':1,'status':'ready','approvalState':'approved','data':raw};c.submit.return_value={'id':'j','state':'queued'}
        with patch('shorts.service.app.owned',return_value=p),patch('shorts.service.app.cloud',return_value=c):
            r=self.client.post('/projects/p/develop',json={'stage':2,'sourceDraftId':'prior','session':'s'},headers={'If-Match':'1','Idempotency-Key':'stage-test'})
        self.assertEqual(r.status_code,202);payload=c.submit.call_args.args[2]
        self.assertEqual(payload['stage'],2);self.assertEqual(payload['sourceHash'],digest(raw))
    def test_future_source_change_rejected_at_execution(self):
        c=Mock();c.entity.return_value={'ideaId':'idea','stage':1,'status':'ready','approvalState':'approved','data':{'different':True}}
        with self.assertRaises(ContractError):source_for_stage(c,{'id':'p','selectedIdea':{'id':'idea'},'activeDraft':'prior'},2,'prior','oldhash')

if __name__=='__main__':unittest.main()
