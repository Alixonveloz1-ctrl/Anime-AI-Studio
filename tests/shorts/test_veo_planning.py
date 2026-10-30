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


class ManualVideoOnAnyShotTests(unittest.TestCase):
    """«Si la toma pasa de 8 segundos, que se genere un clip de 8 y se
    ralentice hasta cubrirla.» Un guardia bloqueaba justo eso (U032)."""

    def setUp(self):
        from shorts.core.generation import generation_inputs
        self.generation_inputs=generation_inputs
        self.d=complete();self.shot=self.d['shots'][0]
        self.image={'id':'i1','entityId':self.shot['id'],'kind':'image','approvalState':'approved',
                    'developmentId':'dev','created':1}

    def pedir(self,seconds,treatment):
        self.shot.update(frames=seconds*24,minFrames=seconds*24,maxFrames=seconds*24,treatment=treatment)
        return self.generation_inputs(self.d,'dev',[self.image],{},'veo',self.shot['id'])

    def test_a_long_image_shot_can_be_asked_for_video_and_gets_the_longest_clip(self):
        from shorts.core.timing import veo_seconds_for_manual_video
        for seconds in (10,20,150):
            with self.subTest(seconds=seconds):
                self.pedir(seconds,'hold')  # no levanta
                self.shot.update(frames=seconds*24)
                self.assertEqual(veo_seconds_for_manual_video(self.shot),8)

    def test_a_short_image_shot_gets_the_nearest_clip_instead_of_being_refused(self):
        from shorts.core.timing import veo_seconds_for_manual_video
        for seconds,clip in ((2,4),(5,6),(7,8)):
            with self.subTest(seconds=seconds):
                self.pedir(seconds,'hold')
                self.shot.update(frames=seconds*24)
                self.assertEqual(veo_seconds_for_manual_video(self.shot),clip)

    def test_the_script_still_cannot_plan_a_video_shot_longer_than_one_clip(self):
        # Ese tope sigue siendo del guion: no es lo mismo que pedir video a
        # mano en una toma de imagen.
        with self.assertRaises(ContractError) as error:self.pedir(20,'veo')
        self.assertEqual(error.exception.code,'VEO_COVERAGE')
        self.pedir(8,'veo')  # dentro del clip, no levanta

    def test_an_unapproved_image_still_blocks_before_spending_a_generation(self):
        self.shot.update(frames=20*24,minFrames=20*24,maxFrames=20*24,treatment='hold')
        with self.assertRaises(ContractError) as error:
            self.generation_inputs(self.d,'dev',[],{},'veo',self.shot['id'])
        self.assertEqual(error.exception.code,'IMAGE_APPROVAL')
