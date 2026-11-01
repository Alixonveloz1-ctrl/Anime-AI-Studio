"""«Vista previa · Pendiente de comprobar — No se confirmó el resultado del envío.»

Una vista previa no llama a Google y aun así quedaba como un envío dudoso. Dos
causas: el montaje trataba como foto fija el video que el dueño pidió a mano en
una toma de imagen (ffmpeg: «Option loop not found»), y cualquier fallo del
montaje se guardaba como «envío sin confirmar»."""
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ/'worker/montage-shorts'))
from shorts.core.contracts import ContractError
from shorts.core.jobs import close_uncertain
from shorts.service.timeline import assemble_plan
from test_manual_development import complete

# 11 s de imagen con video a mano, 5 s pensados como video que aún sólo tienen
# imagen, 3,6 s de cámara 2D con video a mano y el resto del corto en imagen.
TOMAS = [('t1', 264, 'hold'), ('t2', 120, 'veo'), ('t3', 86, 'camera2d'), ('t4', 6840-470, 'hold')]


def filas(sha=lambda nombre: '0'*64):
    comun = {'projectId': 'p', 'approvalState': 'approved', 'developmentId': 'dev', 'created': 1}
    out = [{**comun, 'id': 'v1', 'entityId': 't1', 'kind': 'veo_silent_validated', 'audioStreams': 0, 'clipSeconds': 8.0, 'sha256': sha('v1')},
           {**comun, 'id': 'v3', 'entityId': 't3', 'kind': 'veo_silent_validated', 'audioStreams': 0, 'clipSeconds': 4.0, 'sha256': sha('v3')}]
    for toma, *_ in TOMAS:
        out.append({**comun, 'id': 'i'+toma[1:], 'entityId': toma, 'kind': 'image', 'sha256': sha('i'+toma[1:])})
    return out


def plan_de_prueba(sha=lambda nombre: '0'*64):
    d = complete();d['utterances'] = [];d['subtitles'] = [];d['musicRequests'] = [];d['soundRequests'] = []
    beat = d['beats'][0]['id']
    d['shots'] = [dict(d['shots'][0], id=i, beatId=beat, frames=f, minFrames=f, maxFrames=f, treatment=t) for i, f, t in TOMAS]
    d['beats'] = [dict(d['beats'][0], minFrames=6840, preferredFrames=6840, maxFrames=6840)]
    cloud = Mock()
    cloud.entity.return_value = {'id': 'dev', 'approvalState': 'approved', 'data': d}
    cloud.project_ref.return_value.collection.return_value.stream.return_value = [Mock(to_dict=lambda fila=fila: fila) for fila in filas(sha)]
    return assemble_plan(cloud, {'id': 'p', 'activeDevelopment': 'dev', 'format': '16:9'})


