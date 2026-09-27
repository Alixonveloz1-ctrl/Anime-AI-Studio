import copy
import unittest
from unittest.mock import Mock,patch
from shorts.core.contracts import ContractError,digest
from shorts.core.requests import MODEL_CHOICES,selected_models
from shorts.core.dependencies import fingerprint,select_assets
from shorts.service.config import config
from shorts.service.providers import Providers,veo_payload,tts_payload
from shorts.service.development import recover_sound,apply_voice_assignments
from test_manual_development import complete

class GeneratorControlsTests(unittest.TestCase):
    def test_each_offered_model_uses_its_explicit_provider_contract(self):
        for kind,choices in MODEL_CHOICES.items():
            for model,_ in choices:
                c={**config(),'models':selected_models(config(),{kind:model})}
                if kind=='image':
                    session=Mock();session.post.return_value=Mock(ok=True,status_code=200,json=lambda:{'totalTokens':1,'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'image/png','data':'eA=='}}]}}]})
                    self.assertEqual(Providers(c,session,Mock()).image('portrait',[],'16:9')[0],b'x')
                    args=session.post.call_args
                    self.assertIn('/'+model+':generateContent',args.args[0])
                    image_config=args.kwargs['json']['generationConfig']['imageConfig']
                    self.assertEqual('imageSize' in image_config,model!='gemini-2.5-flash-image')
                elif kind=='veo':
                    payload=veo_payload(c,{'durationSeconds':8,'imageApproved':True,'prompt':'Scene'},'gs://image','gs://out')
                    self.assertFalse(payload['parameters']['generateAudio'])
                elif kind=='tts':self.assertEqual(tts_payload(c,{'japanese':'こんにちは'},{'name':'Kore'})['voice']['modelName'],model)
        with self.assertRaises(ContractError):selected_models(config(),{'image':'arbitrary-model'})
        with self.assertRaises(ContractError):selected_models(config(),{'text':'arbitrary-model'})

    def test_job_uses_pinned_model_and_records_actual_model_without_mutating_global_config(self):
        from shorts.service.production import run_job
        cloud=Mock();cloud.c=config();original=copy.deepcopy(cloud.c)
        cloud.entity.return_value={'id':'dev','data':complete()};cloud.upload_file.return_value='image.png'
        models=selected_models(cloud.c,{'image':'gemini-3-pro-image'})
        with patch('shorts.service.production.Providers') as provider,patch('shorts.service.production.inspect'):
            provider.return_value.image.return_value=(b'image','image/png')
            result=run_job(cloud,{'id':'job','operation':'image','models':models,'payload':{'entityId':'hero'}},{'id':'p','format':'16:9','activeDevelopment':'dev'})
        self.assertEqual(provider.call_args.args[0]['models']['image']['model'],'gemini-3-pro-image')
        self.assertEqual(cloud.put_entity.call_args.args[2]['model']['model'],'gemini-3-pro-image')
        self.assertTrue(result['assetId']);self.assertEqual(cloud.c,original)

    def test_voice_choice_survives_sound_plan_without_invalidating_images(self):
        original=complete();voice={'name':'Puck','languageCode':'ja-JP','direction':'Sereno'}
        project={'selectedIdea':{'id':'idea'},'voiceAssignments':{'ideaId':'idea','voices':{'hero':voice}}}
        updated=apply_voice_assignments(original,project)
        self.assertNotEqual(updated['bible']['characters'][0]['voice'],original['bible']['characters'][0]['voice'])
        assets=[{'id':kind,'entityId':eid,'kind':kind,'approvalState':'approved','inputFingerprint':fingerprint(original,eid,kind)} for eid,kind in [('hero','image'),('voice','pcm')]]
        selected=select_assets(assets,updated,'new')
        self.assertIn(('hero','image'),selected);self.assertNotIn(('voice','pcm'),selected)
        project['selectedIdea']['id']='other';self.assertEqual(apply_voice_assignments(original,project),original)

    def test_saved_bad_music_is_recovered_without_provider_or_story_changes(self):
        cloud=Mock();data=complete();prior=copy.deepcopy(data)
        data['musicRequests']=[{'id':'score','prompt':'Piano','seconds':5,'startFrame':0,'endFrame':7200,'sourceInSample':900000,'fadeOutSamples':999999}]
        source={'id':'failed','ideaId':'idea','stage':3,'status':'invalid','error':{'code':'MUSIC_COVERAGE'},'sourceDraftId':'script','sourceHash':digest(prior),'data':data}
        cloud.entity.side_effect=[source,{'ideaId':'idea','stage':2,'status':'ready','approvalState':'approved','data':prior}]
        cloud.db.collection.return_value.document.return_value.get.return_value.to_dict.return_value={'projectId':'p','owner':'u','settled':True,'providerCalls':[{'state':'completed'}]}
        out=recover_sound(cloud,{'id':'p','owner':'u','selectedIdea':{'id':'idea'},'activeDraft':'script'},'failed','repaired')
        self.assertEqual(out['data']['shots'],data['shots']);self.assertEqual(out['data']['utterances'],data['utterances'])
        self.assertEqual(out['approvalState'],'candidate');self.assertEqual(len(out['data']['musicRequests']),2)
        self.assertEqual(sum(m['seconds'] for m in out['data']['musicRequests']),300)
        cloud.http.post.assert_not_called()
        self.assertEqual(source['data']['musicRequests'][0]['seconds'],5)

class RecoveryAndVoiceApiTests(unittest.TestCase):
    def test_pending_image_reuses_job_and_two_executors_cannot_claim_it(self):
        from shorts.service.app import app
        from shorts.core.jobs import claim,service_startable
        job={'id':'job','projectId':'p','owner':'u','operation':'image','state':'queued','revision':1,'dispatchState':'submitted','workerOperation':'projects/p/operations/old','payload':{'entityId':'hero'},'providerCalls':[]}
        cloud=Mock();ref=cloud.db.collection.return_value.document.return_value;ref.get.return_value.to_dict.side_effect=lambda:copy.deepcopy(job)
        with patch('shorts.service.app.uid',return_value='u'),patch('shorts.service.app.cloud',return_value=cloud),patch('google.cloud.firestore.transactional',lambda f:f):
            result=app.test_client().post('/jobs/job:start',json={'session':'active'},headers={'If-Match':'1'})
        self.assertEqual(result.status_code,200,result.json)
        queued=cloud.enqueue.call_args.args[0];self.assertEqual(queued['id'],'job');self.assertEqual(queued['payload'],job['payload'])
        running,accepted=claim(queued,{'lease':{'session':'active','expires':100}},1);self.assertTrue(accepted)
        _,second=claim(running,{'lease':{'session':'active','expires':100}},1);self.assertFalse(second)
        for changes in ({'state':'running'},{'started':1},{'dispatchUnknown':True},{'providerCalls':[{'state':'completed'}]},{'providerCalls':[{'state':'submitted_unknown'}]}):
            self.assertFalse(service_startable({**job,**changes}))

    def test_voice_save_creates_new_approved_version_and_keeps_old_record(self):
        from shorts.service.app import app
        old={'id':'dev','data':complete(),'approvalState':'approved','editorialStage':2,'sourceDraftId':'script'};original=copy.deepcopy(old)
        project={'id':'p','owner':'u','revision':1,'activeDevelopment':'dev','selectedIdea':{'id':'idea'}}
        cloud=Mock();cloud.entity.return_value=old
        def mutate(pid,expected,fn):return fn(Mock(),project),project
        cloud.mutate.side_effect=mutate
        with patch('shorts.service.app.owned',return_value=project),patch('shorts.service.app.cloud',return_value=cloud):
            result=app.test_client().post('/projects/p/characters/hero/voice',json={'name':'Puck','direction':'Calmado'},headers={'If-Match':'1'})
            invalid=app.test_client().post('/projects/p/characters/hero/voice',json={'name':'invented'},headers={'If-Match':'1'})
        self.assertEqual(result.status_code,201,result.json);self.assertEqual(invalid.status_code,422)
        self.assertEqual(old,original);self.assertNotEqual(project['activeDevelopment'],'dev')
        self.assertEqual(project['voiceAssignments']['voices']['hero']['name'],'Puck')
        self.assertEqual(result.json['editorialStage'],2);cloud.submit.assert_not_called()

if __name__=='__main__':unittest.main()
