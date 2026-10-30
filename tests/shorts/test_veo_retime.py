import unittest
from shorts.service.timeline import veo_retime

class VeoRetimeTests(unittest.TestCase):
    def test_six_second_clip_for_five_second_shot_speeds_up_without_cutting(self):
        # 6 s de clip / 5 s de toma = velocidad 1.2, todo el clip, sin recorte.
        self.assertAlmostEqual(veo_retime({'clipSeconds':6},120),1.2)
    def test_four_second_clip_for_five_second_shot_slows_down_without_cutting(self):
        self.assertAlmostEqual(veo_retime({'clipSeconds':4},120),0.8)
    def test_clip_duration_from_probe_when_clip_seconds_missing(self):
        self.assertAlmostEqual(veo_retime({'probe':{'format':{'duration':'8'}}},192),1.0)
    def test_unknown_clip_duration_keeps_existing_speed(self):
        self.assertIsNone(veo_retime({},120))
        self.assertIsNone(veo_retime({'clipSeconds':0},120))
    def test_retimed_speeds_are_outside_the_usual_range_by_design(self):
        # Un clip de 6 s acelerado a 5 s (1.2) y uno de 4 s ralentizado a
        # 5 s (0.8) están fuera del rango 0.9-1.1 que el contrato permite
        # sin aprobación; por eso el montaje marca estas tomas con
        # retimeApproved cuando aplica esta regla del usuario.
        self.assertTrue(veo_retime({'clipSeconds':6},120)>1.1)
        self.assertTrue(veo_retime({'clipSeconds':4},120)<0.9)

if __name__=='__main__':unittest.main()


class RetimeWarningTests(unittest.TestCase):
    """Cubrir la toma con un solo clip la ralentiza, y eso hay que decirlo."""

    def test_a_shot_longer_than_the_longest_clip_says_how_slow_it_will_run(self):
        # El clip más largo dura 8 s. Una toma de 20 s lo estira a 0,4x. No es
        # un error: es la regla de cubrir la toma sin cortar el clip, así que
        # el aviso dice el factor y no manda hacer otra cosa.
        from shorts.service.timeline import retime_warning
        aviso=retime_warning(veo_retime({'clipSeconds':8},20*24),'t5')
        self.assertIn('ralentizado',aviso)
        self.assertIn('sin cortarlo',aviso)
        self.assertIn('2.5x',aviso)
        self.assertIn('t5',aviso)

    def test_a_shot_shorter_than_the_shortest_clip_is_reported_as_sped_up(self):
        from shorts.service.timeline import retime_warning
        aviso=retime_warning(veo_retime({'clipSeconds':4},2*24),'t1')
        self.assertIn('acelerado',aviso)
        self.assertIn('2.0x',aviso)

    def test_the_speeds_the_no_cutting_rule_aims_for_are_not_reported(self):
        # Estos son los casos que la regla busca a propósito: no son avisos.
        from shorts.service.timeline import retime_warning
        for clip,frames in ((6,120),(4,96),(8,192),(8,10*24),(8,7*24),(4,3*24)):
            with self.subTest(clip=clip,frames=frames):
                self.assertIsNone(retime_warning(veo_retime({'clipSeconds':clip},frames),'t'))

    def test_an_unknown_clip_duration_is_not_a_warning(self):
        from shorts.service.timeline import retime_warning
        self.assertIsNone(retime_warning(None,'t'))

    def test_the_whole_plan_carries_the_warning_so_it_shows_before_exporting(self):
        # El aviso tiene que llegar a los pendientes del borrador, que es donde
        # el dueño lo ve antes de exportar: no basta con que la función exista.
        from unittest.mock import Mock
        from shorts.service.timeline import assemble_plan
        from test_manual_development import complete
        d=complete();d['utterances']=[];d['subtitles']=[];d['musicRequests']=[];d['soundRequests']=[]
        # El caso real: el guion NO puede marcar una toma veo de más de 8 s
        # (shot_bounds la rechaza con VEO_COVERAGE). La cámara lenta aparece
        # cuando el usuario pide video a mano en una toma de imagen larga,
        # que es justo lo que el botón «Generar video» permite desde que está
        # en todas las tomas con imagen aprobada.
        # El corto completo tiene que cubrir 285 s, así que la toma larga va
        # acompañada del resto del metraje en otra toma de imagen.
        beat=d['beats'][0]['id']
        d['shots']=[dict(d['shots'][0],id='t1',beatId=beat,frames=20*24,minFrames=20*24,maxFrames=20*24,treatment='hold'),
                    dict(d['shots'][0],id='t2',beatId=beat,frames=265*24,minFrames=265*24,maxFrames=265*24,treatment='hold')]
        d['beats']=[dict(d['beats'][0],minFrames=285*24,preferredFrames=285*24,maxFrames=285*24)]
        filas=[{'id':'v1','entityId':'t1','kind':'veo_silent_validated','approvalState':'approved',
                'developmentId':'dev','created':1,'clipSeconds':8.0},
               {'id':'i1','entityId':'t1','kind':'image','approvalState':'approved','developmentId':'dev','created':1},
               {'id':'i2','entityId':'t2','kind':'image','approvalState':'approved','developmentId':'dev','created':1}]
        cloud=Mock()
        cloud.entity.return_value={'id':'dev','approvalState':'approved','data':d}
        cloud.project_ref.return_value.collection.return_value.stream.return_value=[
            Mock(to_dict=lambda fila=fila:fila) for fila in filas]
        plan=assemble_plan(cloud,{'id':'p','activeDevelopment':'dev','format':'16:9'})
        lentas=[i for i in plan['draftIssues'] if i.startswith('Video ralentizado:')]
        self.assertEqual(len(lentas),1,plan['draftIssues'])
        self.assertIn('2.5x',lentas[0])
        # Y el montaje sigue recibiendo la velocidad: no se recorta nada.
        self.assertAlmostEqual(plan['shots'][0]['speed'],0.4)
        self.assertEqual(plan['shots'][0]['trimSeconds'],0)

    def test_the_page_and_the_service_use_the_same_limits(self):
        # Dos sitios con el mismo número: si uno se edita solo, la web avisa de
        # algo que el montaje no avisa, o al revés.
        import re
        from pathlib import Path
        from shorts.service.timeline import RETIME_NATURAL
        page=Path(__file__).resolve().parents[2]/'cortos'/'studio.mjs'
        if not page.exists():self.skipTest('La web no viaja en la imagen de Cloud Run')
        found=re.search(r'const RETIME_NATURAL=\[([\d.]+),([\d.]+)\]',page.read_text(encoding='utf-8'))
        self.assertTrue(found,'La web declara sus límites de velocidad')
        self.assertEqual((float(found.group(1)),float(found.group(2))),RETIME_NATURAL)
