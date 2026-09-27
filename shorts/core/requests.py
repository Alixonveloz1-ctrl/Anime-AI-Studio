"""Verified provider contract and finite request scope. No price calculations."""
from .contracts import require

INPUT_LIMIT=131072
TEXT_OUTPUT_LIMIT=32768
IDEAS_OUTPUT_LIMIT=4096
IMAGE_OUTPUT_LIMIT=8192
MODELS={'text':('gemini-3.1-pro-preview','global'), 'analysis':('gemini-3.1-pro-preview','global'),
        'image':('gemini-3.1-flash-image','global'), 'veo':('veo-3.1-generate-001','us-central1'),
        'tts':('gemini-2.5-pro-tts','global'), 'music':('lyria-3-pro-preview','global')}
MODEL_CHOICES={
    'image':[('gemini-3.1-flash-image','Nano Banana 2'),('gemini-2.5-flash-image','Nano Banana'),('gemini-3-pro-image','Nano Banana Pro')],
    'veo':[('veo-3.1-fast-generate-001','Veo 3.1 Fast'),('veo-3.1-generate-001','Veo 3.1')],
    'tts':[('gemini-2.5-flash-tts','Gemini Flash TTS'),('gemini-2.5-pro-tts','Gemini Pro TTS')],
    'music':[('lyria-3-pro-preview','Lyria 3 Pro')],
}
VOICES='Achernar Achird Algenib Algieba Alnilam Aoede Autonoe Callirrhoe Charon Despina Enceladus Erinome Fenrir Gacrux Iapetus Kore Laomedeia Leda Orus Pulcherrima Puck Rasalgethi Sadachbia Sadaltager Schedar Sulafat Umbriel Vindemiatrix Zephyr Zubenelgenubi'.split()

def selected_models(config,settings):
    import copy
    result=copy.deepcopy(config['models'])
    require(isinstance(settings,dict) and set(settings)<=set(MODEL_CHOICES),'MODEL_SELECTION','Selección de generadores inválida')
    for kind,model in settings.items():
        require(model in [m for m,_ in MODEL_CHOICES[kind]],'MODEL_SELECTION','Generador no admitido: '+kind)
        result[kind]={'model':model,'region':MODELS[kind][1]}
    verify_models({'models':result})
    return result
CALLS={'ideas':{'text':1},'develop':{'text':1},'revise':{'text':1},'image':{'image':1},
       'veo':{'veo':1},'tts':{'tts':1},'music':{'music':1},'analyze':{'analysis':2},
       'review':{'analysis':1},'transcribe':{'transcribe':1},'media':{},'frames':{},'preview':{},'render':{},'import':{}}

def verify_models(config):
    for kind,(model,region) in MODELS.items():
        allowed=[m for m,_ in MODEL_CHOICES.get(kind,[(model,model)])]
        require(config['models'][kind].get('model') in allowed and config['models'][kind].get('region')==region,'MODEL_CONTRACT','Modelo o región sin verificar: '+kind,503)

def check_call_scope(operation,calls,kind):
    require(operation in CALLS,'OPERATION','Acción desconocida')
    require(not any(c['state']=='submitted_unknown' for c in calls),'SUBMITTED_UNKNOWN','Hay un envío sin confirmar; no se repetirá automáticamente',409)
    require(sum(c['kind']==kind and c['state']=='quota_rejected' for c in calls)<=3,'RETRY_LIMIT','Se agotaron los reintentos por cuota')
    require(sum(c['kind']==kind and not (kind=='text' and c['state']=='quota_rejected') for c in calls)<CALLS[operation].get(kind,0),'CALL_LIMIT','La acción solicitada ya realizó sus llamadas')
