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


def shot_bounds(shot,measured_minimum,draft=False):
    lo=max(measured_minimum,shot.get('minFrames',shot['frames']))
    hi=shot.get('maxFrames',shot['frames'])
    # La duración de una toma se planeó antes de que la voz existiera, así que
    # la voz medida puede no caber. En un borrador manda la voz y la toma se
    # alarga —nunca se acelera el audio—; la toma queda señalada y exportar
    # sigue exigiendo revisarla, porque cambia el metraje aprobado.
    if draft and lo>hi:hi=lo
    require(lo<=hi,'SCRIPT_REVIEW','La voz, pausas y acciones exceden el intervalo aprobado en '+shot['id']+'; revisa esa toma, sin acelerar el audio')
    require(shot['treatment']!='veo' or hi<=192,'VEO_COVERAGE','Divide o cambia el tratamiento de la toma Veo '+shot['id']+': máximo 8 segundos, sin repetir clips')
    return lo,hi


def veo_seconds(shot):
    """Shortest supported clip covering the approved editing interval; no retiming."""
    require(shot.get('treatment')=='veo','VEO_TREATMENT','Esta toma no requiere Veo')
    frames=integer(shot['frames'],'duración Veo',1,192)
    maximum=integer(shot.get('maxFrames',frames),'máximo Veo',frames,192)
    return next(seconds for seconds in (4,6,8) if seconds*24>=maximum)
