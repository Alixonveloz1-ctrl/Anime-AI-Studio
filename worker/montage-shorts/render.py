"""Single compiler for previews/finals. Full-program audio is mixed before slicing."""
import json
import math
from pathlib import Path
import shutil
import subprocess
import wave
from shorts.core.contracts import compile_timeline, require, FPS, RATE, SAMPLES, TRACKS
from media import ff, probe, checksum

def local_asset(root, asset):
    candidate=root/asset['local'];path=candidate.resolve()
    require(not any(p.is_symlink() for p in (candidate,*candidate.parents)),'ASSET_PATH','Recurso con enlace simbólico')
    require(root.resolve() in path.parents and path.is_file(),'ASSET_PATH','Recurso fuera del directorio de ejecución')
    require(checksum(path)==asset['sha256'],'CHECKSUM','Checksum incorrecto')
    return path

def subtitle_files(plan, root):
    def clock(sample,ass=False):
        ms=round(sample*1000/RATE);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
        return f'{h}:{m:02}:{s:02}.{ms//10:02}' if ass else f'{h:02}:{m:02}:{s:02},{ms:03}'
    srt=[]; events=[]
    for i,c in enumerate(plan.get('subtitles',[]),1):
        text=c['text'].replace('\r','').replace('\x00','')
        srt.append(f"{i}\n{clock(c['startSample'])} --> {clock(c['endSample'])}\n{text}\n")
        escaped=text.replace('\\','／').replace('{','（').replace('}','）').replace('\n',r'\N')
        events.append(f"Dialogue: 0,{clock(c['startSample'],True)},{clock(c['endSample'],True)},Default,,0,0,0,,{escaped}")
    (root/'subtitles.srt').write_text('\n'.join(srt))
    w,h=(1920,1080) if plan.get('format','16:9')=='16:9' else (1080,1920)
    header=f'''[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H00101010,&H60000000,0,0,0,0,100,100,0,0,1,2,1,2,70,70,70,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
    (root/'subtitles.ass').write_text(header+'\n'.join(events)+'\n')

def mix(plan, root, files):
    """Track stems preserve absolute sample offsets, including tails across cuts."""
    stems={}
    for track in TRACKS:
        cues=[c for c in plan['cues'] if c['track']==track]
        dest=root/f'{track}.wav'; args=[]; filters=[]; labels=[]
        for i,c in enumerate(cues):
            args+=['-i',files[c['audioRevision']]]
            gain=c.get('gainDb',0); pan=c.get('pan',0)
            require(isinstance(gain,(int,float)) and -60<=gain<=12 and isinstance(pan,(int,float)) and -1<=pan<=1,'MIX','Mezcla fuera de rango')
            f=f'[{i}:a]atrim=start_sample={c["trimInSample"]}:end_sample={c["trimOutSample"]},asetpts=PTS-STARTPTS,volume={gain}dB'
            n=c['trimOutSample']-c['trimInSample']
            for key,t in [('fadeInSamples','in'),('fadeOutSamples','out')]:
                fade=c.get(key,0)
                require(type(fade)is int and 0<=fade<=n,'FADE','Fundido inválido')
                if fade: f+=f',afade=t={t}:ss={0 if t=="in" else n-fade}:ns={fade}'
            if pan: f+=f',pan=stereo|c0={min(1,1-pan)}*c0|c1={min(1,1+pan)}*c1'
            f+=f',adelay={c["resolvedStartSample"]}S:all=1[a{i}]';filters.append(f);labels.append(f'[a{i}]')
        if cues:
            filters.append(''.join(labels)+f'amix=inputs={len(labels)}:normalize=0,apad=whole_len={SAMPLES},atrim=end_sample={SAMPLES}[out]')
            ff([*args,'-filter_complex',';'.join(filters),'-map','[out]','-ar',RATE,'-ac',2,'-c:a','pcm_s24le',dest])
        else: ff(['-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-af',f'atrim=end_sample={SAMPLES}','-c:a','pcm_s24le',dest])
        stems[track]=dest
    args=[]
    for p in stems.values():args+=['-i',p]
    gain=plan.get('globalGainDb',0)
    require(isinstance(gain,(int,float)) and -60<=gain<=12,'GAIN','Ganancia global inválida')
    # Sidechain runs against full-program voices. It never restarts at a preview
    # boundary, and is only enabled by an approved editorial policy.
    policy=plan.get('mixPolicy',{});duck=policy.get('ducking',{})
    graph='';labels=''.join(f'[{i}:a]' for i in range(len(stems)))
    if duck.get('enabled'):
        require(duck.get('approved') is True,'DUCK_APPROVAL','Ducking pendiente de aprobar')
        threshold=duck.get('threshold',0.05);ratio=duck.get('ratio',4);release=duck.get('releaseMs',350)
        require(isinstance(threshold,(int,float)) and .001<=threshold<=1 and isinstance(ratio,(int,float)) and 1<=ratio<=20 and type(release)is int and 50<=release<=3000,'DUCK_POLICY','Ducking inválido')
        graph='[0:a][1:a][2:a][3:a]amix=inputs=4:normalize=0,asplit=2[voices][key];'
        graph+=f'[4:a][key]sidechaincompress=threshold={threshold}:ratio={ratio}:attack=20:release={release}:makeup=1[music];'
        labels='[voices][music][5:a][6:a]'
    count=4 if duck.get('enabled') else len(stems)
    graph+=labels+f'amix=inputs={count}:normalize=0,volume={gain}dB,alimiter=limit=0.8912509:level=0:latency=1,atrim=end_sample={SAMPLES}[m]'
    ff([*args,'-filter_complex',graph,'-map','[m]','-ar',RATE,'-ac',2,'-c:a','pcm_s24le',root/'premaster.wav'])
    normalization=policy.get('normalization',{})
    report={'scope':'full-program','normalization':'disabled','ducking':bool(duck.get('enabled'))}
    if normalization.get('enabled'):
        target=normalization.get('integratedLufs',-16);peak=normalization.get('truePeakDb',-1)
        require(normalization.get('approved') is True and target in (-16,-18,-20) and peak in (-1,-2),'LOUDNESS_POLICY','Política de sonoridad inválida/no aprobada')
        base=f'loudnorm=I={target}:TP={peak}:LRA=11'
        measured=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-i',str(root/'premaster.wav'),'-af',base+':print_format=json','-f','null','-'],capture_output=True,text=True,check=True,timeout=300).stderr
        stats=json.loads(measured[measured.rfind('{'):]);report.update(measurement=stats,normalization='full-program-two-pass')
        # Silence has no finite LUFS value and must stay silent.
        if all(math.isfinite(float(stats[k])) for k in ('input_i','input_tp','input_lra','input_thresh','target_offset')):
            filt=base+f':measured_I={stats["input_i"]}:measured_TP={stats["input_tp"]}:measured_LRA={stats["input_lra"]}:measured_thresh={stats["input_thresh"]}:offset={stats["target_offset"]}:linear=true'
            ff(['-i',root/'premaster.wav','-af',filt+f',aresample=48000,apad=whole_len={SAMPLES},atrim=end_sample={SAMPLES}','-ar',RATE,'-ac',2,'-c:a','pcm_s24le',root/'mix.wav'])
        else:
            shutil.copyfile(root/'premaster.wav',root/'mix.wav');report['normalization']='silence-preserved'
    else:shutil.copyfile(root/'premaster.wav',root/'mix.wav')
    (root/'mix-report.json').write_text(json.dumps(report,indent=2))
    with wave.open(str(root/'mix.wav'),'rb') as w:require(w.getnframes()==SAMPLES,'MIX_LENGTH','Longitud PCM incorrecta')
    return stems

def visual_clip(s, files, target, w, h, offset, length):
    typ=s['treatment']
    args=[]; vf=[]
    if typ=='black':args=['-f','lavfi','-i',f'color=black:s={w}x{h}:r=24'];vf=['null']
    elif typ in ('hold','camera2d','localized'):
        args=['-loop','1','-framerate',24,'-i',files[s['assetRevision']]]
        if typ=='camera2d':
            a,b=s.get('camera',{}).get('start',[1,0.5,0.5]),s.get('camera',{}).get('end',[1,0.5,0.5])
            require(len(a)==len(b)==3 and all(isinstance(x,(int,float)) and math.isfinite(x) for x in a+b),'CAMERA','Cámara inválida')
            require(1<=a[0]<=2 and 1<=b[0]<=2 and all(0<=v<=1 for v in a[1:]+b[1:]),'CAMERA','Cámara fuera de la imagen')
            t=f'(on+{offset})/{max(1,s["frames"]-1)}'; z=f'{a[0]}+({b[0]-a[0]})*{t}';x=f'{a[1]}+({b[1]-a[1]})*{t}';y=f'{a[2]}+({b[2]-a[2]})*{t}'
            vf=[f"scale={w*2}:{h*2}:force_original_aspect_ratio=increase,crop={w*2}:{h*2}",f"zoompan=z='{z}':x='(iw-iw/zoom)*({x})':y='(ih-ih/zoom)*({y})':d=1:s={w}x{h}:fps=24"]
        else:vf=[f'scale={w}:{h}:force_original_aspect_ratio=decrease',f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2']
    else:
        speed=s.get('speed',1); trim=s.get('trimSeconds',0)+offset/24*speed
        require(float(probe(files[s['assetRevision']])['format']['duration'])+1/24>=trim+length/24*speed,'VIDEO_COVERAGE','El video no cubre la toma')
        args=['-i',files[s['assetRevision']]]
        vf=[f'trim=start={trim}:duration={length/24*speed}',f'setpts=(PTS-STARTPTS)/{speed}','fps=24',f'scale={w}:{h}:force_original_aspect_ratio=decrease',f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2']
    if typ=='localized':
        layers=s.get('layers',[]); require(bool(layers),'LAYERS','Faltan variantes/capas aprobadas')
        graph=f'[0:v]{",".join(vf)}[base]';previous='base'
        for li,layer in enumerate(layers,1):
            require(layer['assetRevision'] in files,'LAYER_ASSET','Capa ausente')
            require(layer.get('approved') is True,'LAYER_APPROVAL','Máscara/capa sin aprobar')
            args+=['-loop','1','-i',files[layer['assetRevision']]]
            require(type(layer['startFrame'])is int and type(layer['endFrame'])is int and 0<=layer['startFrame']<layer['endFrame']<=s['frames'],'LAYER','Intervalo de capa inválido')
            mask=layer.get('mask')
            if mask:
                require(set(mask)=={'x','y','width','height'} and all(type(v) in (int,float) and math.isfinite(v) for v in mask.values()),'MASK','Máscara inválida')
                x,y,mw,mh=[mask[k] for k in ('x','y','width','height')]
                require(0<=x<1 and 0<=y<1 and 0<mw<=1-x and 0<mh<=1-y,'MASK','Máscara fuera del frame')
                lw,lh=max(2,round(w*mw/2)*2),max(2,round(h*mh/2)*2);lx,ly=round(w*x),round(h*y)
                crop=f'crop=iw*{mw}:ih*{mh}:iw*{x}:ih*{y},'
            else:
                for field in ('x','y','width','height'):require(type(layer[field])is int and 0<=layer[field]<=max(w,h),'LAYER','Capa inválida')
                lx,ly,lw,lh=[layer[k] for k in ('x','y','width','height')];crop=''
            intervals=layer.get('intervals',[[layer['startFrame'],layer['endFrame']]])
            require(isinstance(intervals,list) and len(intervals)<=500,'LAYER_INTERVALS','Intervalos inválidos')
            for first,last in intervals:require(type(first)is int and type(last)is int and 0<=first<last<=s['frames'],'LAYER_INTERVALS','Intervalo fuera de toma')
            enabled='+'.join(f'between(n\\,{first-offset}\\,{last-offset-1})' for first,last in intervals) or '0'
            graph+=f';[{li}:v]{crop}scale={lw}:{lh}[l{li}];[{previous}][l{li}]overlay={lx}:{ly}:enable={enabled}[b{li}]';previous=f'b{li}'

        opts=['-filter_complex_threads','1','-filter_complex',graph,'-map',f'[{previous}]']
    else:opts=['-vf',','.join(vf),'-map','0:v:0']
    ff([*args,*opts,'-an','-frames:v',length,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',target])

def render(manifest, root, start=0, end=7200, final=False, width=None):
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    plan=compile_timeline(manifest,final)
    require(type(start)is int and type(end)is int and 0<=start<end<=7200,'RANGE','Intervalo inválido')
    require(not final or (start,end)==(0,7200),'FINAL_RANGE','Final incompleto')
    files={k:local_asset(root,a) for k,a in plan['assets'].items()}
    # Metadata alone is not trusted for video/audio exclusion.
    for k,a in plan['assets'].items():
        if a['kind']=='veo_silent_validated':require(not any(s['codec_type']=='audio' for s in probe(files[k])['streams']),'VEO_AUDIO','Video contiene audio')
    subtitle_files(plan,root);mix(plan,root,files)
    vertical=plan.get('format')=='9:16'; w=width or (1080 if vertical else 1920) if final else width or (360 if vertical else 640)
    h=round(w*(16/9 if vertical else 9/16)/2)*2
    clips=[]
    for si,s in enumerate(plan['shots']):
        left=max(start,s['startFrame']); right=min(end,s['startFrame']+s['frames'])
        if left>=right:continue
        offset=left-s['startFrame']; length=right-left; target=root/f'shot-{si}.mp4'; typ=s['treatment']
        visual_clip(s,files,target,w,h,offset,length)
        clips.append(target)
    listing=root/'concat.txt';listing.write_text(''.join(f"file '{p.name}'\n" for p in clips))
    ff(['-f','concat','-safe','1','-i',listing,'-i',root/'mix.wav','-filter_complex',f'[1:a]atrim=start_sample={start*2000}:end_sample={end*2000},asetpts=PTS-STARTPTS[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',root/'clean.mp4'])
    output=root/'preview.mp4' if not final else root/'final_es.mp4'
    # Absolute subtitle times are preserved then restored to local PTS.
    ff(['-i',root/'clean.mp4','-vf',f"setpts=PTS+{start/24}/TB,ass='{root/'subtitles.ass'}',setpts=PTS-STARTPTS",'-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output])
    info=probe(output);v=next(s for s in info['streams'] if s['codec_type']=='video')
    require(int(v['nb_frames'])==end-start,'OUTPUT_FRAMES','Salida perdió fotogramas')
    audio=[s for s in info['streams'] if s['codec_type']=='audio']
    require(len(audio)==1 and int(audio[0]['sample_rate'])==RATE,'OUTPUT_AUDIO','Salida debe tener una mezcla a 48 kHz')
    expected_samples=(end-start)*2000
    raw=ff(['-i',output,'-map','0:a:0','-ac',1,'-ar',RATE,'-f','s16le','pipe:1'])
    decoded_samples=len(raw)//2;padding=decoded_samples-expected_samples
    require(0<=padding<=1024,'OUTPUT_PADDING','Longitud AAC decodificada incompatible con el programa')
    from fractions import Fraction
    duration=Fraction(str(audio[0]['duration_ts']))*Fraction(audio[0]['time_base'])*RATE
    require(abs(duration-expected_samples)<=1,'OUTPUT_AUDIO_DURATION','Duración audible distinta del programa')
    require(abs(float(audio[0].get('start_time',0)))<=1/RATE,'OUTPUT_AUDIO_START','Desplazamiento inicial inesperado en la mezcla')
    result={'manifestHash':plan['manifestHash'],'startFrame':start,'endFrame':end,'frames':end-start,'programSamples':expected_samples,'decodedAudioSamples':decoded_samples,'codecPaddingSamples':padding,'sha256':checksum(output),'file':output.name,'compilerVersion':plan['compilerVersion']}
    (root/'result.json').write_text(json.dumps(result,indent=2));(root/'compiled.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
    return result
