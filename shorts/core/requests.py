"""Verified provider contract and finite request scope. No price calculations."""
from .contracts import require

INPUT_LIMIT=131072
TEXT_OUTPUT_LIMIT=32768
IDEAS_OUTPUT_LIMIT=4096
IMAGE_OUTPUT_LIMIT=8192
MODELS={'text':('gemini-3.1-pro-preview','global'), 'analysis':('gemini-3.1-pro-preview','global'),
        'image':('gemini-3.1-flash-image','global'), 'veo':('veo-3.1-generate-001','us-central1'),
        'tts':('gemini-2.5-pro-tts','global'), 'music':('lyria-3-pro-preview','global')}
CALLS={'ideas':{'text':1},'develop':{'text':1},'revise':{'text':1},'image':{'image':1},
       'veo':{'veo':1},'tts':{'tts':1},'music':{'music':1},'analyze':{'analysis':2},
       'review':{'analysis':1},'transcribe':{'transcribe':1},'media':{},'frames':{},'preview':{},'render':{},'import':{}}

def verify_models(config):
    for kind,(model,region) in MODELS.items():
        require(config['models'][kind]=={'model':model,'region':region},'MODEL_CONTRACT','Modelo o región sin verificar: '+kind,503)

def check_call_scope(operation,calls,kind):
    require(operation in CALLS,'OPERATION','Acción desconocida')
    require(not any(c['state']=='submitted_unknown' for c in calls),'SUBMITTED_UNKNOWN','Hay un envío sin confirmar; no se repetirá automáticamente',409)
    require(sum(c['kind']==kind for c in calls)<CALLS[operation].get(kind,0),'CALL_LIMIT','La acción solicitada ya realizó sus llamadas')
