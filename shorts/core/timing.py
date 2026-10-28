"""24 FPS editorial pauses plus measured PCM, without speech speed fitting."""
from .contracts import integer,require


def is_vocal_sound(utterance):
    # Regla del usuario: un sonido producido por la voz humana (respiración,
    # gemido, gruñido, grito, jadeo, suspiro) se escribe entre paréntesis en
    # el texto en español y NO es diálogo ni pensamiento hablado, aunque su
    # tipo sea dialogue. Solo ese sonido vocal se recorta a la duración del
    # plano; una frase hablada o un pensamiento nunca se recortan.
    text=str(utterance.get('spanish') or '').strip()
    return len(text)>=2 and text.startswith('(') and text.endswith(')')


def voice_layout(shot, voices):
    cursor=integer(shot.get('leadFrames',0),'acción inicial',0,7560)*2000
    rows=[]
    shot_samples=integer(shot.get('frames',0),'duración',1,7560)*2000
    tail_samples=integer(shot.get('tailFrames',0),'acción final',0,7560)*2000
    for utterance,audio in voices:
        cursor+=integer(utterance.get('pauseBeforeFrames',0),'pausa antes',0,7560)*2000
        length=integer(audio['samples'],'voz medida',1,15120000)
        pause_after=integer(utterance.get('pauseAfterFrames',0),'pausa después',0,7560)*2000
        if is_vocal_sound(utterance):
            # Respiración, gemido, gruñido, grito: si dura más de lo que
            # exige el plano, se recorta a lo que queda en el plano después
            # de su pausa posterior y de la acción final. Nunca alarga el
            # plano y nunca se acelera: simplemente suena hasta el final
            # del plano. Los clips de video no se recortan jamás; esos se
            # aceleran o ralentizan en el montaje.
            length=max(0,min(length,shot_samples-cursor-pause_after-tail_samples))
        rows.append({'utterance':utterance,'audio':audio,'offsetSample':cursor,'samples':length})
        cursor+=length+pause_after
    cursor+=tail_samples
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
