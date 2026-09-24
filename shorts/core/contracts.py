"""Cortos v2: pure contracts. No legacy imports, network or filesystem writes."""
from fractions import Fraction
import copy
import hashlib
import json
import re

FPS, RATE, FRAMES, SAMPLES = 24, 48000, 7200, 14400000
TRACKS = ('dialogue', 'thought', 'narration', 'system', 'music', 'ambience', 'sfx')
GENRES = ('acción','aventura','fantasía','isekai','drama','psicológico','terror','misterio','romance','comedia','comedia romántica','vida cotidiana','ciencia ficción','mecha','sobrenatural','supervivencia','deportes','videojuego/sistema')

class ContractError(ValueError):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.status = code, status

def require(ok, code, message, status=422):
    if not ok:
        raise ContractError(code, message, status)

def integer(value, name, lo=0, hi=SAMPLES):
    require(type(value) is int and lo <= value <= hi, 'INVALID_INTEGER', f'{name}: entero fuera de rango')
    return value

def ident(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value), 'INVALID_ID', 'Identificador inválido')
    return value

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def revision(current, expected):
    require(type(expected) is int and current['revision'] == expected, 'REVISION_CONFLICT', 'La revisión cambió en otra sesión', 409)

def project(owner, project_id, data):
    require(data.get('genre') in GENRES, 'GENRE', 'Selecciona un género')
    require(data.get('format', '16:9') in ('16:9','9:16'), 'FORMAT', 'Formato inválido')
    require(isinstance(data.get('subgenres', []), list) and all(isinstance(x,str) and len(x)<100 for x in data.get('subgenres',[])), 'SUBGENRES', 'Subgéneros inválidos')
    return dict(id=ident(project_id), owner=owner, schemaVersion=2, projectKind='anime_short', revision=1,
        title=str(data.get('title','Nuevo corto'))[:180], genre=data['genre'], subgenres=data.get('subgenres',[]),
        concept=str(data.get('concept',''))[:6000], format=data.get('format','16:9'), duration=300, fps=FPS,
        spokenLanguage='ja-JP', subtitleLanguage='es', stage='ideas', selectedIdea=None, archived=False)

def validate_ideas(data):
    require(isinstance(data,list) and len(data)==3, 'THREE_IDEAS', 'Se requieren exactamente tres propuestas')
    for idea in data:
        require(isinstance(idea,dict) and set(idea)=={'id','title','premise'}, 'IDEA_SCHEMA', 'Cada propuesta necesita solo título y concepto')
        for key,limit in (('title',120),('premise',600)):
            require(isinstance(idea.get(key),str) and 0<len(idea[key].strip())<=limit, 'IDEA_SCHEMA', 'Título o concepto incompleto o demasiado largo')
        ident(idea['id'])
    for key in ('id','title','premise'):
        require(len({' '.join(x[key].casefold().split()) for x in data})==3, 'DUPLICATE_IDEA', 'Propuestas repetidas')
    return data

def plan_beats(beats, target=FRAMES):
    """Constrained water filling; speech/action minima are measured elsewhere."""
    require(bool(beats), 'NO_BEATS', 'Faltan unidades dramáticas')
    for b in beats:
        for k in ('minFrames','preferredFrames','maxFrames'):
            integer(b[k],k,0,FRAMES)
        require(b['minFrames'] <= b['preferredFrames'] <= b['maxFrames'], 'BEAT_BOUNDS', 'Duraciones incompatibles')
        require(b.get('timingEvidence') in ('measured_audio','approved_silence','approved_action'), 'UNMEASURED_TIMING', 'Falta audio real o duración de acción/pausa aprobada')
    require(sum(b['minFrames'] for b in beats)<=target<=sum(b['maxFrames'] for b in beats), 'SCRIPT_REVIEW', 'El contenido no cabe: revisa guion o pausas')
    sizes=[b['preferredFrames'] for b in beats]
    diff=target-sum(sizes)
    while diff:
        sign=1 if diff>0 else -1
        eligible=[i for i,b in enumerate(beats) if (sizes[i]<b['maxFrames'] if sign>0 else sizes[i]>b['minFrames'])]
        for i in eligible:
            sizes[i]+=sign
            diff-=sign
            if not diff: break
    start=0
    result=[]
    for b,n in zip(beats,sizes):
        result.append({**b,'startFrame':start,'frames':n})
        start+=n
    return result

