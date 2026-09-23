"""Limited open/closed mouth timing from energy, explicitly not phoneme sync."""
from .contracts import integer,require


def activity_intervals(energies,hop=240,threshold=.008):
    segments=[];start=None;last=None
    for i,energy in enumerate(energies):
        if energy>=threshold:
            if start is None:start=i
            last=i+1
        elif start is not None and (i-last)*hop>=3840:
            if (last-start)*hop>=1920:segments.append([start*hop,last*hop])
            start=None
    if start is not None and (last-start)*hop>=1920:segments.append([start*hop,last*hop])
    return segments


def mouth_frames(audio,offset,frames,begin=0,end=None):
    intervals=[];end=frames if end is None else min(end,frames)
    for first,last in audio.get('waveform',{}).get('voiceActivity',[]):
        integer(first,'actividad inicial',0,audio['samples']);integer(last,'actividad final',first,audio['samples'])
        a=max(begin,(offset+first)//2000);b=min(end,(offset+last+1999)//2000)
        if a<b:
            if intervals and a<=intervals[-1][1]:intervals[-1][1]=max(b,intervals[-1][1])
            else:intervals.append([a,b])
    require(len(intervals)<=500,'MOUTH_INTERVALS','Demasiados movimientos: divide el bloque de actuación')
    return intervals
