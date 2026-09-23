"""Google-only REST adapters. No model/region/audio fallback; one paid submission."""
import base64
import json
import re
from shorts.core.contracts import require, ContractError

class UnknownSubmission(ContractError):
    def __init__(self):super().__init__('SUBMITTED_UNKNOWN','Resultado de envío desconocido; no se reintentará automáticamente',503)

def vertex(c,kind,method='generateContent'):
    m=c['models'][kind];region=m['region']
    require(re.fullmatch(r'[a-z0-9-]+',region) and re.fullmatch(r'[a-z0-9.-]+',m['model']),'MODEL_CONFIG','Modelo/región inválidos')
    host='aiplatform.googleapis.com' if region=='global' else region+'-aiplatform.googleapis.com'
    return f'https://{host}/v1/projects/{c["project"]}/locations/{region}/publishers/google/models/{m["model"]}:{method}'

def veo_payload(c,shot,image_uri,output_uri):
    require(c['models']['veo']['model']=='veo-3.1-generate-001' and c['models']['veo']['region']=='us-central1','VEO_CAPABILITY','Combinación Veo aún no verificada')
    require(shot.get('durationSeconds') in (4,6,8),'VEO_DURATION','Veo admite 4, 6 u 8 segundos')
    require(shot.get('format','16:9') in ('16:9','9:16'),'VEO_FORMAT','Formato inválido')
    require(shot.get('imageApproved') is True,'IMAGE_APPROVAL','Aprueba la imagen primero')
    instance={'prompt':shot['prompt'],'image':{'gcsUri':image_uri,'mimeType':shot.get('imageMime','image/png')}}
    if shot.get('lastFrameUri'):
        require(shot.get('continuousActionApproved') is True,'LAST_FRAME','El último frame exige acción continua aprobada')
        instance['lastFrame']={'gcsUri':shot['lastFrameUri'],'mimeType':shot.get('lastFrameMime','image/png')}
    return {'instances':[instance],'parameters':{'generateAudio':False,'durationSeconds':shot['durationSeconds'],'sampleCount':1,'aspectRatio':shot.get('format','16:9'),'resolution':'720p','storageUri':output_uri}}

def tts_payload(c,u,voice):
    require(bool(re.search('[\u3040-\u30ff\u3400-\u9fff]',u.get('japanese',''))),'JAPANESE','Falta texto japonés aprobado')
    require(voice.get('languageCode','ja-JP')=='ja-JP','JAPANESE','La voz de Cortos debe ser japonesa')
    return {'input':{'text':u['japanese'],'prompt':voice.get('direction','')+' '+u.get('acting','')},'voice':{'languageCode':'ja-JP','name':voice['name'],'modelName':c['models']['tts']['model']},'audioConfig':{'audioEncoding':'LINEAR16','sampleRateHertz':24000}}

class Providers:
    def __init__(self,c,session):self.c,self.session=c,session
    def post(self,url,payload):
        try:r=self.session.post(url,json=payload,timeout=180)
        except Exception as e:raise UnknownSubmission() from e
        if r.status_code>=500:raise UnknownSubmission()
        if not r.ok:
            code={400:'PROVIDER_INPUT',401:'PROVIDER_AUTH',403:'PROVIDER_PERMISSION',404:'MODEL_UNAVAILABLE',429:'PROVIDER_QUOTA'}.get(r.status_code,'PROVIDER_ERROR')
            raise ContractError(code,f'Google rechazó la solicitud ({r.status_code}). No se cambió modelo ni se reenvió.',r.status_code)
        return r.json()
    def text(self,prompt,parts=None,analysis=False):
        kind='analysis' if analysis else 'text'
        body={'contents':[{'role':'user','parts':[{'text':prompt},*(parts or [])]}],'generationConfig':{'responseMimeType':'application/json','temperature':.7,'maxOutputTokens':32768}}
        data=self.post(vertex(self.c,kind),body)
        try:return json.loads(''.join(x.get('text','') for x in data['candidates'][0]['content']['parts']))
        except (KeyError,IndexError,ValueError) as e:raise ContractError('MODEL_SCHEMA','Respuesta incompleta; no se creó una candidata válida') from e
    def image(self,prompt,references,aspect):
        parts=[{'text':prompt}]
        for a in references:
            require(a['approvalState']=='approved','REFERENCE','Referencia no aprobada')
            parts.append({'fileData':{'fileUri':a['uri'],'mimeType':a['mimeType']}})
        data=self.post(vertex(self.c,'image'),{'contents':[{'role':'user','parts':parts}],'generationConfig':{'responseModalities':['TEXT','IMAGE'],'imageConfig':{'aspectRatio':aspect}}})
        for p in data.get('candidates',[{}])[0].get('content',{}).get('parts',[]):
            if p.get('inlineData',{}).get('mimeType','').startswith('image/'):
                return base64.b64decode(p['inlineData']['data']),p['inlineData']['mimeType']
        raise ContractError('IMAGE_MISSING','No se recibió imagen; no hay candidata válida')
    def veo(self,shot,image_uri,output_uri):return self.post(vertex(self.c,'veo','predictLongRunning'),veo_payload(self.c,shot,image_uri,output_uri))
    def poll_veo(self,name):
        prefix=f'projects/{self.c["project"]}/locations/{self.c["models"]["veo"]["region"]}/publishers/google/models/{self.c["models"]["veo"]["model"]}/operations/'
        require(name.startswith(prefix),'OPERATION','Operación ajena')
        return self.post(vertex(self.c,'veo','fetchPredictOperation'),{'operationName':name})
    def tts(self,u,voice):
        r=self.c['models']['tts']['region'];require(r in ('global','us','eu','northamerica-northeast1'),'TTS_REGION','Región TTS no verificada')
        host=('' if r=='global' else r+'-')+'texttospeech.googleapis.com'
        result=self.post('https://'+host+'/v1/text:synthesize',tts_payload(self.c,u,voice))
        return base64.b64decode(result['audioContent'])
    def music(self,prompt,seconds):
        require(self.c['models']['music']=={'model':'lyria-3-pro-preview','region':'global'},'MUSIC_MODEL','Configuración Lyria pendiente de verificar')
        require(0<seconds<=184,'MUSIC_DURATION','Una pieza Lyria no puede cubrir 300 segundos')
        result=self.post(f'https://aiplatform.googleapis.com/v1beta1/projects/{self.c["project"]}/locations/global/interactions',{'model':self.c['models']['music']['model'],'input':[{'type':'text','text':f'Instrumental music only. No vocals, lyrics or speech. Requested duration {seconds} seconds. '+prompt}]})
        require(result.get('status')=='completed','MUSIC_PENDING','Lyria no devolvió una pieza completada')
        aud=next((x for x in result.get('outputs',[]) if x.get('type')=='audio'),None)
        require(aud and aud.get('mime_type')=='audio/mpeg','MUSIC_FORMAT','Salida Lyria inesperada')
        return base64.b64decode(aud['data'])