def visual_fingerprint(shot):
    return digest({k:v for k,v in shot.items() if k in ('assetRevision','frames','treatment','camera','layers','trimSeconds','speed')})

def resolve_event(shot, event):
    require(event.get('visible') is True, 'EVENT_UNCERTAIN', 'Evento ausente o sin verificar')
    require(event['videoRevision']==shot['assetRevision'], 'STALE_EVENT', 'Cambió el video: revisa el evento')
    if event.get('visualFingerprint'):
        require(event['visualFingerprint']==visual_fingerprint(shot),'STALE_EVENT','La edición visual cambió: revisa el contacto')
    speed=Fraction(str(shot.get('speed',1)))
    require(Fraction(9,10)<=speed<=Fraction(11,10) or shot.get('retimeApproved') is True, 'RETIME_APPROVAL', 'Velocidad requiere aprobación')
    require(speed>0 and not shot.get('timeRamp'), 'UNSUPPORTED_TIME_MAP', 'Mapa temporal no compatible')
    source=Fraction(event['pts'], event['timebase'])
    trim=Fraction(str(shot.get('trimSeconds',0)))
    local=source if event.get('coordinateSpace')=='shot_output' else (source-trim)/speed
    require(0<=local<Fraction(shot['frames'],FPS), 'EVENT_CUT', 'El evento queda fuera del recorte')
    sample=round((Fraction(shot['startFrame'],FPS)+local)*RATE)
    return {'sample':sample,'frame':round(Fraction(sample*FPS,RATE))}

def resolve_cue(cue, event_sample, audio_samples):
    sync=integer(cue['sourceSyncSample'],'ataque',0,audio_samples-1)
    trim=integer(cue.get('trimInSample',0),'entrada',0,audio_samples-1)
    end=integer(cue.get('trimOutSample',audio_samples),'salida',1,audio_samples)
    require(trim<=sync<end,'CUT_ATTACK','El recorte elimina el ataque')
    offset=integer(cue.get('offsetSamples',0),'offset',-SAMPLES,SAMPLES)
    start=event_sample-(sync-trim)+offset
    require(start>=0,'NEGATIVE_CUE','La preparación cae antes del programa; requiere decisión editorial')
    require(start+end-trim<=SAMPLES,'CUE_TAIL','La cola excede el programa; requiere recorte aprobado')
    return {**cue,'resolvedStartSample':start,'trimInSample':trim,'trimOutSample':end}

def edit_cue(cue, patch, expected, source='manual'):
    revision(cue,expected)
    allowed={'sourceSyncSample','trimInSample','trimOutSample','offsetSamples','gainDb','pan','fadeInSamples','fadeOutSamples','eventId','reason'}
    require(set(patch)<=allowed,'FIELDS','Campos de ajuste no permitidos')
    require(source=='manual' or not cue.get('manualLock'), 'MANUAL_LOCK', 'La IA solo puede proponer una alternativa',409)
    out={**copy.deepcopy(cue),**patch,'revision':cue['revision']+1,'approvalState':'candidate','correctionSource':source,'manualLock':False}
    integer(out.get('offsetSamples',0),'offset',-SAMPLES,SAMPLES)
    gain=out.get('gainDb',0)
    require(type(gain) in (int,float) and -60<=gain<=12,'GAIN','Ganancia inválida')
    return out

def stale_on_change(cue, old_shot, new_shot, audio_revision):
    out=copy.deepcopy(cue)
    if any(old_shot.get(k)!=new_shot.get(k) for k in ('assetRevision','trimSeconds','speed','frames')) or cue['audioRevision']!=audio_revision:
        out['approvalState']='stale'
    return out

def cue_render_data(cue):
    # Analysis proposals and attempts are workflow metadata, not changes to a
    # locked edit. They must not invalidate an approved preview or its cache.
    ignored={'analysisAttempts','analysisScan','proposedEventId','created','jobId','at','author'}
    return {k:copy.deepcopy(v) for k,v in cue.items() if k not in ignored}

