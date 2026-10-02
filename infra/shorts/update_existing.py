#!/usr/bin/env python3
"""Update the existing Cortos backend, not Animes or Vercel configuration.

Requires the owner's already authorized gcloud session. No keys, new projects,
IAM changes, model retries or user-media mutations. A failed probe is not ready.
"""
import argparse
import copy
import json
from pathlib import Path
import re
import tempfile
import urllib.request
import uuid

from install import ROOT, PREFIX, g, command, state_load, state_save, check_owned, current_release, build_config, health

SITE = 'https://anime-ai-studio-umber.vercel.app'


def read_site(path):
    with urllib.request.urlopen(SITE + '/api/shorts?path=' + path, timeout=25) as response:
        return json.load(response)


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def active_revisions(info):
    return {row.get('revisionName'): row.get('percent') for row in info.get('status', {}).get('traffic', []) if row.get('percent', 0)}


def validate_existing(project, account, state, service):
    """All checks precede the first infrastructure write."""
    require(state and state.get('project') == project and state.get('service') == PREFIX,
            'No se encontró la instalación original de Cortos. No se creó ni adoptó otra.')
    require(state.get('region') == 'us-central1' and state.get('bucket') == project + '-' + PREFIX,
            'La instalación no coincide con el espacio original de Cortos.')
    require(service.get('metadata', {}).get('labels', {}).get('managed-by') == 'anime-shorts-v2',
            'El servicio no está identificado como Cortos. No se modificó.')
    require(active_revisions(service) == {state['revision']: 100},
            'El tráfico cambió fuera del instalador. No se sobrescribió esa versión.')
    require(service['status']['url'] == state.get('url'), 'La dirección del servicio cambió. No se cambió Vercel.')
    spec = service['spec']['template']['spec']
    containers = spec.get('containers', [])
    require(len(containers) == 1 and containers[0].get('command') == ['gunicorn'],
            'La configuración de contenedores cambió. No se reemplazó.')
    require(all(isinstance(a, str) and '~' not in a for a in containers[0].get('args', []))
            and bool(containers[0].get('args')), 'Los argumentos del servidor necesitan revisión; no se reemplazaron.')
    rows = containers[0].get('env', [])
    require(all('value' in row for row in rows), 'Hay referencias de secretos que requieren revisión; no se descartaron.')
    env = {row['name']: row['value'] for row in rows}
    require(env.get('SHORTS_GCP_PROJECT_ID') == project and env.get('SHORTS_GCS_BUCKET') == state['bucket']
            and env.get('SHORTS_GCS_PREFIX') == PREFIX and env.get('SHORTS_FIRESTORE_DATABASE') == PREFIX
            and env.get('SHORTS_ENVIRONMENT') == 'production', 'Los recursos activos no coinciden con Cortos.')
    require(account.casefold() in {s.strip().casefold() for s in env.get('SHORTS_ALLOWED_EMAILS', '').split(',')},
            'Usa en Cloud Shell la misma cuenta propietaria configurada para Cortos.')
    require(spec.get('serviceAccountName') == env.get('SHORTS_SERVICE_ACCOUNT'), 'La identidad de ejecución cambió.')
    require(env.get('SHORTS_RENDER_JOB') == state.get('job'), 'El ejecutor activo cambió. No se sustituyó.')
    return env


