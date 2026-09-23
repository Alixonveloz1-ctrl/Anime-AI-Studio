import copy
import unittest
from shorts.core.contracts import *
from shorts.core.jobs import reserve,claim,settle
from shorts.service.providers import veo_payload,tts_payload,Providers,UnknownSubmission
from shorts.service.config import config

class TimelineTests(unittest.TestCase):
    def setUp(self):
        self.shot={'id':'s','startFrame':2400,'frames':96,'assetRevision':'v','trimSeconds':0,'speed':1}
        self.event={'pts':60,'timebase':24,'videoRevision':'v','visible':True}
        self.cue={'sourceSyncSample':9600,'offsetSamples':0}
    def test_A052_exact_fixture(self):
        event=resolve_event(self.shot,self.event);self.assertEqual(event,{'sample':4920000,'frame':2460})
        self.assertEqual(resolve_cue(self.cue,event['sample'],48000)['resolvedStartSample'],4910400)
    def test_A067_move_shot(self):
        a=resolve_event(self.shot,self.event)['sample'];self.shot['startFrame']+=48
        self.assertEqual(resolve_event(self.shot,self.event)['sample']-a,96000)
    def test_A057_one_frame(self):
        self.cue['offsetSamples']=2000
        self.assertEqual(resolve_cue(self.cue,4920000,48000)['resolvedStartSample'],4912400)
    def test_A068_retime_and_trim(self):
        self.shot.update(speed=1.1,trimSeconds=.3)
        self.assertEqual(resolve_event(self.shot,self.event)['sample'],4896000)
        self.shot['trimSeconds']=3
        with self.assertRaisesRegex(ContractError,'fuera'):resolve_event(self.shot,self.event)
    def test_A060_missing_event(self):
        self.event['visible']=False
        with self.assertRaises(ContractError):resolve_event(self.shot,self.event)
    def test_negative_not_clamped(self):
        with self.assertRaisesRegex(ContractError,'preparación'):resolve_cue(self.cue,0,48000)
    def test_cannot_trim_attack(self):
        self.cue['trimInSample']=10000
        with self.assertRaisesRegex(ContractError,'ataque'):resolve_cue(self.cue,4920000,48000)
    def test_A059_manual_lock(self):
        c={'revision':1,'manualLock':True,'approvalState':'approved','gainDb':-8}
        with self.assertRaises(ContractError):edit_cue(c,{'gainDb':0},1,'analysis')
        updated=edit_cue(c,{'gainDb':-4},1)
        self.assertEqual(c['approvalState'],'approved');self.assertEqual(updated['approvalState'],'candidate')
    def test_A059_analysis_metadata_does_not_invalidate_manual_approval(self):
        cue={'id':'cue','revision':3,'approvalState':'approved','manualLock':True,'eventId':'manual','gainDb':-3}
        analyzed={**cue,'analysisAttempts':2,'analysisScan':{'options':[1,2]},'proposedEventId':'automatic'}
        self.assertEqual(digest(cue_render_data(cue)),digest(cue_render_data(analyzed)))
        self.assertNotEqual(digest(cue_render_data(cue)),digest(cue_render_data({**analyzed,'offsetSamples':2000})))
    def test_A076_conflict(self):
        with self.assertRaises(ContractError) as ctx:edit_cue({'revision':3},{},2)
        self.assertEqual(ctx.exception.status,409)
    def test_A020_planner_measured(self):
        b=[{'id':'a','minFrames':100,'preferredFrames':200,'maxFrames':500,'timingEvidence':'measured_audio'}, {'id':'b','minFrames':100,'preferredFrames':200,'maxFrames':500,'timingEvidence':'approved_silence'}]
        self.assertEqual(sum(x['frames'] for x in plan_beats(b,800)),800)
        with self.assertRaises(ContractError):plan_beats(b,1200)
        b[0]['timingEvidence']='word_count'
        with self.assertRaises(ContractError):plan_beats(b,500)
    def test_ids(self):
        for v in ('../escape','a/b','$(rm x)','a\\b',''):
            with self.assertRaises(ContractError):ident(v)
    def test_A068_manual_follows_move_not_changed_content(self):
        c={'audioRevision':'a','approvalState':'approved','manualLock':True}
        moved={**self.shot,'startFrame':2401}
        self.assertEqual(stale_on_change(c,self.shot,moved,'a')['approvalState'],'approved')
        moved['assetRevision']='new'
        self.assertEqual(stale_on_change(c,self.shot,moved,'a')['approvalState'],'stale')

class JobTests(unittest.TestCase):
    def setUp(self):
        self.p={'id':'p','owner':'u','revision':1,'lease':{'session':'s','expires':130}}
        self.b={'id':'b','expires':200,'limit':100,'reserved':0,'spent':0,'operations':['veo']}
    def reserve(self,key='key12345',jobs=None):return reserve(self.p,self.b,jobs or {},'veo',{'shot':'s'},key,1,25,100,'s')
    def test_A074_duplicate(self):
        j,b,created=self.reserve();self.b=b
        duplicate,after,created=self.reserve(jobs={j['id']:j});self.assertFalse(created);self.assertEqual(after['reserved'],25)
    def test_A075_unknown_never_resubmitted(self):
        j,_,_=self.reserve();j,send=claim(j,self.p,110);self.assertTrue(send);self.assertEqual(j['state'],'running');self.assertTrue(j['submissionMayHaveSucceeded'])
        again,send=claim(j,self.p,111);self.assertFalse(send)
    def test_A072_expired_lease(self):
        j,_,_=self.reserve();j,send=claim(j,self.p,131);self.assertFalse(send);self.assertEqual(j['state'],'cancelled')
    def test_A077_reservation(self):
        self.b['spent']=80
        with self.assertRaisesRegex(ContractError,'Saldo'):self.reserve()
    def test_settlement_once(self):
        j,b,_=self.reserve();j,b=settle(j,b,'succeeded');self.assertEqual(b['spent'],25)
        j,b=settle(j,b,'succeeded');self.assertEqual(b['spent'],25);self.assertEqual(b['reserved'],0)

class ProviderTests(unittest.TestCase):
    def test_A031_payload_immutable_no_audio(self):
        c=config();s={'durationSeconds':8,'format':'16:9','imageApproved':True,'prompt':'walk','generateAudio':True}
        payload=veo_payload(c,s,'gs://bucket/image.png','gs://bucket/output/')
        self.assertIs(payload['parameters']['generateAudio'],False)
    def test_A032_no_incompatible_fallback(self):
        c=config();c['models']['veo']['model']='different'
        with self.assertRaises(ContractError):veo_payload(c,{},'a','b')
    def test_A035_tts_separate_japanese_acting(self):
        d=tts_payload(config(),{'japanese':'こんにちは。','acting':'whisper'}, {'name':'Kore','languageCode':'ja-JP'})
        self.assertEqual(d['input']['text'],'こんにちは。');self.assertIn('whisper',d['input']['prompt']);self.assertEqual(d['voice']['languageCode'],'ja-JP')
    def test_A075_network_timeout_single_request(self):
        class Session:
            calls=0
            def post(self,*a,**kw):self.calls+=1;raise TimeoutError()
        s=Session()
        with self.assertRaises(UnknownSubmission):Providers(config(),s).post('https://example.invalid',{})
        self.assertEqual(s.calls,1)

if __name__=='__main__':unittest.main()
