"""Offline provider fixtures: no Google access, credentials or paid calls."""
import base64
import copy
import unittest
from shorts.core.contracts import ContractError
from shorts.core.requests import MODELS, MODEL_CHOICES, VOICES
from shorts.service.providers import Providers, UnknownSubmission, tts_payload, rejection_detail
from shorts.service.development_schema import development_schema
from shorts.service.image_direction import image_prompt


def config():
    return {'project':'fixture-only','models':{kind:{'model':model,'region':region} for kind,(model,region) in MODELS.items()}}


class Response:
    def __init__(self,status=200,data=None):
        self.status_code=status;self.ok=200<=status<300;self.data=data;self.headers={}
    def json(self):
        if isinstance(self.data,Exception):raise self.data
        return self.data


class Session:
    def __init__(self,*responses):self.responses=list(responses);self.calls=[]
    def post(self,url,**kwargs):
        self.calls.append((url,kwargs))
        response=self.responses.pop(0)
        if isinstance(response,Exception):raise response
        return response


class Meter:
    def __init__(self):self.started=[];self.ended=[];self.images=[]
    def begin_call(self,kind,url,payload):self.started.append(kind);return 'call'+str(len(self.started))
    def end_call(self,call,state):self.ended.append((call,state))
    def record_image_response(self,summary):self.images.append(summary)


class GenerationRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.u={'japanese':'まだ間に合う。','acting':'Con esperanza'}
        self.voice={'name':'Kore','languageCode':'ja-JP','direction':'Contenida'}

    def test_all_catalog_voices_build_valid_payloads_for_both_tts_models(self):
        for model,_ in MODEL_CHOICES['tts']:
            for name in VOICES:
                with self.subTest(model=model,voice=name):
                    c=config();c['models']['tts']['model']=model
                    payload=tts_payload(c,self.u,{**self.voice,'name':name})
                    self.assertEqual(payload['voice'],{'name':name,'languageCode':'ja-JP','modelName':model})
                    self.assertEqual(payload['audioConfig'],{'audioEncoding':'LINEAR16','sampleRateHertz':24000})
                    self.assertEqual(payload['input']['text'],self.u['japanese'])

    def test_invalid_legacy_voice_is_rejected_before_any_provider_or_meter_call(self):
        for value in ('invented-voice','ja-JP-Chirp3-HD-Kore',' Kore ',None,{},[]):
            with self.subTest(value=value):
                session=Session();meter=Meter();provider=Providers(config(),session,meter)
                with self.assertRaises(ContractError) as caught:
                    provider.tts(self.u,{**self.voice,'name':value})
                self.assertEqual(caught.exception.code,'CHARACTER_VOICE')
                self.assertIn('Personajes',str(caught.exception))
                self.assertEqual(session.calls,[]);self.assertEqual(meter.started,[])

    def test_missing_or_nontext_japanese_is_an_actionable_preflight_error(self):
        for value in (None,42,{},'', 'Only English'):
            with self.subTest(value=value),self.assertRaises(ContractError) as caught:
                tts_payload(config(),{**self.u,'japanese':value},self.voice)
            self.assertEqual(caught.exception.code,'JAPANESE')

    def test_optional_empty_direction_is_omitted_and_never_serialized_as_blank_prompt(self):
        for value in ('',None,'   '):
            payload=tts_payload(config(),{**self.u,'acting':value},{**self.voice,'direction':value})
            self.assertNotIn('prompt',payload['input'])

    def test_tts_limits_count_utf8_bytes_not_characters(self):
        payload=tts_payload(config(),{'japanese':'あ'*1333,'acting':''},{**self.voice,'direction':'é'*2000})
        self.assertEqual(len(payload['input']['text'].encode()),3999)
        self.assertEqual(len(payload['input']['prompt'].encode()),4000)
        for u,voice in (({'japanese':'あ'*1334},self.voice),(self.u,{**self.voice,'direction':'é'*2001})):
            with self.assertRaises(ContractError) as caught:tts_payload(config(),u,voice)
            self.assertEqual(caught.exception.code,'TTS_LENGTH')

    def test_schema_proposes_only_voices_the_manual_selector_accepts(self):
        schema=development_schema()
        voice=schema['properties']['bible']['properties']['characters']['items']['properties']['voice']
        self.assertEqual(voice['properties']['name']['enum'],VOICES)
        self.assertEqual(voice['properties']['languageCode']['enum'],['ja-JP'])

    def test_google_rejection_retains_status_field_and_useful_reason_without_retry(self):
        response=Response(400,{'error':{'status':'INVALID_ARGUMENT','message':'Unsupported voice configuration for the requested model.',
            'details':[{'@type':'type.googleapis.com/google.rpc.BadRequest','fieldViolations':[{'field':'voice.name','description':'Invalid value'}]}]}})
        session=Session(response);meter=Meter();provider=Providers(config(),session,meter)
        with self.assertRaises(ContractError) as caught:provider.tts(self.u,self.voice)
        self.assertEqual(caught.exception.code,'PROVIDER_INPUT');self.assertEqual(caught.exception.status,400)
        self.assertIn('INVALID_ARGUMENT',str(caught.exception));self.assertIn('voice.name',str(caught.exception))
        self.assertIn('Unsupported voice configuration',str(caught.exception))
        self.assertEqual(len(session.calls),1);self.assertEqual(meter.ended,[('call1','rejected')])
        self.assertEqual(session.calls[0][1]['json']['voice']['name'],'Kore')
        self.assertEqual(session.calls[0][1]['json']['voice']['modelName'],'gemini-2.5-pro-tts')

    def test_rejection_detail_removes_submitted_content_credentials_and_resource_urls(self):
        text='PRIVATE DIALOGUE';prompt='PRIVATE DIRECTION'
        response=Response(400,{'error':{'status':'INVALID_ARGUMENT','message':f'Invalid input: {text}; {prompt}; Bearer opaque-token; https://host.invalid/?signature=secret user@example.com projects/private-id/locations/global'}})
        detail=rejection_detail(response,{'input':{'text':text,'prompt':prompt}})
        for private in (text,prompt,'opaque-token','signature=secret','user@example.com','private-id'):self.assertNotIn(private,detail)
        self.assertIn('INVALID_ARGUMENT',detail);self.assertLessEqual(len(detail),600)

    def test_unstructured_google_error_does_not_replace_the_original_http_failure(self):
        for value in (None,[],ValueError('not JSON'),{'error':None},{'error':[]}):
            with self.subTest(value=value):self.assertEqual(rejection_detail(Response(400,value),{}),'')

    def test_unknown_submission_never_falls_back_or_repeats_audio(self):
        session=Session(TimeoutError('fixture'));provider=Providers(config(),session,Meter())
        with self.assertRaises(UnknownSubmission):provider.tts(self.u,self.voice)
        self.assertEqual(len(session.calls),1)

    def test_tts_audio_is_received_without_changing_voice_or_model(self):
        content=b'fixture-audio';session=Session(Response(data={'audioContent':base64.b64encode(content).decode()}))
        self.assertEqual(Providers(config(),session,Meter()).tts(self.u,self.voice),content)
        self.assertEqual(len(session.calls),1)
        self.assertEqual(session.calls[0][0],'https://texttospeech.googleapis.com/v1/text:synthesize')

    def test_image_reference_scene_and_variant_prompts_never_use_writer_json_instructions(self):
        entity={'name':'Adult character','age':28,'referencePrompt':'Adult character in a coat','voice':self.voice}
        for options in ({},{'shot':True},{'variant':'Close the eyes, preserve the rest'}):
            prompt=image_prompt(entity,**options)
            self.assertNotIn('Devuelve solo JSON',prompt)
            self.assertIn('Entrega la imagen renderizada',prompt)
        self.assertNotIn('voice',image_prompt(entity))

    def test_mixed_text_and_image_response_receives_actual_image_once(self):
        png=b'fixture-image'
        response={'candidates':[{'finishReason':'STOP','content':{'parts':[
            {'text':'Here is the image.'},{'thought':True,'inlineData':{'mimeType':'image/png','data':base64.b64encode(b'thought').decode()}},
            {'inlineData':{'mimeType':'image/png','data':base64.b64encode(png).decode()}}]}}]}
        session=Session(Response(data={'totalTokens':20}),Response(data=response));meter=Meter()
        result=Providers(config(),session,meter).image(image_prompt({'name':'Adult person','age':28}),[],'9:16')
        self.assertEqual(result,(png,'image/png'));self.assertEqual(meter.started,['image'])
        self.assertEqual(len(session.calls),2,'One free preflight and one generation')
        generation=session.calls[1][1]['json']['generationConfig']
        self.assertEqual(generation['responseModalities'],['TEXT','IMAGE'])
        self.assertEqual(generation['imageConfig']['aspectRatio'],'9:16')

    def test_text_only_blocked_and_empty_images_remain_distinct_without_resubmission(self):
        fixtures=[({'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'No image'}]}}]},'IMAGE_TEXT_ONLY'),
                  ({'promptFeedback':{'blockReason':'SAFETY'}},'IMAGE_BLOCKED'),
                  ({'candidates':[{'finishReason':'MAX_TOKENS'}]},'IMAGE_TRUNCATED'),
                  ({'candidates':[]},'IMAGE_MISSING')]
        for response,code in fixtures:
            with self.subTest(code=code):
                session=Session(Response(data={'totalTokens':20}),Response(data=copy.deepcopy(response)))
                with self.assertRaises(ContractError) as caught:Providers(config(),session,Meter()).image('Adult portrait',[],'16:9')
                self.assertEqual(caught.exception.code,code);self.assertEqual(len(session.calls),2)


if __name__=='__main__':unittest.main()
