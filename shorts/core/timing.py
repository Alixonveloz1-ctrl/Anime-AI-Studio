"""24 FPS editorial pauses plus measured PCM, without speech speed fitting."""
from .contracts import integer,require


def voice_layout(shot, voices):
    cursor=integer(shot.get('leadFrames',0),'acción inicial',0,7560)*2000
    rows=[]
    for utterance,audio in voices:
        cursor+=integer(utterance.get('pauseBeforeFrames',0),'pausa antes',0,7560)*2000
        length=integer(audio['samples'],'voz medida',1,15120000)
        rows.append({'utterance':utterance,'audio':audio,'offsetSample':cursor})
        cursor+=length+integer(utterance.get('pauseAfterFrames',0),'pausa después',0,7560)*2000
    cursor+=integer(shot.get('tailFrames',0),'acción final',0,7560)*2000
    return rows,(cursor+1999)//2000


def shot_bounds(shot,measured_minimum):
    lo=max(measured_minimum,shot.get('minFrames',shot['frames']))
    hi=shot.get('maxFrames',shot['frames'])
    require(lo<=hi,'SCRIPT_REVIEW','La voz, pausas y acciones exceden el intervalo aprobado en '+shot['id']+'; revisa esa toma, sin acelerar el audio')
    require(shot['treatment']!='veo' or hi<=192,'VEO_COVERAGE','Divide o cambia el tratamiento de la toma Veo '+shot['id']+': máximo 8 segundos, sin repetir clips')
    return lo,hi
