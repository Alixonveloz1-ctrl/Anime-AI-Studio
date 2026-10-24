"""Bounded camera and region-variant edits; no generation during composition."""
import math
from .contracts import require,integer

# The studio sends hundredths of the image; a fraction that lands on the edge
# must not be refused for the last bit of a float.
EDGE=1e-9


def validate_visual(shot, assets):
    require(shot['treatment'] in ('hold','camera2d','localized','veo'),'TREATMENT','Tratamiento no válido')
    require(shot['treatment']!='veo' or shot.get('maxFrames',shot['frames'])<=192,'VEO_COVERAGE','Divide la toma o elige otro tratamiento: Veo cubre como máximo ocho segundos')
    if shot['treatment']=='camera2d':
        for end in ('start','end'):
            values=shot.get('camera',{}).get(end)
            require(isinstance(values,list) and len(values)==3 and all(type(x) in (int,float) and math.isfinite(x) for x in values),'CAMERA','Faltan zoom y centro de cámara')
            require(1<=values[0]<=2 and all(0<=x<=1 for x in values[1:]),'CAMERA','Zoom 1–2 y centro dentro de la imagen')
    if shot['treatment']=='localized':
        layers=shot.get('layers',[]);require(isinstance(layers,list) and 1<=len(layers)<=8,'LAYERS','Selecciona entre una y ocho variantes')
        for layer in layers:
            a=assets.get(layer.get('assetRevision'))
            require(a and a.get('approvalState')=='approved' and a.get('variantOf')==shot['id'],'LAYER_ASSET','Aprueba una variante de esta toma')
            mask=layer.get('mask',{});require(set(mask)=={'x','y','width','height'},'MASK','Marca una máscara rectangular')
            require(all(type(v) in (int,float) and math.isfinite(v) for v in mask.values()),'MASK','Coordenadas inválidas')
            # A region that ends exactly at the right or bottom edge is inside
            # the image. Comparing the fractions exactly refused one in five of
            # the whole-percent pairs the studio sends (0.67 is not <= 1-0.33),
            # with no way to tell which number the owner had to change.
            require(0<=mask['x']<1 and 0<=mask['y']<1 and 0<mask['width']<=1-mask['x']+EDGE and 0<mask['height']<=1-mask['y']+EDGE,'MASK','La región sale de la imagen')
            mask['width']=min(mask['width'],1-mask['x']);mask['height']=min(mask['height'],1-mask['y'])
            start=integer(layer.get('startFrame'),'entrada de capa',0,shot['frames']-1);end=integer(layer.get('endFrame'),'salida de capa',1,shot['frames'])
            require(start<end and layer.get('approved') is True,'LAYER_APPROVAL','Revisa máscara e intervalo')
            if layer.get('voiceBinding'):
                binding=layer['voiceBinding'];audio=assets.get(binding.get('audioRevision'))
                require(audio and audio['kind']=='pcm' and audio.get('approvalState')=='approved' and audio['entityId']==binding.get('utteranceId') and audio['sha256']==binding.get('audioHash'),'MOUTH_AUDIO','Selecciona una voz aprobada y vigente')
                require('voiceActivity' in audio.get('waveform',{}),'MOUTH_ACTIVITY','Este audio no tiene medición de actividad vocal')
    return shot