def update(project):
    sha = current_release()
    require(re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', project), 'Identificador de proyecto inválido.')
    account = g('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)').strip()
    require(account and '\n' not in account, 'Inicia sesión con la cuenta propietaria en Cloud Shell.')
    region, bucket = 'us-central1', project + '-' + PREFIX
    require(check_owned(bucket, project), 'No existe el bucket original de Cortos. No se creó otro.')
    old = state_load(bucket)
    require(old and old.get('service') == PREFIX, 'No hay una instalación original que actualizar.')
    def describe():
        return json.loads(g('run', 'services', 'describe', PREFIX, '--project', project, '--region', region, '--format=json'))
    live = describe()
    env = validate_existing(project, account, old, live)
    print('\nProyecto: ' + project + '\nServidor actual: ' + old['commit'][:12] + '\nNueva versión: ' + sha[:12])
    print('Actualiza únicamente Cortos. Conserva historias, archivos, permisos y configuración de Animes/Vercel.')
    print('Se construirá la versión y se probarán UNA imagen y UNA voz con los modelos configurados (voz Kore),')
    print('con la identidad real del servidor. Build, ejecución y estas dos generaciones pueden generar cargos.')
    print('No se cambia de modelo ni se repiten pruebas automáticamente. Solo se activa si ambas entregan archivos válidos.')
    if input('Escribe ACTUALIZAR para autorizar; Enter cancela: ').strip() != 'ACTUALIZAR':
        print('Cancelado. Sin cambios ni generaciones.'); return
    token = uuid.uuid4().hex
    job = PREFIX + '-' + sha[:10] + '-' + token[:4]
    probe_job = PREFIX + '-check-' + token[:12]
    tag = 'check-' + token[:12]
    image = f'{region}-docker.pkg.dev/{project}/{PREFIX}/worker:{sha}'
    report_path = 'gs://' + bucket + '/installation/verification/' + token + '/report.json'
    with tempfile.TemporaryDirectory(prefix='shorts-release-') as folder:
        tmp = Path(folder); tmp.chmod(0o700)
        source = tmp / 'source'; source.mkdir()
        command(['git', 'archive', '--format=tar', '-o', str(tmp/'source.tar'), sha], cwd=ROOT)
        command(['tar', '-xf', str(tmp/'source.tar'), '-C', str(source)])
        builder = f'projects/{project}/serviceAccounts/{PREFIX}-build@{project}.iam.gserviceaccount.com'
        build = tmp/'build.json'; build.write_text(json.dumps(build_config(image, builder)))
        g('builds', 'submit', str(source), '--config', str(build), '--project', project, '--region', region,
          '--gcs-source-staging-dir', 'gs://' + bucket + '/build-source', capture=False)
        digest = g('artifacts', 'docker', 'images', 'describe', image, '--project', project, '--format=value(image_summary.digest)')
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', digest), 'No se confirmó el contenido de la imagen construida.')
        immutable = image.rsplit(':', 1)[0] + '@' + digest
        env.update(SHORTS_BUILD_COMMIT=sha, SHORTS_RENDER_JOB=job)
        # No generation test can leak into the regular worker's startup.
        env.pop('SHORTS_RELEASE_PROBE', None)
        envfile = tmp/'env.json'; envfile.write_text(json.dumps(env)); envfile.chmod(0o600)
        common = ['--image', immutable, '--region', region, '--project', project,
                  '--service-account', env['SHORTS_SERVICE_ACCOUNT'], '--env-vars-file', str(envfile),
                  '--cpu=2', '--memory=4Gi', '--task-timeout=3600s', '--max-retries=0', '--labels=managed-by=anime-shorts-v2']
        g('run', 'jobs', 'deploy', job, *common)
        # Update existing service settings in place, but do not send it traffic yet.
        g('run', 'deploy', PREFIX, '--image', immutable, '--project', project, '--region', region,
          '--update-env-vars', 'SHORTS_BUILD_COMMIT=' + sha + ',SHORTS_RENDER_JOB=' + job,
          '--no-traffic', '--tag', tag, '--command=gunicorn',
          '--args=^~^' + '~'.join(live['spec']['template']['spec']['containers'][0]['args']))
        info = describe()
        candidate_url = next(row['url'] for row in info['status']['traffic'] if row.get('tag') == tag)
        candidate = {**copy.deepcopy(old), 'revision': info['status']['latestReadyRevisionName'], 'image': immutable,
                     'commit': sha, 'job': job, 'diagnosticUrl': candidate_url, 'previous': old}
        require(health(project, region, candidate), 'La candidata no pasó la comprobación de infraestructura.')
        g('run', 'jobs', 'execute', job, '--project', project, '--region', region,
          '--update-env-vars', 'SHORTS_CLOUD_SELF_TEST=1,SHORTS_DIAGNOSTIC_URL=' + candidate_url, '--wait', capture=False)
        probe_env = {**env, 'SHORTS_RELEASE_PROBE': token}
        envfile.write_text(json.dumps(probe_env))
        g('run', 'jobs', 'deploy', probe_job, *common, '--command=python3', '--args=-m,shorts.service.release_probe')
        try:
            g('run', 'jobs', 'execute', probe_job, '--project', project, '--region', region, '--wait', capture=False)
        except RuntimeError:
            print('La prueba no terminó correctamente. Leyendo el resultado guardado; no se repetirá.')
        report = json.loads(g('storage', 'cat', report_path))
        for kind, label in [('image', 'Imagen'), ('tts', 'Voz')]:
            row = report.get(kind, {})
            print(label + ': ' + ('OK — archivo recibido y decodificado' if row.get('ok') else row.get('code', 'PENDIENTE') + ' — ' + row.get('message', 'Sin resultado confirmado')))
        require(report.get('commit') == sha and report.get('ok') is True
                and all(report.get(k, {}).get('ok') is True for k in ('image', 'tts')),
                'No se activó la candidata. Comparte el resultado anterior; no vuelvas a generar ni reinstalar a ciegas.')
        require(state_load(bucket) == old and active_revisions(describe()) == {old['revision']: 100},
                'Otra actualización cambió la instalación. No se sobrescribió.')
        candidate['mediaVerification'] = {'commit': sha, 'image': True, 'tts': True, 'report': report_path}
        try:
            g('run', 'services', 'update-traffic', PREFIX, '--to-revisions', candidate['revision'] + '=100', '--project', project, '--region', region)
            public = read_site('/health')
            require(public.get('commit') == sha, 'La web no está conectando con la candidata comprobada.')
            state_save(bucket, candidate, folder)
        except Exception:
            # Never roll back a separate concurrent deployment.
            if active_revisions(describe()) == {candidate['revision']: 100}:
                g('run', 'services', 'update-traffic', PREFIX, '--to-revisions', old['revision'] + '=100', '--project', project, '--region', region)
                latest = state_load(bucket)
                if latest.get('commit') == sha and latest.get('revision') == candidate['revision']:
                    state_save(bucket, old, folder)
            raise
        print('\nACTUALIZADO: web y servidor usan ' + sha[:12] + '. Imagen y voz verificadas con archivos reales.')
        print('Estas pruebas no verifican todavía video, música, sincronía labial ni todos los prompts del proyecto.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', help='Proyecto original; si se omite se lee la configuración pública de tu web.')
    args = parser.parse_args()
    project = args.project or read_site('/config').get('firebase', {}).get('projectId', '')
    update(project)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError, StopIteration) as error:
        print('\nNO COMPLETADO: ' + str(error)); raise SystemExit(1)
