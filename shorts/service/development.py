"""Chained development: each response is persisted before requesting the next."""
import copy
import json
import time
from shorts.core.contracts import require, ContractError
from shorts.service.director import develop_prompt, validate_development
from shorts.service.development_schema import development_schema

STAGES = (
    ('Historia y biblias', ('title', 'bible', 'beats'), 12288),
    ('Guion, actuación y planos', ('shots', 'utterances'), 24576),
    ('Sonido, música y subtítulos', ('soundRequests', 'musicRequests', 'subtitles'), 12288),
)

def develop(cloud, provider, job, project, idea):
    pid=project['id'];jid=job['id'];schema=development_schema()
    draft={'id':jid,'jobId':jid,'ideaId':idea['id'],'data':{},'stages':[],
           'created':time.time(),'status':'building','approvalState':'incomplete'}
    cloud.put_entity(pid,'developmentDrafts',copy.deepcopy(draft))
    ref=cloud.entity_ref(pid,'developmentDrafts',jid)
    job_ref=cloud.db.collection('animeShortsJobs').document(jid)
    base=develop_prompt(project,idea['data'])
    try:
        for index,(label,keys,limit) in enumerate(STAGES):
            job_ref.update({'progress':{'stage':index+1,'total':4,'label':label}})
            subset={'type':'OBJECT','properties':{k:schema['properties'][k] for k in keys},
                    'required':list(keys),'propertyOrdering':list(keys)}
            prompt=base+'\nEntrega únicamente esta etapa: '+label+'. No reescribas las etapas previas. Conserva sus IDs, continuidad, duración y decisiones. Los planos deben desarrollar todos los beats; las voces, silencios y subtítulos mantienen el japonés/español acordado.\nContexto ya guardado:\n'+json.dumps(draft['data'],ensure_ascii=False)
            part=provider.text(prompt,max_output_tokens=limit,response_schema=subset)
            # Keep even malformed output for diagnosis, without accepting it.
            draft['stages'].append({'name':label,'response':part})
            ref.update({'stages':copy.deepcopy(draft['stages'])})
            require(isinstance(part,dict) and set(part)==set(keys),'DEVELOPMENT_STAGE','Google devolvió una etapa incompleta: '+label)
            draft['data'].update(part)
            ref.update({'data':copy.deepcopy(draft['data']),'completedStages':index+1})
            if index==0:
                for kind in ('characters','locations','props'):
                    for row in part.get('bible',{}).get(kind,[]):
                        require(isinstance(row.get('referencePrompt'),str) and row['referencePrompt'].strip(),'DEVELOPMENT_TEXT','La respuesta de Google está incompleta: falta la descripción visual de referencia en «'+str(row.get('name',row.get('id','ficha')))+'».')
        result=validate_development(draft['data'])
        ref.update({'status':'validated'})
        job_ref.update({'progress':{'stage':4,'total':4,'label':'Revisión de continuidad'}})
        return result
    except ContractError as error:
        ref.update({'status':'invalid','error':{'code':error.code,'message':str(error)}})
        raise