def compile_timeline(manifest, final=False):
    allowed={'schemaVersion','projectId','format','fps','sampleRate','frames','assets','shots','cues','events','subtitles','developmentId','globalGainDb','draftIssues','cueOverrides','mixPolicy'}
    require(set(manifest)<=allowed,'MANIFEST_FIELDS','El manifiesto contiene campos no admitidos; no se ejecutan comandos')
    require(not final or not manifest.get('draftIssues'), 'DRAFT_RESOURCES', 'Resuelve los recursos provisionales antes del final')
    require(manifest.get('schemaVersion')==2,'SCHEMA','Esquema incompatible')
    require(manifest.get('fps')==FPS and manifest.get('sampleRate')==RATE and manifest.get('frames')==FRAMES,'TIMEBASE','Se requieren 7200 frames a 24 FPS y 48 kHz')
    assets=manifest['assets']; shots=manifest['shots']; project_id=ident(manifest['projectId'])
    require(bool(shots),'NO_SHOTS','Faltan tomas')
    for key,a in assets.items():
        ident(key)
        require(a.get('projectId')==project_id,'CROSS_PROJECT','Recurso de otro proyecto')
        require(re.fullmatch('[a-f0-9]{64}',a.get('sha256','')),'CHECKSUM','Falta checksum')
        require(a.get('kind')!='veo_raw','RAW_VEO','Original Veo en cuarentena')
        require(a.get('approvalState')=='approved' or not final,'UNAPPROVED','Recurso sin aprobación vigente')
    cursor=0; last_video=None
    for shot in shots:
        ident(shot['id']); integer(shot['frames'],'duración',1,FRAMES)
        require(shot['startFrame']==cursor,'COVERAGE','Hueco o solapamiento visual no declarado')
        cursor+=shot['frames']
        treatment=shot['treatment']
        require(treatment in ('hold','camera2d','localized','veo','black'),'TREATMENT','Tratamiento no compatible')
        if treatment=='black':
            require(shot.get('approvedBlack') is True,'BLACK','Negro no aprobado'); continue
        a=assets[shot['assetRevision']]
        if treatment=='veo':
            require(a['kind']=='veo_silent_validated' and a.get('audioStreams')==0,'VEO_AUDIO','Solo se admite Veo validado sin audio')
            require(last_video!=shot['assetRevision'],'REPEATED_VIDEO','Clip repetido consecutivamente')
            last_video=shot['assetRevision']
        else: last_video=None
        speed=Fraction(str(shot.get('speed',1)))
        require(speed>0 and (Fraction(9,10)<=speed<=Fraction(11,10) or shot.get('retimeApproved') is True),'RETIME','Velocidad no aprobada')
        require(not shot.get('timeRamp'),'TIME_RAMP','Rampa no implementada: requiere revisión')
    require(cursor==FRAMES,'DURATION','El montaje debe durar 300 segundos')
    resolved=[]
    for cue in manifest.get('cues',[]):
        require(cue['track'] in TRACKS,'TRACK','Pista inválida')
        if cue.get('omissionApproved'): continue
        require(cue.get('approvalState')=='approved' or not final,'STALE_CUE','Sonido sin aprobación vigente')
        a=assets[cue['audioRevision']]
        require(a['kind']=='pcm' and a.get('sampleRate')==RATE,'PCM','Usa la copia PCM canónica')
        if cue.get('eventId'):
            event=manifest['events'][cue['eventId']]
            shot=next(s for s in shots if s['id']==event['shotId'])
            sample=resolve_event(shot,event)['sample']
        elif cue.get('anchorShotId'):
            shot=next(s for s in shots if s['id']==cue['anchorShotId'])
            sample=(shot['startFrame']+cue.get('anchorFrameOffset',0))*2000
        else: sample=integer(cue['anchorSample'],'ancla')
        resolved.append(resolve_cue(cue,sample,a['samples']))
    for sub in manifest.get('subtitles',[]):
        require(0<=sub['startSample']<sub['endSample']<=SAMPLES,'SUBTITLE_TIME','Subtítulo fuera de programa')
        require(sub.get('audioRevision') in assets,'SUBTITLE_AUDIO','Subtítulo sin audio vinculado')
        require(not final or sub.get('approvalState')=='approved','SUBTITLE_REVIEW','Subtítulo pendiente')
    out={**copy.deepcopy(manifest),'cues':resolved,'compilerVersion':'2.2.0','samples':SAMPLES}
    canonical=copy.deepcopy(out)
    for asset in canonical['assets'].values():asset.pop('local',None)
    out['manifestHash']=digest(canonical)
    return out
