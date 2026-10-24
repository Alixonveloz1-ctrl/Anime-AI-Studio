"""Limited open/closed mouth timing from energy, explicitly not phoneme sync.

Intervals are stored as {'start','end'} maps: Firestore rejects an array
directly inside another array, so [[a,b],...] made every voice, music and
sound-effect asset write fail after the paid call had already run."""
from .contracts import integer,require


def span(interval):
    """(start,end) of an interval, stored as a map (or as a pair by older data)."""
    if isinstance(interval,dict):return interval.get('start'),interval.get('end')
    require(isinstance(interval,(list,tuple)) and len(interval)==2,'INTERVAL','Intervalo inválido')
    return interval[0],interval[1]


def activity_intervals(energies,hop=240,threshold=.008):
    segments=[];start=None;last=None
    for i,energy in enumerate(energies):
        if energy>=threshold:
            if start is None:start=i
            last=i+1
        elif start is not None and (i-last)*hop>=3840:
            if (last-start)*hop>=1920:segments.append({'start':start*hop,'end':last*hop})
            start=None
    if start is not None and (last-start)*hop>=1920:segments.append({'start':start*hop,'end':last*hop})
    return segments


def mouth_frames(audio,offset,frames,begin=0,end=None):
    intervals=[];end=frames if end is None else min(end,frames)
    for activity in audio.get('waveform',{}).get('voiceActivity',[]):
        first,last=span(activity)
        integer(first,'actividad inicial',0,audio['samples']);integer(last,'actividad final',first,audio['samples'])
        a=max(begin,(offset+first)//2000);b=min(end,(offset+last+1999)//2000)
        if a<b:
            if intervals and a<=intervals[-1]['end']:intervals[-1]['end']=max(b,intervals[-1]['end'])
            else:intervals.append({'start':a,'end':b})
    require(len(intervals)<=500,'MOUTH_INTERVALS','Demasiados movimientos: divide el bloque de actuación')
    return intervals
