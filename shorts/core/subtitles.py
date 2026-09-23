"""Spanish meaning units anchored to the definitive audio's sample coordinates."""
from .contracts import require, integer, RATE

def validate_segments(segments, samples):
    require(isinstance(segments,list) and 0<len(segments)<=100,'SUBTITLE_SEGMENTS','Añade al menos un bloque')
    previous=0;warnings=[]
    for index,s in enumerate(segments):
        start=integer(s.get('startSample'),'inicio',0,samples-1);end=integer(s.get('endSample'),'fin',1,samples)
        require(previous<=start<end,'SUBTITLE_ORDER','Bloques invertidos o solapados');previous=end
        text=s.get('text');require(isinstance(text,str) and 0<len(text.strip())<=1000,'SUBTITLE_TEXT','Texto vacío o demasiado largo')
        duration=(end-start)/RATE;lines=text.splitlines();cps=len(text.replace('\n',''))/duration
        issues=[]
        if len(lines)>2:issues.append('más de dos líneas')
        if any(len(x)>42 for x in lines):issues.append('línea mayor de 42 caracteres')
        if cps>20:issues.append('más de 20 caracteres por segundo')
        if not .8<=duration<=6:issues.append('duración fuera de 0,8–6 segundos')
        if issues:warnings.append({'block':index+1,'issues':issues,'exceptionApproved':bool(s.get('exceptionReason','').strip())})
    return warnings

def subtitle_segments(utterance, audio, default_text, overrides):
    saved=overrides.get(utterance['id'])
    if saved and saved['audioRevision']==audio['id'] and saved['audioHash']==audio['sha256']:
        return saved['segments'],False
    return [{'text':default_text,'startSample':0,'endSample':audio['samples']}],bool(saved)
