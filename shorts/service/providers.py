"""Google-only REST adapters. No model/region/audio fallback; one paid submission."""
import base64
import json
import re
import io
import wave
import random
import time
from email.utils import parsedate_to_datetime
from shorts.core.requests import INPUT_LIMIT, TEXT_OUTPUT_LIMIT, IMAGE_OUTPUT_LIMIT, VOICES, verify_models
from shorts.core.contracts import require, ContractError

class UnknownSubmission(ContractError):
    def __init__(self):super().__init__('SUBMITTED_UNKNOWN','Resultado de envío desconocido; no se reintentará automáticamente',503)

def vertex(c,kind,method='generateContent'):
    m=c['models'][kind];region=m['region']
    require(re.fullmatch(r'[a-z0-9-]+',region) and re.fullmatch(r'[a-z0-9.-]+',m['model']),'MODEL_CONFIG','Modelo/región inválidos')
    host='aiplatform.googleapis.com' if region=='global' else region+'-aiplatform.googleapis.com'
    return f'https://{host}/v1/projects/{c["project"]}/locations/{region}/publishers/google/models/{m["model"]}:{method}'

def veo_payload(c,shot,image_uri,output_uri):
    from shorts.core.requests import MODEL_CHOICES
    require(c['models']['veo']['model'] in [m for m,_ in MODEL_CHOICES['veo']] and c['models']['veo']['region']=='us-central1','VEO_CAPABILITY','Combinación Veo aún no verificada')
    require(shot.get('durationSeconds') in (4,6,8),'VEO_DURATION','Veo admite 4, 6 u 8 segundos')
    require(shot.get('format','16:9') in ('16:9','9:16'),'VEO_FORMAT','Formato inválido')
    require(shot.get('imageApproved') is True,'IMAGE_APPROVAL','Aprueba la imagen primero')
    instance={'prompt':shot['prompt'],'image':{'gcsUri':image_uri,'mimeType':shot.get('imageMime','image/png')}}
    if shot.get('lastFrameUri'):
        require(shot.get('continuousActionApproved') is True,'LAST_FRAME','El último frame exige acción continua aprobada')
        instance['lastFrame']={'gcsUri':shot['lastFrameUri'],'mimeType':shot.get('lastFrameMime','image/png')}
    return {'instances':[instance],'parameters':{'generateAudio':False,'durationSeconds':shot['durationSeconds'],'sampleCount':1,'aspectRatio':shot.get('format','16:9'),'resolution':'720p','storageUri':output_uri}}

def tts_payload(c,u,voice):
    # Validate before begin_call: an invalid stored voice never consumes a
    # provider submission. Do not silently substitute another character voice.
    require(isinstance(u,dict) and isinstance(u.get('japanese'),str) and bool(re.search('[\u3040-\u30ff\u3400-\u9fff]',u['japanese'])),'JAPANESE','Falta texto japonés aprobado')
    require(isinstance(voice,dict) and voice.get('name') in VOICES,'CHARACTER_VOICE','La voz guardada no pertenece al catálogo Gemini TTS. Abre Personajes, elige una voz válida y vuelve a generar.')
    require(voice.get('languageCode','ja-JP')=='ja-JP','JAPANESE','La voz de Cortos debe ser japonesa')
    direction=voice.get('direction') or '';acting=u.get('acting') or ''
    require(isinstance(direction,str) and isinstance(acting,str),'TTS_DIRECTION','La dirección de voz y la actuación deben ser texto.')
    prompt=' '.join(part.strip() for part in (direction,acting) if part.strip())
    require(len(u['japanese'].encode())<=4000 and len(prompt.encode())<=4000,'TTS_LENGTH','Texto o dirección supera 4000 bytes; divide la intervención antes de generar')
    inputs={'text':u['japanese']}
    if prompt:inputs['prompt']=prompt
    return {'input':inputs,'voice':{'languageCode':'ja-JP','name':voice['name'],'modelName':c['models']['tts']['model']},'audioConfig':{'audioEncoding':'LINEAR16','sampleRateHertz':24000}}


