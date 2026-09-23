"""Bounded media operations. Paths are staged locally by trusted runner, never URLs."""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import wave
from shorts.core.contracts import require, RATE

# A playlist/concat pseudo-container can open other local files. Never accept one
# as an uploaded sound, image or model output, even with a plausible extension.
INPUT_FORMATS='aac,aiff,avi,flac,gif,image2,jpeg_pipe,matroska,webm,mov,mp3,ogg,png_pipe,wav,webp_pipe'

def run(args, timeout=900):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout).stdout

def ff(args, timeout=900):
    return run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-threads','2',*map(str,args)],timeout)

def probe(path, frames=False):
    args=['ffprobe','-v','error','-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-show_streams','-show_format']
    if frames: args+=['-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp,pkt_duration_time,best_effort_timestamp_time']
    return json.loads(run([*args,'-of','json',str(path)],60))

def checksum(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def inspect(path, expected):
    p=Path(path)
    require(p.is_file() and not p.is_symlink() and p.stat().st_size<=250*1024*1024,'MEDIA_SIZE','Archivo ausente o demasiado grande')
    info=probe(p)
    types={s['codec_type'] for s in info['streams']}
    require(expected in types,'MEDIA_TYPE','El contenido no corresponde al tipo solicitado')
    require(float(info['format'].get('duration',0))<=600,'MEDIA_DURATION','Medio demasiado largo')
    require(len(info['streams'])<=8,'MEDIA_STREAMS','Demasiadas pistas')
    for s in info['streams']:
        if s['codec_type']=='video':require(0<int(s.get('width',0))*int(s.get('height',0))<=40000000,'MEDIA_DIMENSIONS','Imagen demasiado grande')
    return info

def silent_video(source, dest):
    original=inspect(source,'video')
    ff(['-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',source,'-map','0:v:0','-an','-sn','-dn','-vf','fps=24,setpts=PTS-STARTPTS','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',dest])
    info=probe(dest)
    require(not any(s['codec_type']=='audio' for s in info['streams']),'VEO_AUDIO','Derivado contiene audio')
    return {'sha256':checksum(dest),'audioStreams':0,'kind':'veo_silent_validated','originalAudioStreams':sum(s['codec_type']=='audio' for s in original['streams']),'probe':info}

def pcm(source, dest):
    inspect(source,'audio')
    ff(['-protocol_whitelist','file,pipe','-format_whitelist',INPUT_FORMATS,'-i',source,'-map','0:a:0','-vn','-ar',RATE,'-ac',2,'-c:a','pcm_s24le',dest])
    with wave.open(str(dest),'rb') as w:
        return {'kind':'pcm','samples':w.getnframes(),'sampleRate':w.getframerate(),'channels':w.getnchannels(),'sha256':checksum(dest)}

def waveform(path, bins=1600):
    raw=ff(['-i',path,'-map','0:a:0','-ac',1,'-ar',RATE,'-f','f32le','pipe:1'])
    samples=array.array('f'); samples.frombytes(raw)
    require(len(samples)>0,'EMPTY_AUDIO','Audio vacío')
    hop=240
    energies=[math.sqrt(sum(x*x for x in samples[i:i+hop])/len(samples[i:i+hop])) for i in range(0,len(samples),hop)]
    attacks=[]
    for i in range(1,len(energies)):
        baseline=sum(energies[max(0,i-8):i])/min(i,8)
        if energies[i]>max(.015,baseline*3) and (not attacks or i*hop-attacks[-1]>RATE//10): attacks.append(i*hop)
    width=max(1,math.ceil(len(samples)/bins))
    peaks=[max(abs(x) for x in samples[i:i+width]) for i in range(0,len(samples),width)]
    return {'sampleRate':RATE,'samples':len(samples),'binSamples':width,'peaks':peaks,'attackCandidates':attacks[:100],'clipping':max(peaks)>=.999,'status':'needs_review'}

def extract_frames(source, out, start=0, count=48):
    require(type(start)is int and type(count)is int and 0<=start<14400 and 1<=count<=120,'FRAME_RANGE','Intervalo de frames inválido')
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    info=probe(source,True); frames=info.get('frames',[])
    require(start<len(frames),'FRAME_RANGE','Fotograma inexistente')
    ff(['-i',source,'-vf',f'select=between(n\\,{start}\\,{start+count-1}),scale=480:-2','-fps_mode','passthrough','-start_number',start,str(out/'frame-%06d.jpg')])
    return [{'index':i,'pts':f.get('best_effort_timestamp'),'seconds':f.get('best_effort_timestamp_time'),'file':f'frame-{i:06d}.jpg'} for i,f in enumerate(frames) if start<=i<start+count]
