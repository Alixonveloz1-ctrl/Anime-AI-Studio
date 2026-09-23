import array
import copy
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'worker/montage-shorts'))
from media import ff, pcm, waveform, silent_video, probe, checksum, extract_frames, inspect
from render import render, local_asset, mix, visual_clip
from shorts.core.contracts import ContractError,compile_timeline

@unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg required')
class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='shorts-test-');cls.root=Path(cls.temp.name)
        cls.image=cls.root/'still.png'
        ff(['-f','lavfi','-i','color=black:s=160x90','-frames:v','1','-threads','1',cls.image])
        cls.raw=cls.root/'raw.mp4'
        ff(['-f','lavfi','-i','color=black:s=160x90:r=24:d=4','-f','lavfi','-i','sine=frequency=800:duration=4','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable=eq(n\\,60)",'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',cls.raw])
        cls.silent=cls.root/'silent.mp4';silent_video(cls.raw,cls.silent)
        cls.mp3=cls.root/'sound.mp3'
        ff(['-f','lavfi','-i',"aevalsrc=if(between(t\\,0.2\\,0.22)\\,0.5*sin(2*PI*1000*t)\\,0):s=48000:d=1",'-c:a','libmp3lame','-b:a','192k',cls.mp3])
        cls.audio=cls.root/'audio.wav';meta=pcm(cls.mp3,cls.audio)
        cls.manifest={'schemaVersion':2,'projectId':'p','format':'16:9','fps':24,'sampleRate':48000,'frames':7200,'assets':{
            'i':{'projectId':'p','kind':'image','approvalState':'approved','sha256':checksum(cls.image),'local':'still.png'},
            'v':{'projectId':'p','kind':'veo_silent_validated','approvalState':'approved','audioStreams':0,'sha256':checksum(cls.silent),'local':'silent.mp4'},
            'a':{'projectId':'p','approvalState':'approved','local':'audio.wav',**meta}},
            'shots':[{'id':'one','startFrame':0,'frames':2400,'assetRevision':'i','treatment':'hold'}, {'id':'two','startFrame':2400,'frames':96,'assetRevision':'v','treatment':'veo'}, {'id':'three','startFrame':2496,'frames':4704,'assetRevision':'i','treatment':'hold'}],
            'events':{'event':{'shotId':'two','pts':60,'timebase':24,'videoRevision':'v','visible':True}},
            'cues':[{'id':'sfx','track':'sfx','audioRevision':'a','eventId':'event','sourceSyncSample':9600,'approvalState':'approved'}], 'subtitles':[]}
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def test_A066_cache_hash_independent_of_worker_staging_path(self):
        manifest=copy.deepcopy(self.manifest)
        original=compile_timeline(manifest)['manifestHash']
        for asset in manifest['assets'].values():asset.pop('local',None)
        self.assertEqual(original,compile_timeline(manifest)['manifestHash'])
        manifest['cues'][0]['gainDb']=-9
        self.assertNotEqual(original,compile_timeline(manifest)['manifestHash'])
    def test_A027_localized_region_and_interval(self):
        variant=self.root/'variant.png';clip=self.root/'localized.mp4'
        ff(['-f','lavfi','-i','color=white:s=160x90','-frames:v',1,'-threads',1,variant])
        shot={'id':'s','frames':48,'assetRevision':'base','treatment':'localized','layers':[{'assetRevision':'variant','approved':True,'mask':{'x':.25,'y':.25,'width':.5,'height':.5},'startFrame':12,'endFrame':24}]}
        visual_clip(shot,{'base':self.image,'variant':variant},clip,160,90,0,48)
        raw=ff(['-i',clip,'-vf','select=eq(n\\,18)','-frames:v',1,'-f','rawvideo','-pix_fmt','gray','pipe:1'])
        self.assertGreater(raw[45*160+80],240);self.assertLess(raw[5*160+5],10)
        raw=ff(['-i',clip,'-vf','select=eq(n\\,30)','-frames:v',1,'-f','rawvideo','-pix_fmt','gray','pipe:1'])
        self.assertLess(raw[45*160+80],10)
        shot['layers'][0]['intervals']=[[12,16],[20,24]]
        visual_clip(shot,{'base':self.image,'variant':variant},clip,160,90,0,48)
        raw=ff(['-i',clip,'-vf','select=eq(n\\,18)','-frames:v',1,'-f','rawvideo','-pix_fmt','gray','pipe:1'])
        self.assertLess(raw[45*160+80],10)
    def test_A033_strip_and_inspect(self):
        self.assertTrue(any(s['codec_type']=='audio' for s in probe(self.raw)['streams']))
        self.assertFalse(any(s['codec_type']=='audio' for s in probe(self.silent)['streams']))
    def test_A044_A047_mp3_same_pcm_attack(self):
        w=waveform(self.audio);self.assertEqual(w['samples'],48000);self.assertTrue(any(abs(s-9600)<=480 for s in w['attackCandidates']))
    def test_A056_indexed_contact(self):
        out=self.root/'frames';frames=extract_frames(self.silent,out,59,3)
        self.assertEqual([f['index'] for f in frames],[59,60,61]);self.assertEqual(float(frames[1]['seconds']),2.5)
        raw=ff(['-i',out/'frame-000060.jpg','-f','rawvideo','-pix_fmt','gray','pipe:1']);self.assertGreater(sum(raw)/len(raw),240)
    def test_A079_path_and_checksum(self):
        with self.assertRaises(ContractError):local_asset(self.root,{'local':'../escape','sha256':'0'*64})
        with self.assertRaises(ContractError):local_asset(self.root,{'local':'still.png','sha256':'0'*64})
        link=self.root/'symlink.png';link.symlink_to(self.image)
        with self.assertRaises(ContractError):local_asset(self.root,{'local':link.name,'sha256':checksum(self.image)})
    def test_A079_playlist_disguised_as_audio(self):
        import subprocess
        path=self.root/'evil.mp3';path.write_text("ffconcat version 1.0\nfile 'audio.wav'\n")
        with self.assertRaises(subprocess.CalledProcessError):inspect(path,'audio')
    def test_A079_shell_manifest_rejected(self):
        m=copy.deepcopy(self.manifest);m['command']='touch /tmp/untrusted'
        with self.assertRaises(ContractError):compile_timeline(m)
    def test_A080_block_stale_and_raw(self):
        m=copy.deepcopy(self.manifest);m['assets']['v']['kind']='veo_raw'
        with self.assertRaises(ContractError):compile_timeline(m,True)
    def test_A065_full_program_ducking_and_silence(self):
        bed=self.root/'bed.wav'
        ff(['-f','lavfi','-i','sine=frequency=240:sample_rate=48000:duration=8','-ac',2,'-c:a','pcm_s24le',bed])
        m=copy.deepcopy(self.manifest);m['assets']['bed']={'id':'bed','projectId':'p','kind':'pcm','samples':384000,'sampleRate':48000,'sha256':checksum(bed),'local':bed.name,'approvalState':'approved'}
        m['cues']=[{'id':'bed','track':'music','audioRevision':'bed','anchorSample':4800000,'sourceSyncSample':0,'approvalState':'approved'}, {'id':'voice','track':'dialogue','audioRevision':'bed','anchorSample':4896000,'sourceSyncSample':0,'trimOutSample':48000,'approvalState':'approved'}]
        plan=compile_timeline(m);files={k:local_asset(self.root,a) for k,a in plan['assets'].items()}
        mix(plan,self.root,files);plain=checksum(self.root/'mix.wav')
        plan['mixPolicy']={'ducking':{'enabled':True,'approved':True,'threshold':.005},'normalization':{'enabled':True,'approved':True,'integratedLufs':-16,'truePeakDb':-1}}
        mix(plan,self.root,files);first=checksum(self.root/'mix.wav');self.assertNotEqual(first,plain)
        mix(plan,self.root,files);self.assertEqual(first,checksum(self.root/'mix.wav'))
        report=json.loads((self.root/'mix-report.json').read_text());self.assertTrue(report['ducking']);self.assertEqual(report['scope'],'full-program')
        with wave.open(str(self.root/'mix.wav'),'rb') as w:self.assertEqual(w.getnframes(),14400000)
        m=copy.deepcopy(self.manifest);m['cues'][0]['approvalState']='stale'
        with self.assertRaises(ContractError):compile_timeline(m,True)
    def test_A048_A049_one_file_continues_across_cuts_and_keeps_tail(self):
        continuous=self.root/'continuous.wav'
        ff(['-f','lavfi','-i','sine=frequency=311:sample_rate=48000:duration=12','-af','volume=0.4','-ac',2,'-c:a','pcm_s24le',continuous])
        m=copy.deepcopy(self.manifest);m['assets']['continuous']={'id':'continuous','projectId':'p','kind':'pcm','samples':576000,'sampleRate':48000,'sha256':checksum(continuous),'local':continuous.name,'approvalState':'approved'}
        m['shots']=[{'id':'cut'+str(i),'startFrame':i*72,'frames':72,'assetRevision':'i','treatment':'hold'} for i in range(4)]+[{'id':'remaining','startFrame':288,'frames':6912,'assetRevision':'i','treatment':'hold'}]
        m['cues']=[{'id':'ambience','track':'ambience','audioRevision':'continuous','anchorSample':0,'sourceSyncSample':0,'approvalState':'approved'},{'id':'tail','track':'sfx','audioRevision':'continuous','anchorSample':138000,'sourceSyncSample':9600,'trimOutSample':96000,'approvalState':'approved'}]
        plan=compile_timeline(m);files={k:local_asset(self.root,a) for k,a in plan['assets'].items()};mix(plan,self.root,files)
        with wave.open(str(continuous),'rb') as w:source=w.readframes(w.getnframes())
        with wave.open(str(self.root/'ambience.wav'),'rb') as w:self.assertEqual(w.readframes(576000),source)
        with wave.open(str(self.root/'sfx.wav'),'rb') as w:
            w.setpos(128400);actual=w.readframes(96000)
        with wave.open(str(continuous),'rb') as w:self.assertEqual(actual,w.readframes(96000))
        self.assertEqual(plan['cues'][1]['resolvedStartSample'],128400)
        self.assertGreater(128400+96000,144000) # tail crosses the first visual cut

    def test_A061_A063_A064_A069_render_and_decode(self):
        r=render(self.manifest,self.root,2400,2520,False,width=160)
        self.assertEqual(r['frames'],120)
        preview=self.root/'saved-preview.mp4';shutil.copyfile(self.root/'preview.mp4',preview)
        r=render(self.manifest,self.root,0,7200,True,width=160)
        self.assertEqual(r['frames'],7200)
        self.assertEqual(r['decodedAudioSamples']-r['codecPaddingSamples'],14400000)
        self.assertLessEqual(r['codecPaddingSamples'],1024)
        with wave.open(str(self.root/'mix.wav'),'rb') as w:self.assertEqual(w.getnframes(),14400000)
        def decode(path,start=0,duration=5):
            raw=ff(['-i',path,'-ss',start,'-t',duration,'-map','0:a:0','-ac',1,'-ar',48000,'-f','f32le','pipe:1']);a=array.array('f');a.frombytes(raw);return a
        p=decode(preview);f=decode(self.root/'final_es.mp4',100)
        onset=lambda a:next(i for i,v in enumerate(a) if abs(v)>.08)
        self.assertLessEqual(abs(onset(p)-120000),2000)
        self.assertLessEqual(abs(onset(p)-onset(f)),100)
        self.assertTrue((self.root/'subtitles.ass').exists())
if __name__=='__main__':unittest.main()