class ElArchivoMandaSobreElGuionTests(unittest.TestCase):
    def test_a_shot_with_a_video_is_assembled_as_video_whatever_the_script_said(self):
        tomas = {s['id']: s for s in plan_de_prueba()['shots']}
        self.assertEqual(tomas['t1']['treatment'], 'veo')
        self.assertEqual(tomas['t1']['assetRevision'], 'v1')
        self.assertEqual(tomas['t3']['treatment'], 'veo')
        self.assertNotIn('layers', tomas['t3'])

    def test_a_video_shot_that_only_has_its_image_shows_the_image(self):
        # Antes el montaje entero se negaba: «Solo se admite Veo validado sin audio».
        tomas = {s['id']: s for s in plan_de_prueba()['shots']}
        self.assertEqual(tomas['t2']['treatment'], 'hold')
        self.assertEqual(tomas['t2']['assetRevision'], 'i2')

    def test_the_plan_compiles(self):
        from shorts.core.contracts import compile_timeline
        compile_timeline(plan_de_prueba(lambda nombre: hashlib.sha256(nombre.encode()).hexdigest()), False)


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class VistaPreviaRealTests(unittest.TestCase):
    """Con archivos de verdad, guardados como los guarda el servicio («.media»)."""

    @classmethod
    def setUpClass(cls):
        from media import ff, silent_video, checksum
        cls.temp = tempfile.TemporaryDirectory(prefix='shorts-preview-');cls.root = Path(cls.temp.name)
        fuentes = cls.root/'fuentes';fuentes.mkdir()
        for nombre, segundos in (('v1', 8), ('v3', 4)):
            crudo = fuentes/f'{nombre}.mp4'
            ff(['-f', 'lavfi', '-i', f'testsrc=s=320x180:r=24:d={segundos}', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', crudo])
            mudo = fuentes/f'{nombre}-mudo.mp4';silent_video(crudo, mudo)
            shutil.copyfile(mudo, cls.root/f'{nombre}.media')
        for toma, *_ in TOMAS:
            png = fuentes/f'i{toma[1:]}.png'
            ff(['-f', 'lavfi', '-i', 'color=red:s=320x180', '-frames:v', '1', png])
            shutil.copyfile(png, cls.root/f'i{toma[1:]}.media')
        sumas = {p.stem: checksum(p) for p in cls.root.glob('*.media')}
        cls.plan = plan_de_prueba(lambda nombre: sumas[nombre])
        for aid, a in cls.plan['assets'].items():a['local'] = aid+'.media'

    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def test_a_preview_over_the_shots_with_hand_made_videos_is_assembled(self):
        from render import render
        fin = 264+120+86+24
        r = render(self.plan, self.root, 0, fin, False, width=160)
        self.assertEqual(r['frames'], fin)

    def test_a_timeline_saved_before_the_fix_still_assembles(self):
        # El montaje guardado antes del arreglo todavía dice «imagen» en la
        # toma que tiene video: el montaje decide por el archivo.
        import copy
        from render import render
        viejo = copy.deepcopy(self.plan)
        viejo['shots'][0]['treatment'] = 'hold';viejo['shots'][2]['treatment'] = 'camera2d'
        r = render(viejo, self.root, 0, 264+120+86, False, width=160)
        self.assertEqual(r['frames'], 264+120+86)

    def test_a_shot_that_cannot_be_assembled_is_named_in_plain_words(self):
        import copy
        from media import checksum
        from render import render
        roto = self.root/'roto.media';roto.write_bytes(b'esto no es una imagen'*50)
        plan = copy.deepcopy(self.plan)
        plan['assets']['i2'] = {**plan['assets']['i2'], 'local': 'roto.media', 'sha256': checksum(roto)}
        with self.assertRaises(ContractError) as fallo:
            render(plan, self.root, 0, 264+120, False, width=160)
        self.assertEqual(fallo.exception.code, 'MONTAJE')
        self.assertIn('Plano 02', str(fallo.exception))
        self.assertNotIn('t2', str(fallo.exception))


class UnFalloDelMontajeNoEsUnEnvioDudosoTests(unittest.TestCase):
    def setUp(self):
        from shorts.service.cloud import Cloud
        from test_job_recovery import DB
        self.c = Cloud.__new__(Cloud);self.c.c = {'project': 'project', 'region': 'region', 'job': 'worker'};self.c.http = Mock()
        self.c.db = DB({'animeShortsJobs/j': {'id': 'j', 'owner': 'u', 'projectId': 'p', 'operation': 'preview', 'state': 'running', 'session': 's', 'revision': 3, 'providerCalls': []},
                        'animeShortsProjects/p': {'id': 'p', 'owner': 'u'},
                        'animeShortsCapacity/media': {'jobId': 'j'}})
        p = patch('google.cloud.firestore.transactional', side_effect=lambda fn: fn);p.start();self.addCleanup(p.stop)
        spec = importlib.util.spec_from_file_location('runner_bajo_prueba', RAIZ/'worker/montage-shorts/runner.py')
        self.runner = importlib.util.module_from_spec(spec);spec.loader.exec_module(self.runner)

    @property
    def job(self):return self.c.db.data['animeShortsJobs/j']

    def falla(self, error, **trabajo):
        self.job.update(trabajo)
        reclamado = (self.job, self.c.db.data['animeShortsProjects/p'], True)
        with patch.dict(os.environ, {'SHORTS_JOB_ID': 'j'}), patch.object(self.runner, 'Cloud', return_value=self.c), \
             patch.object(type(self.c), 'claim', return_value=reclamado), patch.object(self.runner, 'run_job', side_effect=error):
            # Dentro de la imagen esta prueba corre bajo SHORTS_SELF_TEST=1, y
            # con esa variable main() lanza la autoprueba entera, que vuelve a
            # llegar aquí: una vuelta sin fin. patch.dict la devuelve al salir.
            for modo in ('SHORTS_SELF_TEST', 'SHORTS_CLOUD_SELF_TEST', 'SHORTS_DISPATCH_PROBE'):os.environ.pop(modo, None)
            with self.assertRaises(SystemExit):self.runner.main()

    def test_a_broken_preview_ends_as_a_plain_failure_that_can_be_asked_again(self):
        self.falla(subprocess.CalledProcessError(8, ['ffmpeg'], stderr=b'Option loop not found.'))
        self.assertEqual(self.job['state'], 'failed');self.assertTrue(self.job['settled'])
        self.assertIn('La vista previa se detuvo sin terminar', self.job['result']['error'])
        self.assertIn('No se gastó nada', self.job['result']['error'])

    def test_an_uncertain_paid_call_is_still_never_resent(self):
        self.falla(RuntimeError('connection reset'), operation='veo', providerCalls=[{'kind': 'veo', 'state': 'submitted_unknown'}])
        self.assertEqual(self.job['state'], 'submitted_unknown');self.assertFalse(self.job.get('settled'))

    def test_a_video_google_already_accepted_keeps_being_followed(self):
        self.falla(RuntimeError('timeout'), operation='veo', providerOperation='projects/x/operations/1',
                   providerCalls=[{'kind': 'veo', 'state': 'completed'}])
        self.assertEqual(self.job['state'], 'waiting_provider');self.assertEqual(self.job['errorCode'], 'VEO_PENDING')


class CerrarSinNadaDudosoTests(unittest.TestCase):
    def test_closing_a_job_without_any_uncertain_call_does_not_talk_about_charges(self):
        cerrado = close_uncertain({'state': 'submitted_unknown', 'revision': 1, 'providerCalls': []})
        self.assertIn('No se gastó nada', cerrado['result']['error'])
        self.assertNotIn('cobrarlo', cerrado['result']['error'])

    def test_closing_an_uncertain_call_still_warns(self):
        cerrado = close_uncertain({'state': 'submitted_unknown', 'revision': 1, 'providerCalls': [{'state': 'submitted_unknown'}]})
        self.assertIn('cobrarlo', cerrado['result']['error'])


if __name__ == '__main__':unittest.main()
