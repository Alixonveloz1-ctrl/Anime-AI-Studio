import copy,json,sys,tempfile,unittest,shutil,wave
from pathlib import Path
from unittest.mock import Mock,patch
from shorts.core.contracts import ContractError,compile_timeline,duration_target
from shorts.service.development import validate_stage,script_timing_brief
from shorts.service.timeline import assemble_plan
from test_manual_development import complete

def manifest(seconds):
    frames=seconds*24
    return {'schemaVersion':2,'projectId':'p','format':'16:9','fps':24,'sampleRate':48000,'frames':frames,'assets':{},'shots':[{'id':'s','startFrame':0,'frames':frames,'treatment':'black','approvedBlack':True}],'cues':[],'events':{},'subtitles':[]}

class DurationRangeTests(unittest.TestCase):
    def test_boundaries_and_natural_duration_preserved(self):
        for seconds in (285,290,300,310,315):
            d=complete();d['shots'][0].update(frames=seconds*24,minFrames=seconds*24,maxFrames=seconds*24)
            self.assertEqual(validate_stage(d,2)['shots'][0]['frames'],seconds*24)
            self.assertEqual(compile_timeline(manifest(seconds),True)['samples'],seconds*48000)
        for seconds in (284,316):
            with self.assertRaises(ContractError):compile_timeline(manifest(seconds))
    def test_32_seconds_not_stretched_and_message_names_total(self):
        with self.assertRaises(ContractError) as error:duration_target(660,720,768)
        self.assertIn('TOTAL',str(error.exception));self.assertIn('285 y 315',str(error.exception))
    def test_budget_covers_whole_story_and_explains_units(self):
        d=complete();b=d['beats'][0];d['beats']=[{**b,'id':'b1','preferredFrames':100},{**b,'id':'b2','preferredFrames':200}]
        brief=script_timing_brief(d)
        budget=json.loads(brief.split('cinco minutos: ')[1].split('. Cada momento')[0])
        self.assertEqual(sum(b['targetFrames'] for b in budget),7200)
        self.assertEqual([b['targetSeconds'] for b in budget],[100,200])
        self.assertIn('NUNCA en segundos',brief);self.assertIn('solo acción, silencio, música o ambiente',brief)
    def test_cues_after_300_seconds_and_short_program_tail(self):
        m=manifest(315);m['assets']['a']={'projectId':'p','kind':'pcm','sampleRate':48000,'samples':48000,'sha256':'a'*64,'approvalState':'approved'}
        m['cues']=[{'id':'c','track':'sfx','audioRevision':'a','anchorSample':310*48000,'sourceSyncSample':0,'approvalState':'approved'}]
        self.assertEqual(compile_timeline(m,True)['cues'][0]['resolvedStartSample'],310*48000)
        m.update(frames=285*24);m['shots'][0]['frames']=285*24;m['cues'][0]['anchorSample']=285*48000
        with self.assertRaises(ContractError) as error:compile_timeline(m)
        self.assertEqual(error.exception.code,'CUE_TAIL')
    def test_music_cannot_exceed_actual_shorter_program(self):
        d=complete();d['shots'][0].update(frames=285*24,minFrames=285*24,maxFrames=285*24)
        d['musicRequests']=[{'id':'m','prompt':'Piano','startFrame':0,'endFrame':300*24,'gainDb':-18}]
        with self.assertRaises(ContractError):validate_stage(d,3)
    def test_measured_timeline_uses_actual_duration(self):
        d=complete();d['utterances']=[];d['subtitles']=[];d['shots'][0].update(frames=310*24,minFrames=310*24,maxFrames=310*24)
        c=Mock();c.entity.return_value={'id':'dev','approvalState':'approved','data':d};c.project_ref.return_value.collection.return_value.stream.return_value=[]
        plan=assemble_plan(c,{'id':'p','activeDevelopment':'dev','format':'16:9'})
        self.assertEqual(plan['frames'],310*24);self.assertEqual(sum(s['frames'] for s in plan['shots']),plan['frames'])
    @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg required')
    def test_export_285_and_315_seconds_real_video_and_audio(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
        from render import render
        for seconds in (285,315):
            with self.subTest(seconds=seconds),tempfile.TemporaryDirectory() as root:
                result=render(manifest(seconds),root,final=True,width=32)
                self.assertEqual(result['frames'],seconds*24)
                self.assertEqual(result['programSamples'],seconds*48000)
                with wave.open(str(Path(root)/'mix.wav')) as audio:self.assertEqual(audio.getnframes(),seconds*48000)


class DurationApiTests(unittest.TestCase):
    def test_preview_and_final_default_to_actual_timeline_length(self):
        from shorts.service.app import app
        c=Mock();c.entity.return_value={'data':{'frames':7560}}
        p={'id':'p','activeTimeline':'t','candidateTimeline':'t','timelineStale':False}
        for endpoint in ('previews','renders'):
            with patch('shorts.service.app.owned',return_value=p),patch('shorts.service.app.cloud',return_value=c),patch('shorts.service.app.assert_current_timeline'),patch('shorts.service.app.cached_render',return_value=None),patch('shorts.service.app.submit',return_value=({'jobId':'j'},202)) as submit:
                response=app.test_client().post('/projects/p/'+endpoint,json={})
                self.assertEqual(response.status_code,202)
                self.assertEqual(submit.call_args.args[2]['endFrame'],7560)
    def test_partial_preview_is_not_presented_as_full_program(self):
        from shorts.service.app import app
        c=Mock();c.entity.side_effect=[{'state':'ready','object':'clip','timelineId':'t','startFrame':0,'endFrame':6840},{'data':{'frames':7560}}];c.url.return_value='https://example.test/clip'
        with patch('shorts.service.app.owned',return_value={'id':'p'}),patch('shorts.service.app.cloud',return_value=c),patch('shorts.service.app.assert_current_timeline'):
            result=app.test_client().get('/projects/p/previews/v').get_json()
        self.assertTrue(result['current']);self.assertFalse(result['fullProgram'])
    def test_script_must_cover_every_approved_story_beat(self):
        d=complete();d['beats'].append({**d['beats'][0],'id':'ending'})
        with self.assertRaises(ContractError) as error:validate_stage(d,2)
        self.assertEqual(error.exception.code,'STORY_COVERAGE')
