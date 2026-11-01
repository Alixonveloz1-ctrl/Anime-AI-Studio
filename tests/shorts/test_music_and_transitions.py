"""«La música comienza bien, minuto y medio, luego dos minutos sin música, vuelve
veinte segundos y se vuelve a cortar.» «Los cambios entre un video y otro son
muy bruscos.» «No tengo necesidad de ver todo ese texto.» (U038)"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ/'worker/montage-shorts'))
from shorts.core.contracts import compile_timeline
from shorts.service.timeline import assemble_plan, reloj_del_guion, tramos_de_musica
from test_manual_development import complete

TOTAL = 6840


def plan(musica, aprobadas, tomas=(('t1', 1000), ('t2', 2000), ('t3', 500), ('t4', TOTAL-3500)), sin_aprobar=(), segundos=30, extra=()):
    d = complete();d['utterances'] = [];d['subtitles'] = [];d['soundRequests'] = []
    beat = d['beats'][0]['id']
    d['shots'] = [dict(d['shots'][0], id=i, beatId=beat, frames=f, minFrames=f, maxFrames=f, treatment='hold') for i, f in tomas]
    d['beats'] = [dict(d['beats'][0], minFrames=TOTAL, preferredFrames=TOTAL, maxFrames=TOTAL)]
    d['musicRequests'] = [{'id': m, 'prompt': 'Piano', 'seconds': 120, 'startFrame': a, 'endFrame': b, 'sourceInSample': 0,
                           'fadeInSamples': 0, 'fadeOutSamples': 0} for m, a, b in musica]
    comun = {'projectId': 'p', 'approvalState': 'approved', 'developmentId': 'dev', 'created': 1, 'sha256': '0'*64}
    filas = [{**comun, 'id': 'i'+t, 'entityId': t, 'kind': 'image'} for t, _ in tomas]
    filas += [{**comun, 'id': 'a'+m, 'entityId': m, 'kind': 'pcm', 'samples': segundos*48000, 'sampleRate': 48000} for m in aprobadas]
    filas += [{**comun, 'approvalState': 'candidate', 'id': 'c'+m, 'entityId': m, 'kind': 'pcm', 'samples': segundos*48000, 'sampleRate': 48000} for m in sin_aprobar]
    filas += list(extra)
    cloud = Mock()
    cloud.entity.return_value = {'id': 'dev', 'approvalState': 'approved', 'data': d}
    cloud.project_ref.return_value.collection.return_value.stream.return_value = [Mock(to_dict=lambda fila=fila: fila) for fila in filas]
    return assemble_plan(cloud, {'id': 'p', 'activeDevelopment': 'dev', 'format': '16:9'})


def huecos(cues, desde, hasta):
    tramos = sorted((c['anchorSample'], c['anchorSample']+c['trimOutSample']-c['trimInSample']) for c in cues if c['track'] == 'music')
    vacios, cursor = [], desde
    for a, b in tramos:
        if a > cursor:vacios.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < hasta:vacios.append((cursor, hasta))
    return vacios


def tramos_musicales(cues):
    out = {}
    for c in cues:
        if c['track'] != 'music':continue
        pieza = c['id'].removeprefix('music_').split('_bucle')[0]
        a, b = c['anchorSample'], c['anchorSample']+c['trimOutSample']-c['trimInSample']
        inicio, fin = out.get(pieza, (a, b))
        out[pieza] = (min(inicio, a), max(fin, b))
    return {k: (a, b) for k, (a, b) in out.items()}


class MusicaSinHuecosTests(unittest.TestCase):
    def test_a_missing_piece_is_covered_by_the_previous_one_and_the_last_reaches_the_end(self):
        # El caso del dueño: cuatro piezas, la 2 y la 4 sin generar.
        m = plan([('m1', 0, 1000), ('m2', 1000, 3000), ('m3', 3000, 3500), ('m4', 3500, TOTAL)], ['m1', 'm3'])
        self.assertEqual(huecos(m['cues'], 0, TOTAL*2000), [], 'nunca hay silencio en el fondo')
        self.assertEqual(sum('Falta música' in n for n in m['notes']), 2)
        self.assertFalse(any('música' in i for i in m['draftIssues']), 'la música que falta no frena la exportación')
        compile_timeline(m, False)

    def test_each_piece_plays_exactly_its_span_from_the_director(self):
        # «El tiempo de cada pista debe durar lo que diga el director.» Un
        # hueco que dejó el director se respeta: la pieza no se alarga.
        # Lo único que pasa de su tramo son los 2 s en que se apaga mientras
        # entra la siguiente (el fundido cruzado entre piezas).
        m = plan([('m1', 0, 1000), ('m3', 3000, 3500)], ['m1', 'm3'])
        self.assertEqual(tramos_musicales(m['cues']), {'m1': (0, 1000*2000+96000), 'm3': (3000*2000, 3500*2000)})

    def test_a_longer_file_is_cut_and_a_shorter_one_repeats_only_what_is_missing(self):
        # Tramo de 30 s con un archivo de 50 s: suenan 30 s. Tramo de 30 s con
        # un archivo de 25 s: suenan los 25 s y luego sólo 5 s más del principio.
        largo = plan([('m1', 0, 720), ('m2', 720, TOTAL)], ['m1', 'm2'], segundos=50)
        piezas = [c for c in largo['cues'] if c['id'].startswith('music_m1')]
        self.assertEqual(len(piezas), 1)
        self.assertEqual(piezas[0]['trimOutSample']-piezas[0]['trimInSample'], 720*2000+96000, 'sus 30 s y los 2 s del fundido con la siguiente')
        corto = plan([('m1', 0, 720)], ['m1'], segundos=25)
        piezas = sorted((c for c in corto['cues'] if c['id'].startswith('music_m1')), key=lambda c: c['anchorSample'])
        self.assertEqual([c['trimOutSample']-c['trimInSample'] for c in piezas], [25*48000, 5*48000])
        self.assertEqual(piezas[1]['trimInSample'], 0, 'la repetición empieza por el principio de la pista')

    def test_every_generated_track_plays_even_if_it_was_never_approved(self):
        # «Generé 5 pistas y sólo suenan 2.» Las que no se aprobaron aparte se
        # trataban como si no existieran y la anterior se repetía.
        cinco = [('m1', 0, 1000), ('m2', 1000, 3000), ('m3', 3000, 3500), ('m4', 3500, 5000), ('m5', 5000, TOTAL)]
        m = plan(cinco, ['m1', 'm2'], sin_aprobar=['m3', 'm4', 'm5'])
        self.assertEqual(set(tramos_musicales(m['cues'])), {'m1', 'm2', 'm3', 'm4', 'm5'})
        self.assertEqual(tramos_musicales(m['cues'])['m4'], (3500*2000, 5000*2000+96000))
        compile_timeline({**m, 'assets': {k: dict(a, sha256='%064x' % n) for n, (k, a) in enumerate(m['assets'].items(), 1)}}, True)

    def test_the_newest_track_of_a_piece_is_the_one_that_plays(self):
        comun = {'projectId': 'p', 'developmentId': 'dev', 'sha256': '0'*64, 'entityId': 'm1', 'kind': 'pcm', 'samples': 30*48000, 'sampleRate': 48000}
        nueva = {**comun, 'id': 'nueva', 'approvalState': 'candidate', 'created': 50}
        m = plan([('m1', 0, TOTAL)], ['m1'], extra=[nueva])
        self.assertTrue(all(c['audioRevision'] == 'nueva' for c in m['cues'] if c['track'] == 'music'))

    def test_music_ends_softly_at_the_end_of_the_short(self):
        m = plan([('m1', 0, TOTAL)], ['m1'])
        ultima = max((c for c in m['cues'] if c['track'] == 'music'), key=lambda c: c['anchorSample'])
        self.assertGreater(ultima['fadeOutSamples'], 0)
        self.assertLessEqual(ultima['fadeOutSamples'], ultima['trimOutSample']-ultima['trimInSample'])

    def test_music_follows_its_shots_when_a_shot_gets_longer(self):
        # El guion pone la música en su reloj. Si una toma se alarga por la
        # voz, todo lo que viene después se corre con ella.
        guion = [{'frames': 100}, {'frames': 100}, {'frames': 100}]
        montado = [{'startFrame': 0, 'frames': 100}, {'startFrame': 100, 'frames': 200}, {'startFrame': 300, 'frames': 100}]
        mapear = reloj_del_guion(guion, montado)
        self.assertEqual(mapear(0), 0)
        self.assertEqual(mapear(150), 200, 'la mitad de la toma alargada sigue siendo su mitad')
        self.assertEqual(mapear(200), 300, 'la tercera toma empieza donde empieza de verdad')
        self.assertEqual(mapear(300), 400, 'el final del guion es el final del corto')
        tramos = tramos_de_musica([{'id': 'a', 'startFrame': 0, 'endFrame': 200}, {'id': 'b', 'startFrame': 200, 'endFrame': 300}], mapear, 400, lambda r: r)
        self.assertEqual([(i, f) for i, f, *_ in tramos], [(0, 300), (300, 400)])


class AvisosQueNoFrenanTests(unittest.TestCase):
    def test_a_complete_short_has_nothing_blocking_even_with_notes(self):
        m = plan([('m1', 0, TOTAL)], ['m1'])
        self.assertEqual(m['draftIssues'], [])
        sumas = {k: dict(a, sha256='%064x' % n) for n, (k, a) in enumerate(m['assets'].items(), 1)}
        compile_timeline({**m, 'assets': sumas}, True)


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class FundidoEntreTomasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from media import ff, checksum
        cls.temp = tempfile.TemporaryDirectory(prefix='shorts-fundido-');cls.root = Path(cls.temp.name)
        for nombre, color in (('rojo', 'red'), ('azul', 'blue')):
            png = cls.root/f'{nombre}.png'
            ff(['-f', 'lavfi', '-i', f'color={color}:s=160x90', '-frames:v', '1', png])
            shutil.copyfile(png, cls.root/f'{nombre}.media')
        sumas = {n: checksum(cls.root/f'{n}.media') for n in ('rojo', 'azul')}
        activo = lambda n: {'projectId': 'p', 'kind': 'image', 'approvalState': 'approved', 'sha256': sumas[n], 'local': n+'.media'}
        cls.manifest = {'schemaVersion': 2, 'projectId': 'p', 'format': '16:9', 'fps': 24, 'sampleRate': 48000, 'frames': 96,
                        'assets': {'rojo': activo('rojo'), 'azul': activo('azul')},
                        'shots': [{'id': 'a', 'startFrame': 0, 'frames': 48, 'assetRevision': 'rojo', 'treatment': 'hold'},
                                  {'id': 'b', 'startFrame': 48, 'frames': 48, 'assetRevision': 'azul', 'treatment': 'hold'}],
                        'events': {}, 'cues': [], 'subtitles': []}

    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def color(self, video, frame):
        from media import ff
        crudo = ff(['-i', video, '-vf', f'select=eq(n\\,{frame}),scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
        return tuple(crudo[:3])

    def test_the_cut_dissolves_instead_of_jumping(self):
        from render import render, FUNDIDO
        r = render(self.manifest, self.root, 0, 96, False, width=160)
        self.assertEqual(r['frames'], 96, 'la duración no cambia')
        video = self.root/'preview.mp4'
        antes, medio, despues = self.color(video, 47), self.color(video, 48+FUNDIDO//2), self.color(video, 48+FUNDIDO+2)
        self.assertGreater(antes[0], 200);self.assertLess(antes[2], 60)
        self.assertGreater(medio[0], 60, 'a mitad del fundido todavía se ve la toma anterior')
        self.assertGreater(medio[2], 60, 'y ya se ve la nueva')
        self.assertLess(despues[0], 60);self.assertGreater(despues[2], 200)

    def test_a_preview_that_starts_inside_the_dissolve_looks_the_same(self):
        from render import render, FUNDIDO
        render(self.manifest, self.root, 0, 96, False, width=160)
        entero = self.color(self.root/'preview.mp4', 48+FUNDIDO//2)
        r = render(self.manifest, self.root, 48+2, 96, False, width=160)
        self.assertEqual(r['frames'], 96-50)
        trozo = self.color(self.root/'preview.mp4', FUNDIDO//2-2)
        for a, b in zip(entero, trozo):self.assertLessEqual(abs(a-b), 12)


if __name__ == '__main__':unittest.main()


class NadaQueAprobarTests(unittest.TestCase):
    """«Yo no tengo por qué estar aprobando nada. Siempre la generación más
    nueva debe ser la que se utilice. De todo.» (U041)"""

    def test_a_generated_image_is_in_use_from_the_moment_it_exists(self):
        import copy
        from unittest.mock import patch
        from shorts.service.production import run_job
        from shorts.service.config import config
        from shorts.core.requests import selected_models
        cloud = Mock();cloud.c = config()
        cloud.entity.return_value = {'id': 'dev', 'data': complete()};cloud.upload_file.return_value = 'image.png'
        with patch('shorts.service.production.Providers') as provider, patch('shorts.service.production.inspect'):
            provider.return_value.image.return_value = (b'image', 'image/png')
            run_job(cloud, {'id': 'job', 'operation': 'image', 'models': selected_models(cloud.c, {}), 'payload': {'entityId': 'hero'}},
                    {'id': 'p', 'format': '16:9', 'activeDevelopment': 'dev'})
        self.assertEqual(cloud.put_entity.call_args.args[2]['approvalState'], 'approved')

    def test_whatever_was_generated_before_this_rule_goes_into_the_montage(self):
        from shorts.service.timeline import approved_assets
        filas = [{'id': 'a', 'approvalState': 'candidate', 'created': 1}, {'id': 'b', 'approvalState': 'approved', 'created': 2},
                 {'id': 'c', 'approvalState': 'quarantined', 'created': 3}]
        cloud = Mock();cloud.project_ref.return_value.collection.return_value.stream.return_value = [Mock(to_dict=lambda f=f: f) for f in filas]
        self.assertEqual([(a['id'], a['approvalState']) for a in approved_assets(cloud, 'p')], [('a', 'approved'), ('b', 'approved')])
