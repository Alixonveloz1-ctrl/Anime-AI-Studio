import copy,unittest
from shorts.core.contracts import ContractError
from shorts.core.timing import veo_seconds
from shorts.service.development import stage_schema,validate_shape,plan_shots
from test_manual_development import complete

class VeoPlanningTests(unittest.TestCase):
    def test_generated_schema_restricts_video_but_not_images(self):
        schema=stage_schema(2);variants=schema['properties']['shots']['items']['anyOf']
        self.assertEqual(variants[1]['properties']['frames']['maximum'],192)
        for treatment,frames,allowed in [('veo',48,True),('veo',192,True),('veo',193,False),('camera2d',288,True),('hold',720,True)]:
            with self.subTest(treatment=treatment,frames=frames):
                d=complete();d['shots'][0].update(treatment=treatment,frames=frames,minFrames=1,maxFrames=frames,leadFrames=0,tailFrames=0)
                part={k:d[k] for k in ('bible','shots','utterances')}
                if allowed:validate_shape(part,schema)
                else:
                    with self.assertRaises(ContractError):validate_shape(part,schema)
    def test_oversized_elastic_max_does_not_reject_valid_eight_second_action(self):
        d=complete();v=copy.deepcopy(d['shots'][0]);v.update(id='v',treatment='veo',frames=192,minFrames=96,maxFrames=240,leadFrames=0,tailFrames=0)
        d['shots'][0].update(frames=7008,minFrames=6840,maxFrames=7200);d['shots'].append(v)
        result=plan_shots(d)
        self.assertEqual(result['shots'][1]['frames'],192);self.assertEqual(result['shots'][1]['maxFrames'],192)
        self.assertEqual(d['shots'][1]['maxFrames'],240)
    def test_real_oversize_never_silently_trims_or_changes_treatment(self):
        d=complete();d['shots'][0].update(treatment='veo',frames=240,minFrames=192,maxFrames=288)
        with self.assertRaises(ContractError) as e:plan_shots(d)
        self.assertEqual(e.exception.code,'VEO_COVERAGE');self.assertIn('10.0 segundos',str(e.exception))
    def test_clip_duration_covers_interval_without_always_requesting_eight(self):
        for maximum,seconds in [(48,4),(96,4),(97,6),(144,6),(145,8),(192,8)]:
            self.assertEqual(veo_seconds({'treatment':'veo','frames':48,'maxFrames':maximum}),seconds)
        with self.assertRaises(ContractError):veo_seconds({'treatment':'veo','frames':193,'maxFrames':193})
        with self.assertRaises(ContractError):veo_seconds({'treatment':'hold','frames':48})