def rejection_detail(response,payload):
    """Bounded detail for the authenticated job owner, never a raw body/log.

    Remove submitted content and resource/credential-like values before keeping
    Google's useful explanation. Gateway logs continue to contain codes only.
    """
    try:error=response.json().get('error',{})
    except (ValueError,TypeError,AttributeError):return ''
    if not isinstance(error,dict):return ''
    status=error.get('status','')
    if not isinstance(status,str) or not re.fullmatch(r'[A-Z_]{1,64}',status):status=''
    message=error.get('message','')
    if not isinstance(message,str):message=''
    message=message[:4000]
    sensitive=[]
    def collect(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if key in ('text','prompt','data','audioContent','fileUri','gcsUri','storageUri') and isinstance(item,str) and len(item)>=4:sensitive.append(item)
                else:collect(item)
        elif isinstance(value,list):
            for item in value:collect(item)
    collect(payload)
    for value in sorted(sensitive,key=len,reverse=True):message=message.replace(value,'[contenido]')
    if 'PRIVATE KEY' in message:message='Detalle omitido por contener datos sensibles.'
    message=re.sub(r'(?i)\b(?:Bearer|Basic)\s+\S+','[credencial]',message)
    message=re.sub(r'(?i)(?:https?://|gs://)\S+','[recurso]',message)
    message=re.sub(r'\b(?:AIza[A-Za-z0-9_-]+|ya29\.[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_.-]+)\b','[credencial]',message)
    message=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[cuenta]',message)
    message=re.sub(r'\bprojects/[^\s,;]+','[recurso]',message)
    message=re.sub(r'[A-Za-z0-9_+/=.-]{80,}','[valor]',message)
    message=' '.join(message.split())[:420]
    fields=[]
    details=error.get('details',[])
    if isinstance(details,list):
        for detail in details:
            if not isinstance(detail,dict) or not str(detail.get('@type','')).endswith('google.rpc.BadRequest'):continue
            violations=detail.get('fieldViolations',[])
            if not isinstance(violations,list):continue
            for row in violations:
                field=row.get('field') if isinstance(row,dict) else None
                if isinstance(field,str) and re.fullmatch(r'(?:input|voice|audioConfig|generationConfig)(?:\.[A-Za-z][A-Za-z0-9_]{0,40}){1,4}',field):fields.append(field)
    return ' · '.join(part for part in (status,message,('Campos: '+', '.join(dict.fromkeys(fields))) if fields else '') if part)[:600]


def quota_delay(response,attempt):
    """Honor Retry-After/RetryInfo; never retry sooner than local backoff."""
    delay=60*(2**attempt)+random.uniform(0,10)
    header=getattr(response,'headers',{}).get('Retry-After')
    if isinstance(header,str):
        try:delay=max(delay,float(header))
        except ValueError:
            try:delay=max(delay,parsedate_to_datetime(header).timestamp()-time.time())
            except (ValueError,TypeError,OverflowError):pass
    try:
        for detail in response.json().get('error',{}).get('details',[]):
            if detail.get('@type','').endswith('google.rpc.RetryInfo'):
                delay=max(delay,float(detail.get('retryDelay','0s').removesuffix('s')))
    except (ValueError,TypeError,AttributeError):pass
    return delay

class Providers:
    def __init__(self,c,session,meter=None):
        verify_models(c);self.c,self.session,self.meter=c,session,meter;self.quota_waited=0;self.retry_deadline=time.monotonic()+1200
    def post(self,url,payload,kind=None,retry_quota=False,read_only=False):
        retry_enabled=self.meter is not None and (kind=='text' or retry_quota)
        for attempt in range(4 if retry_enabled else 1):
            if kind=='text' and self.meter:self.meter.pace_text()
            call=self.meter.begin_call(kind,url,payload) if self.meter and kind else None
            try:r=self.session.post(url,json=payload,timeout=180)
            except Exception as e:
                if not read_only:raise UnknownSubmission() from e
                raise ContractError('PROVIDER_CHECK_FAILED','No se pudo completar la consulta a Google. Esta consulta no genera contenido.',503) from e
            if r.status_code>=500:
                if not read_only:raise UnknownSubmission()
                raise ContractError('PROVIDER_CHECK_FAILED','Google no pudo completar la consulta. Esta consulta no genera contenido.',503)
            if not r.ok:
                quota=r.status_code==429
                if call:self.meter.end_call(call,'quota_rejected' if quota and retry_enabled else 'rejected')
                if quota and retry_enabled and attempt<3:
                    delay=quota_delay(r,attempt)
                    require(self.quota_waited+delay<=600 and time.monotonic()+delay+180<=self.retry_deadline,'PROVIDER_QUOTA','Google pide una espera larga por cuota. El progreso queda guardado; no se enviaron más solicitudes.',429)
                    self.quota_waited+=delay
                    self.meter.wait_for_provider(delay,'quota',attempt+1)
                    continue
                code={400:'PROVIDER_INPUT',401:'PROVIDER_AUTH',403:'PROVIDER_PERMISSION',404:'MODEL_UNAVAILABLE',429:'PROVIDER_QUOTA'}.get(r.status_code,'PROVIDER_ERROR')
                message='Google mantiene el límite de cuota (429) después de los reintentos con espera. Lo terminado sigue guardado.' if quota and retry_enabled else f'Google rechazó la solicitud ({r.status_code}). No se cambió modelo ni se reenvió.'
                detail=rejection_detail(r,payload)
                if detail:message+=' Detalle de Google: '+detail
                raise ContractError(code,message,r.status_code)
            try:data=r.json()
            except ValueError as e:
                if call:self.meter.end_call(call,'completed')
                raise ContractError('PROVIDER_RESPONSE','Google respondió con datos ilegibles. No se repitió la solicitud.',502) from e
            if call:self.meter.end_call(call,'completed')
            require(isinstance(data,dict),'PROVIDER_RESPONSE','Google devolvió una respuesta inesperada. No se repitió la solicitud.',502)
            return data
    def check_input(self,kind,contents):
        # countTokens is a free preflight. It cannot trigger a generation.
        data=self.post(vertex(self.c,kind,'countTokens'),{'contents':contents},retry_quota=kind=='text',read_only=True)
        require(type(data.get('totalTokens')) is int and data['totalTokens']<=INPUT_LIMIT,'INPUT_TOKENS','Entrada supera el límite admitido por esta operación; reduce el alcance antes de generar')
    def text(self,prompt,parts=None,analysis=False,max_output_tokens=TEXT_OUTPUT_LIMIT,response_schema=None):
        kind='analysis' if analysis else 'text'
        require(type(max_output_tokens) is int and 1<=max_output_tokens<=TEXT_OUTPUT_LIMIT,'OUTPUT_LIMIT','Límite de salida inválido')
        body={'contents':[{'role':'user','parts':[{'text':prompt},*(parts or [])]}],'generationConfig':{'responseMimeType':'application/json','temperature':.7,'maxOutputTokens':max_output_tokens,'thinkingConfig':{'thinkingLevel':'LOW'}}}
        if response_schema is not None:
            require(isinstance(response_schema,dict),'RESPONSE_SCHEMA','Estructura de respuesta inválida')
            body['generationConfig']['responseSchema']=response_schema
        self.check_input(kind,body['contents'])
        data=self.post(vertex(self.c,kind),body,kind)
        candidate=(data.get('candidates') or [{}])[0]
        require(candidate.get('finishReason')!='MAX_TOKENS','MODEL_TRUNCATED','Google alcanzó el límite de respuesta; no se creó una candidata ni se repitió la generación')
        require(candidate.get('finishReason') not in ('SAFETY','BLOCKLIST','PROHIBITED_CONTENT') and not data.get('promptFeedback',{}).get('blockReason'),'MODEL_BLOCKED','Google bloqueó la propuesta. Revisa el concepto; no se repitió la generación')
        try:return json.loads(''.join(x.get('text','') for x in data['candidates'][0]['content']['parts'] if not x.get('thought')))
        except (KeyError,IndexError,ValueError) as e:raise ContractError('MODEL_SCHEMA','Respuesta incompleta; no se creó una candidata válida') from e
    def image(self,prompt,references,aspect):
        limit=3 if self.c['models']['image']['model']=='gemini-2.5-flash-image' else 14
        require(len(references)<=limit,'IMAGE_REFERENCES',f'El generador elegido admite hasta {limit} referencias por imagen. Elige otro generador para conservar todos los personajes y lugares.')
        parts=[{'text':prompt}]
        for a in references:
            require(a['approvalState']=='approved','REFERENCE','Referencia no aprobada')
            parts.append({'text':'Referencia visual: '+a.get('referenceLabel',a.get('entityId','referencia aprobada'))+'. Conserva su identidad y diseño al representar este elemento.'})
            parts.append({'fileData':{'fileUri':a['uri'],'mimeType':a['mimeType']}})
        contents=[{'role':'user','parts':parts}]
        self.check_input('image',contents)
        image_config={'aspectRatio':aspect}
        if self.c['models']['image']['model']!='gemini-2.5-flash-image':image_config['imageSize']='1K'
        data=self.post(vertex(self.c,'image'),{'contents':contents,'generationConfig':{'maxOutputTokens':IMAGE_OUTPUT_LIMIT,'responseModalities':['TEXT','IMAGE'],'imageConfig':image_config}},'image')
        candidate=(data.get('candidates') or [{}])[0]
        parts=candidate.get('content',{}).get('parts',[]) or []
        reason=candidate.get('finishReason','UNKNOWN');blocked=data.get('promptFeedback',{}).get('blockReason')
        summary={'finishReason':reason if isinstance(reason,str) and re.fullmatch('[A-Z_]{1,64}',reason) else 'UNKNOWN',
                 'blocked':bool(blocked),'textParts':sum('text' in p and not p.get('thought') for p in parts),
                 'imageParts':sum(p.get('inlineData',{}).get('mimeType','').startswith('image/') and not p.get('thought') for p in parts)}
        recorder=getattr(self.meter,'record_image_response',None)
        if callable(recorder):recorder(summary)
        require(not blocked and reason not in ('SAFETY','IMAGE_SAFETY','BLOCKLIST','PROHIBITED_CONTENT','RECITATION','IMAGE_PROHIBITED_CONTENT','IMAGE_RECITATION'),'IMAGE_BLOCKED','Google bloqueó la imagen solicitada. Revisa la descripción visual; no se repitió la generación.')
        require(reason!='MAX_TOKENS','IMAGE_TRUNCATED','Google agotó el límite de respuesta antes de completar la imagen. No se repitió la generación.')
        for p in parts:
            inline=p.get('inlineData',{})
            if not p.get('thought') and inline.get('mimeType','').startswith('image/') and inline.get('data'):
                try:raw=base64.b64decode(inline['data'],validate=True)
                except (ValueError,TypeError):raise ContractError('IMAGE_INVALID','Google devolvió un archivo de imagen ilegible.')
                require(raw,'IMAGE_INVALID','Google devolvió un archivo de imagen vacío.')
                return raw,inline['mimeType']
        if summary['textParts']:raise ContractError('IMAGE_TEXT_ONLY','Google respondió con texto en lugar de una imagen. No se creó un archivo ni se repitió la solicitud.')
        raise ContractError('IMAGE_MISSING','Google terminó sin entregar una imagen. Motivo registrado: '+summary['finishReason']+'. No se repitió la solicitud.')
    def veo(self,shot,image_uri,output_uri):return self.post(vertex(self.c,'veo','predictLongRunning'),veo_payload(self.c,shot,image_uri,output_uri),'veo')
    def poll_veo(self,name):
        prefix=f'projects/{self.c["project"]}/locations/{self.c["models"]["veo"]["region"]}/publishers/google/models/{self.c["models"]["veo"]["model"]}/operations/'
        require(name.startswith(prefix),'OPERATION','Operación ajena')
        try:return self.post(vertex(self.c,'veo','fetchPredictOperation'),{'operationName':name},read_only=True)
        except ContractError as e:
            raise ContractError('VEO_PENDING','No se pudo consultar el video. Su operación sigue guardada; reanudar consultará el mismo video sin generar otro.',503) from e
    def poll_speech(self,name):
        require(isinstance(name,str) and re.fullmatch(r'[0-9]{1,40}',name),'OPERATION','Operación Speech inválida')
        try:response=self.session.get('https://speech.googleapis.com/v1/operations/'+name,timeout=30)
        except Exception as e:raise ContractError('SPEECH_PENDING','No se pudo consultar la operación conocida',503) from e
        require(response.ok,'SPEECH_PENDING','Consulta Speech pendiente; no se reenvía audio',503)
        return response.json()
    def tts(self,u,voice):
        r=self.c['models']['tts']['region'];require(r in ('global','us','eu','northamerica-northeast1'),'TTS_REGION','Región TTS no verificada')
        host=('' if r=='global' else r+'-')+'texttospeech.googleapis.com'
        result=self.post('https://'+host+'/v1/text:synthesize',tts_payload(self.c,u,voice),'tts')
        return audio_bytes(result.get('audioContent'),'TTS')
    def music(self,prompt,seconds):
        require(self.c['models']['music']=={'model':'lyria-3-pro-preview','region':'global'},'MUSIC_MODEL','Configuración Lyria pendiente de verificar')
        require(0<seconds<=184,'MUSIC_DURATION','Una pieza Lyria no puede cubrir 300 segundos')
        result=self.post(f'https://aiplatform.googleapis.com/v1beta1/projects/{self.c["project"]}/locations/global/interactions',{'model':self.c['models']['music']['model'],'input':[{'type':'text','text':f'Instrumental music only. No vocals, lyrics or speech. Requested duration {seconds} seconds. '+prompt}]},'music')
        require(result.get('status')=='completed','MUSIC_PENDING','Lyria no devolvió una pieza completada')
        aud=next((x for x in result.get('outputs',[]) if x.get('type')=='audio'),None)
        require(aud and aud.get('mime_type') in ('audio/mpeg','audio/mp3'),'MUSIC_FORMAT','Lyria no entregó audio MP3. No se repitió la generación.')
        return audio_bytes(aud.get('data'),'MUSIC')

def audio_bytes(value,kind):
    require(isinstance(value,str) and value,'{}_EMPTY'.format(kind),'Google terminó sin entregar el archivo de audio. No se repitió la generación.')
    try:raw=base64.b64decode(value,validate=True)
    except (ValueError,TypeError) as e:
        raise ContractError(kind+'_INVALID','Google devolvió un archivo de audio ilegible. No se repitió la generación.') from e
    require(raw,kind+'_EMPTY','Google devolvió un archivo de audio vacío. No se repitió la generación.')
    return raw
