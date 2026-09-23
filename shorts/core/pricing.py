"""Dated USD estimates, never a promise about the Cloud Billing invoice.

Micros are integer millionths of USD. Discounts/free credits are excluded.
A budget covers model calls and bounded worker compute separately. Storage,
network, API hosting and builds are reported separately by the installer.
"""
import math
from datetime import date
from .contracts import require

VERIFIED='2026-09-23'
VALID_UNTIL='2026-10-23'
INPUT_LIMIT=131072
TEXT_OUTPUT_LIMIT=32768
IMAGE_OUTPUT_LIMIT=8192
WORKER_SECONDS=3600
# Cloud Run Jobs us-central1: 2 CPU * $0.000018 + 4 GiB * $0.000002 / s.
WORKER_MICROS_PER_SECOND=44
MODELS={'text':('gemini-3.1-pro-preview','global'), 'analysis':('gemini-3.1-pro-preview','global'),
        'image':('gemini-3.1-flash-image','global'), 'veo':('veo-3.1-generate-001','us-central1'),
        'tts':('gemini-2.5-pro-tts','global'), 'music':('lyria-3-pro-preview','global')}
CALLS={'ideas':{'text':2},'develop':{'text':2},'revise':{'text':1},'image':{'image':1},
       'veo':{'veo':1},'tts':{'tts':1},'music':{'music':1},'analyze':{'analysis':2},
       'review':{'analysis':1},'transcribe':{'transcribe':1},'media':{},'frames':{},'preview':{},'render':{}}
SOURCES=['https://cloud.google.com/vertex-ai/generative-ai/pricing',
         'https://cloud.google.com/text-to-speech/pricing',
         'https://cloud.google.com/text-to-speech/docs/gemini-tts',
         'https://cloud.google.com/speech-to-text/pricing',
         'https://cloud.google.com/run/pricing']

def call_limit(kind):
    if kind in ('text','analysis'):return INPUT_LIMIT*2+TEXT_OUTPUT_LIMIT*12
    # Conservative: all image output tokens priced at image rate, including text.
    if kind=='image':return math.ceil(INPUT_LIMIT*.5)+IMAGE_OUTPUT_LIMIT*60
    # Public video-only table says $0.20/count; reserve 8 such units, not one clip.
    # This conservative reservation is not advertised as a verified invoice.
    if kind=='veo':return 8*200000
    # 8000 input bytes upper bound + margin over documented ~655 s output cap.
    if kind=='tts':return 8000+700*25*20
    if kind=='music':return 80000
    # v1 non-data-logging, mono, max 600 s, $0.024/min.
    if kind=='transcribe':return 10*24000
    raise ValueError(kind)

def catalog(config, today=None):
    today=today or date.today()
    require(today<=date.fromisoformat(VALID_UNTIL),'PRICE_EXPIRED','Actualiza ./c para revisar las tarifas antes de nuevas tareas',503)
    for kind,(model,region) in MODELS.items():
        require(config['models'][kind]=={'model':model,'region':region},'PRICE_MODEL','La tarifa no corresponde al modelo/región configurados: '+kind,503)
    return {op:{'maxMicros':sum(call_limit(k)*n for k,n in counts.items())+WORKER_SECONDS*WORKER_MICROS_PER_SECOND,
                'generationMicros':sum(call_limit(k)*n for k,n in counts.items()),
                'workerMicros':WORKER_SECONDS*WORKER_MICROS_PER_SECOND,'calls':counts,
                'verifiedDate':VERIFIED,'validUntil':VALID_UNTIL,'generateAudio':False if op=='veo' else None,
                'basis':'reserva conservadora; no factura','sources':SOURCES}
            for op,counts in CALLS.items()}

def usage_estimate(kind, usage=None, seconds=None):
    """Only lower a reserve using observed usage. Missing usage keeps its ceiling."""
    usage=usage or {}
    if kind in ('text','analysis','image'):
        if 'promptTokenCount' not in usage or 'candidatesTokenCount' not in usage:return call_limit(kind),'reserved_ceiling'
        inp=max(0,int(usage['promptTokenCount']));out=max(0,int(usage['candidatesTokenCount']))+max(0,int(usage.get('thoughtsTokenCount',0)))
        # No discounts assumed. Image modalities may be absent, so overestimate.
        price=math.ceil(inp*(.5 if kind=='image' else 2)+out*(60 if kind=='image' else 12))
        return price,'observed_tokens_conservative_rates'
    if kind=='music':return 80000,'completed_piece'
    if kind=='tts' and seconds is not None:return 8000+math.ceil(seconds*25)*20,'measured_audio_input_ceiling'
    if kind=='transcribe' and seconds is not None:return math.ceil(seconds)*400,'measured_audio'
    return call_limit(kind),'reserved_ceiling'

def reconcile(job, now):
    calls=job.get('providerCalls',[])
    require(all(c['state'] in ('completed','rejected') for c in calls),'UNSETTLED_CALL','Hay una petición sin resultado confirmado',409)
    model=sum(c.get('estimatedMicros',c['ceilingMicros']) for c in calls)
    elapsed=max(60,math.ceil(now-job.get('started',now)))
    compute=min(WORKER_SECONDS,elapsed)*WORKER_MICROS_PER_SECOND
    total=model+compute
    # Preserve actual observed overrun and stop the budget; never hide excess.
    return {'generationMicros':model,'workerMicros':compute,'totalMicros':total,
            'basis':'estimación conservadora de uso; no factura de nube','tariffDate':VERIFIED,
            'overReservation':total>job['reservation']}
