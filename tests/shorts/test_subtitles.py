import unittest
from shorts.core.subtitles import validate_segments,subtitle_segments
from shorts.core.contracts import ContractError,resolve_event,visual_fingerprint

class SubtitleTests(unittest.TestCase):
    def test_A039_gaps_and_meaning_units_kept(self):
        rows=[{'text':'Te esperaba.','startSample':0,'endSample':96000},{'text':'¿Por qué volviste?','startSample':144000,'endSample':288000}]
        self.assertEqual(validate_segments(rows,300000),[])
        self.assertEqual(rows[1]['startSample']-rows[0]['endSample'],48000)
    def test_A039_readability_requires_explicit_exception(self):
        row={'text':'x'*100,'startSample':0,'endSample':48000}
        warnings=validate_segments([row],48000)
        self.assertFalse(warnings[0]['exceptionApproved']);row['exceptionReason']='Texto de sistema revisado'
        self.assertTrue(validate_segments([row],48000)[0]['exceptionApproved'])
    def test_A040_changed_voice_preserves_manual_edit_but_flags_review(self):
        saved={'u':{'audioRevision':'old','audioHash':'a','segments':[{'text':'Guardado','startSample':0,'endSample':100}]}}
        result,stale=subtitle_segments({'id':'u'},{'id':'new','sha256':'b','samples':48000},'Nuevo',saved)
        self.assertTrue(stale);self.assertEqual(saved['u']['segments'][0]['text'],'Guardado')
        self.assertEqual(result[0]['endSample'],48000)
    def test_A039_outside_audio_or_overlap_rejected(self):
        for rows in [[{'text':'x','startSample':0,'endSample':50000}],[{'text':'x','startSample':0,'endSample':30000},{'text':'y','startSample':20000,'endSample':48000}]]:
            with self.assertRaises(ContractError):validate_segments(rows,48000)

class CompositeFrameTests(unittest.TestCase):
    def test_A055_manual_camera_frame_uses_compositor_time(self):
        shot={'id':'s','startFrame':2400,'frames':96,'assetRevision':'image','treatment':'camera2d','camera':{'start':[1,.5,.5],'end':[1.2,.5,.5]}}
        event={'videoRevision':'image','visible':True,'pts':60,'timebase':24,'coordinateSpace':'shot_output','visualFingerprint':visual_fingerprint(shot)}
        self.assertEqual(resolve_event(shot,event)['sample'],4920000)
        shot['startFrame']+=48;self.assertEqual(resolve_event(shot,event)['sample'],5016000)
        shot['camera']['end'][0]=1.4
        with self.assertRaises(ContractError):resolve_event(shot,event)
