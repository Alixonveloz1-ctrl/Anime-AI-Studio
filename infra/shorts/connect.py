"""Browser consent and numeric selection; no pasted tokens, keys or JSON.

Called by the authorized installer. Only SHORTS_* variables may be changed.
"""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

CLI = ['npx', '--yes', 'vercel@59.25.4']
BRANCH = 'main'
OWNER = 'Alixonveloz1-ctrl'
REPO = 'Anime-AI-Studio'


def google(g, host, path, method='GET', data=None, missing=False):
    if host not in ('firebase.googleapis.com', 'identitytoolkit.googleapis.com'):
        raise RuntimeError('Host de configuración no permitido')
    token = g('auth', 'print-access-token')
    request = urllib.request.Request('https://' + host + path, method=method,
        data=None if data is None else json.dumps(data).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        if missing and e.code == 404:
            return None
        # Provider errors may echo tokens or config: don't print response bodies.
        raise RuntimeError(f'Configuración Google rechazada ({e.code}); comprueba permisos en el proyecto elegido.') from e


def operation(g, value):
    for _ in range(90):
        if value.get('done'):
            if value.get('error'):
                raise RuntimeError('Google no completó la configuración Firebase. Instalación parcial conservada.')
            return value.get('response', {})
        time.sleep(2)
        value = google(g, 'firebase.googleapis.com', '/v1beta1/' + value['name'])
    raise RuntimeError('Configuración Firebase pendiente. Repite el menú de conexión para recuperar el estado.')


def firebase(g, pick, project):
    host = 'firebase.googleapis.com'
    base = '/v1beta1/projects/' + project
    existing = google(g, host, base, missing=True)
    if existing is None:
        operation(g, google(g, host, base + ':addFirebase', 'POST', {}))
    apps = google(g, host, base + '/webApps').get('apps', [])
    app = next((x for x in apps if x.get('displayName') in ('Anime Cortos', 'Anime Cortos preview')), None)
    if not app:
        app = operation(g, google(g, host, base + '/webApps', 'POST', {'displayName': 'Anime Cortos'}))
    cfg = google(g, host, '/v1beta1/' + app['name'] + '/config')
    # Firebase creates/manages the OAuth client from its Google sign-in screen.
    # Enabling an arbitrary client with invented credentials is never attempted.
    while True:
        idp = google(g, 'identitytoolkit.googleapis.com', '/admin/v2/projects/' + project + '/defaultSupportedIdpConfigs/google.com', missing=True)
        if idp and idp.get('enabled'):
            return {k: cfg[k] for k in ('apiKey', 'authDomain', 'projectId', 'appId') if k in cfg}
        print('\nAbre este enlace, activa Google en Authentication y selecciona el correo de soporte:')
        print('https://console.firebase.google.com/project/' + project + '/authentication/providers')
        if pick('Después de guardar en el navegador', ['Comprobar de nuevo', 'Volver sin activar']) == 'Volver sin activar':
            raise RuntimeError('Inicio de sesión pendiente. No se activó Cortos en Vercel.')


def vercel(command, path, method='GET', data=None):
    args = [*CLI, 'api', path, '--raw', '--method', method]
    with tempfile.TemporaryDirectory(prefix='shorts-vercel-') as tmp:
        if data is not None:
            file = Path(tmp) / 'body.json';file.write_text(json.dumps(data));file.chmod(0o600)
            args += ['--input', str(file)]
        return json.loads(command(args))


def find_project(command, pick):
    try:
        user = vercel(command, '/v2/user')['user']
    except RuntimeError:
        print('Autoriza Vercel en el navegador con el enlace que mostrará su cliente oficial.')
        command([*CLI, 'login'], capture=False)
        user = vercel(command, '/v2/user')['user']
    teams = vercel(command, '/v2/teams?limit=100').get('teams', [])
    choices = [('Personal: ' + user.get('username', user['id']), None)]
    choices += [(t.get('name', t['slug']), t['id']) for t in teams]
    label = pick('Cuenta/equipo Vercel', [c[0] for c in choices])
    team = next(team for name, team in choices if name == label)
    query = urllib.parse.urlencode({'limit': 100, **({'teamId': team} if team else {})})
    projects = vercel(command, '/v9/projects?' + query).get('projects', [])
    projects = [p for p in projects if p.get('link', {}).get('type') == 'github'
                and p['link'].get('repo', '').lower() == REPO.lower()
                and p['link'].get('org', '').lower() == OWNER.lower()]
    if not projects:
        raise RuntimeError('No se encontró el proyecto Vercel conectado a este repositorio. El instalador no creará otro producto.')
    name = pick('Proyecto existente de Anime AI Studio', [p['name'] for p in projects])
    return next(p for p in projects if p['name'] == name), team


def branch_vars(command, project_id, team, values, target='production', branch=BRANCH):
    if any(not k.startswith('SHORTS_') for k in values):
        raise RuntimeError('El instalador no puede editar configuración de Animes')
    if target not in ('preview', 'production') or (target == 'production' and branch != BRANCH):
        raise RuntimeError('El sitio habitual solo se conecta desde main')
    query = urllib.parse.urlencode({'upsert': 'true', **({'teamId': team} if team else {})})
    scope = {'gitBranch': branch} if target == 'preview' else {}
    payload = [{'key': k, 'value': v, 'type': 'encrypted', 'target': [target], **scope} for k, v in values.items()]
    result = vercel(command, '/v10/projects/' + project_id + '/env?' + query, 'POST', payload)
    if isinstance(result, dict) and result.get('failed'):
        raise RuntimeError('Vercel rechazó parte de la configuración; Cortos no está listo.')


def deployment_payload(project, state):
    if project['link'].get('productionBranch', 'main') != BRANCH:
        raise RuntimeError('El proyecto Vercel debe publicar main. No se modificó su configuración.')
    source = {'type': 'github', 'repoId': str(project['link']['repoId']), 'ref': BRANCH, 'sha': state['commit']}
    return {'name': project['name'], 'project': project['id'], 'gitSource': source, 'target': 'production'}


def connect(command, g, pick, state, save):
    project, team = find_project(command, pick)
    payload = deployment_payload(project, state)
    remote = command(['git', 'ls-remote', f'https://github.com/{OWNER}/{REPO}.git', 'refs/heads/' + BRANCH]).split()
    if not remote or remote[0] != state['commit']:
        raise RuntimeError('El ensamblador instalado no corresponde al main actual. Elige 6 y después 1 para actualizar antes de conectar.')
    print(f'\nGCP: {state["project"]}\nVercel: {project["name"]}\nRama: {BRANCH}\nDestino: tu página habitual')
    if pick('Conectar Cortos a tu página habitual (puede consumir build/almacenamiento)', ['Cancelar', 'Autorizar conexión']) == 'Cancelar':
        return state
    cfg = firebase(g, pick, state['project'])
    values = {'SHORTS_ENABLED': 'true', 'SHORTS_ENVIRONMENT': 'production', 'SHORTS_PRODUCTION_URL': state['url'], 'SHORTS_FIREBASE_WEB_CONFIG': json.dumps(cfg)}
    branch_vars(command, project['id'], team, values)
    query = '?' + urllib.parse.urlencode({'teamId': team}) if team else ''
    deployment = vercel(command, '/v13/deployments' + query, 'POST', payload)
    state.update(vercelProjectId=project['id'], vercelTeamId=team, deploymentId=deployment['id'], auth='configured', vercel='building')
    save(state)
    for _ in range(120):
        deployment = vercel(command, '/v13/deployments/' + state['deploymentId'] + query)
        if deployment.get('readyState') in ('ERROR', 'CANCELED'):
            raise RuntimeError('La página no se construyó. Se conserva el despliegue anterior.')
        if deployment.get('readyState') == 'READY':
            break
        time.sleep(3)
    else:
        raise RuntimeError('Despliegue aún pendiente; su ID quedó guardado en nube.')
    domains = sorted(set([deployment['url'], *deployment.get('alias', [])]))
    # Include the production aliases; preserve existing Firebase domains.
    identity = '/admin/v2/projects/' + state['project'] + '/config'
    old = google(g, 'identitytoolkit.googleapis.com', identity)
    allowed = sorted(set(old.get('authorizedDomains', []) + domains))
    google(g, 'identitytoolkit.googleapis.com', identity + '?updateMask=authorizedDomains', 'PATCH', {'name': 'projects/' + state['project'] + '/config', 'authorizedDomains': allowed})
    prior=json.loads(g('storage','buckets','describe','gs://'+state['bucket'],'--format=json'))
    previous_origins=[origin for rule in prior.get('cors',[]) for origin in rule.get('origin',[]) if origin.startswith('https://') and origin.endswith('.vercel.app')]
    origins=sorted(set(previous_origins+['https://'+d for d in domains]))
    with tempfile.TemporaryDirectory() as tmp:
        cors = Path(tmp) / 'cors.json'
        cors.write_text(json.dumps([{'origin': origins, 'method': ['GET', 'HEAD', 'PUT', 'POST'], 'responseHeader': ['Content-Type', 'Range', 'Content-Range', 'Location'], 'maxAgeSeconds': 3600}]))
        g('storage', 'buckets', 'update', 'gs://' + state['bucket'], '--cors-file', str(cors))
    aliases = [d for d in deployment.get('alias', []) if '-git-' not in d]
    site_url = 'https://' + (min(aliases, key=len) if aliases else deployment['url'])
    state.update(vercel='production_ready', siteUrl=site_url, auth='configured_not_browser_tested', environment='production', branch=BRANCH)
    save(state)
    print('Cortos en tu página: ' + state['siteUrl'] + '/cortos/')
    print('Verifica Entrar con Google desde el iPhone. Las pruebas con modelos requieren autorización. No se generó contenido.')
    return state
