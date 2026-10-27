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
