import os
from shorts.core.contracts import require

def config():
    def e(k,default=''):return os.environ.get('SHORTS_'+k,default)
    p=e('GCP_PROJECT_ID'); env=e('ENVIRONMENT','preview')
    prefix=e('GCS_PREFIX',f'anime-shorts-v2-{env}')
    require(prefix.startswith('anime-shorts-') and '/' not in prefix,'PREFIX','Prefijo exclusivo de Cortos requerido')
    require(env in ('preview','production'),'ENVIRONMENT','Entorno inválido')
    return {'project':p,'environment':env,'bucket':e('GCS_BUCKET'),'prefix':prefix,'database':e('FIRESTORE_DATABASE','anime-shorts-preview'),
      'region':e('REGION','us-central1'),'service':e('PRODUCTION_URL'),'queue':e('QUEUE','anime-shorts-preview'),'job':e('RENDER_JOB','anime-shorts-preview-media'),
      'serviceAccount':e('SERVICE_ACCOUNT'),'allowedEmails':e('ALLOWED_EMAILS').split(','),'authProject':e('AUTH_PROJECT_ID',p),
      'models':{k: {'model':e(k.upper()+'_MODEL',m),'region':e(k.upper()+'_REGION',r)} for k,m,r in [
        ('text','gemini-3.1-pro-preview','global'),('analysis','gemini-3.1-pro-preview','global'),('image','gemini-3.1-flash-image','global'),('veo','veo-3.1-generate-001','us-central1'),('tts','gemini-2.5-pro-tts','global'),('music','lyria-3-pro-preview','global')]}}
