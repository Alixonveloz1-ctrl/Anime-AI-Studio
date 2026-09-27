"""Regression cases from the reference-project review; no live provider calls."""
import base64
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from shorts.core.contracts import ContractError
from shorts.service.config import config
from shorts.service.providers import Providers,UnknownSubmission
from shorts.service.production import run_job
from shorts.service.execution import execute_job
from test_manual_development import complete
from media import ff,probe

def response(data):return Mock(ok=True,status_code=200,json=lambda:data)

class ProviderLifecycleTests(unittest.TestCase):
    def test_preflight_failure_settles_without_paid_submission(self):
        for failed in (TimeoutError(),Mock(status_code=503)):
            session=Mock();meter=Mock()
            if isinstance(failed,Exception):session.post.side_effect=failed
            else:session.post.return_value=failed
            c=Mock();c.claim.return_value=({'id':'j'}, {}, True)
            with patch('shorts.service.production.run_job',side_effect=lambda *_:Providers(config(),session,meter).image('portrait',[],'16:9')):
                execute_job(c,'j')
            self.assertEqual(c.finish.call_args.args[1],'failed')
            self.assertEqual(c.finish.call_args.args[2]['code'],'PROVIDER_CHECK_FAILED')
            meter.begin_call.assert_not_called();self.assertEqual(session.post.call_count,1)

    def test_paid_timeout_remains_unknown_without_retry(self):
        session=Mock();session.post.side_effect=TimeoutError();meter=Mock()
        with self.assertRaises(UnknownSubmission):Providers(config(),session,meter).music('Piano',10)
        meter.begin_call.assert_called_once();meter.end_call.assert_not_called()
        self.assertEqual(session.post.call_count,1)

    def test_known_video_poll_failure_stays_recoverable_in_worker(self):
        path=Path(__file__).resolve().parents[2]/'worker/montage-shorts/runner.py'
        spec=importlib.util.spec_from_file_location('lifecycle_runner',path)
        runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
        for failed in (TimeoutError(),Mock(ok=False,status_code=503),Mock(ok=False,status_code=429),Mock(ok=True,status_code=200,json=Mock(side_effect=ValueError('invalid JSON')))):
            c=Mock();c.c=config();c.claim.return_value=({'id':'j'}, {}, True)
            session=Mock();meter=Mock();provider=Providers(c.c,session,meter)
            name=f'projects/{c.c["project"]}/locations/us-central1/publishers/google/models/{c.c["models"]["veo"]["model"]}/operations/video'
            if isinstance(failed,Exception):session.post.side_effect=failed
            else:session.post.return_value=failed
            with patch.dict(os.environ,{'SHORTS_JOB_ID':'j','SHORTS_SELF_TEST':'','SHORTS_CLOUD_SELF_TEST':'','SHORTS_DISPATCH_PROBE':''}),patch.object(runner,'Cloud',return_value=c),patch.object(runner,'run_job',side_effect=lambda *_:provider.poll_veo(name)):
                with self.assertRaises(SystemExit):runner.main()
            self.assertEqual(c.db.collection.return_value.document.return_value.update.call_args.args[0],{'state':'waiting_provider','errorCode':'VEO_PENDING'})
            c.finish.assert_not_called();meter.begin_call.assert_not_called()
            self.assertTrue(session.post.call_args.args[0].endswith(':fetchPredictOperation'))
            self.assertEqual(session.post.call_count,1)

    def test_received_invalid_json_does_not_leave_a_submission_unknown(self):
        session=Mock();session.post.return_value=Mock(ok=True,status_code=200,json=Mock(side_effect=ValueError('invalid')))
        meter=Mock();meter.begin_call.return_value='call'
        with self.assertRaises(ContractError) as error:Providers(config(),session,meter).music('Piano',10)
        self.assertEqual(error.exception.code,'PROVIDER_RESPONSE');meter.end_call.assert_called_once_with('call','completed')

    def test_empty_and_corrupt_audio_are_failures_not_worker_crashes(self):
        for kind in ('tts','music'):
            for value,code in ((None,'EMPTY'),('', 'EMPTY'),('not base64!', 'INVALID')):
                session=Mock();data={'audioContent':value} if kind=='tts' else {'status':'completed','outputs':[{'type':'audio','mime_type':'audio/mp3','data':value}]}
                session.post.return_value=response(data);provider=Providers(config(),session,Mock())
                with self.assertRaises(ContractError) as error:
                    if kind=='tts':provider.tts({'japanese':'本。'},{'name':'Kore'})
                    else:provider.music('Piano',10)
                self.assertEqual(error.exception.code,kind.upper()+'_'+code);self.assertEqual(session.post.call_count,1)

    def test_reference_labels_stay_adjacent_to_the_corresponding_files(self):
        session=Mock();session.post.side_effect=[response({'totalTokens':1}),response({'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'image/png','data':'eA=='}}]}}]})]
        refs=[{'entityId':eid,'approvalState':'approved','uri':'gs://bucket/'+eid,'mimeType':'image/png','referenceLabel':label} for eid,label in [('hero','Personaje: Kenji'),('room','Lugar: Bar')]]
        Providers(config(),session,Mock()).image('Draw scene',refs,'16:9')
        parts=session.post.call_args.kwargs['json']['contents'][0]['parts']
        self.assertIn('Kenji',parts[1]['text']);self.assertEqual(parts[2]['fileData']['fileUri'],'gs://bucket/hero')
        self.assertIn('Bar',parts[3]['text']);self.assertEqual(parts[4]['fileData']['fileUri'],'gs://bucket/room')

class MediaReceiptTests(unittest.TestCase):
    def test_voice_and_both_music_mime_names_become_playable_stored_assets(self):
        # Real encoded local media through actual HTTP adapter, decode, FFmpeg,
        # waveform and asset metadata. Cloud transport alone is a fake.
        with tempfile.TemporaryDirectory() as temp:
            for kind,mime,suffix in [('tts','audio/wav','.wav'),('music','audio/mp3','.mp3'),('music','audio/mpeg','.mp3')]:
                with self.subTest(kind=kind,mime=mime):
                    source=Path(temp)/('fixture'+suffix)
                    ff(['-f','lavfi','-i','sine=frequency=440:sample_rate=24000','-t','0.2',source])
                    encoded=base64.b64encode(source.read_bytes()).decode()
                    data={'audioContent':encoded} if kind=='tts' else {'status':'completed','outputs':[{'type':'audio','mime_type':mime,'data':encoded}]}
                    c=Mock();c.c=config();c.http.post.return_value=response(data)
                    dev=complete();dev['musicRequests']=[{'id':'score','prompt':'Piano','seconds':1}];c.entity.return_value={'data':dev}
                    stored=[]
                    def upload(pid,aid,path,name,mime):
                        info=probe(path);stored.append((name,mime,info));return 'stored/'+aid+'/'+name
                    c.upload_file.side_effect=upload
                    with patch('shorts.service.production.RequestJournal',return_value=Mock()):
                        out=run_job(c,{'id':'j','operation':kind,'payload':{'entityId':'voice' if kind=='tts' else 'score'}},{'id':'p','activeDevelopment':'dev'})
                    asset=c.put_entity.call_args.args[2]
                    self.assertEqual(out['assetId'],asset['id']);self.assertEqual(asset['mimeType'],'audio/x-wav')
                    self.assertEqual(asset['sampleRate'],48000);self.assertGreater(asset['samples'],0)
                    self.assertEqual(stored[-1][2]['streams'][0]['codec_name'],'pcm_s24le')
                    self.assertEqual(c.http.post.call_count,1)
                    if kind=='tts':self.assertEqual(c.http.post.call_args.kwargs['json']['voice']['name'],'Kore')

    def test_webp_image_keeps_its_format_when_stored(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'fixture.webp';ff(['-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1',source])
            c=Mock();c.c=config();c.entity.return_value={'data':complete()};c.upload_file.return_value='image.webp'
            with patch('shorts.service.production.Providers') as provider:
                provider.return_value.image.return_value=(source.read_bytes(),'image/webp')
                run_job(c,{'id':'j','operation':'image','payload':{'entityId':'hero'}},{'id':'p','activeDevelopment':'dev','format':'16:9'})
            self.assertEqual(c.upload_file.call_args.args[-2:],('image.webp','image/webp'))
            self.assertEqual(c.put_entity.call_args.args[2]['mimeType'],'image/webp')

if __name__=='__main__':unittest.main()
