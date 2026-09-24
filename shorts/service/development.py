"""Chained development: each response is persisted before requesting the next."""
import copy
import json
import time
from shorts.core.contracts import require, ContractError
from shorts.service.director import develop_prompt, validate_development
from shorts.service.development_schema import development_schema
from shorts.service.references import link_references

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
        result=validate_development(link_references(draft['data']))
        ref.update({'status':'validated','data':result})
        job_ref.update({'progress':{'stage':4,'total':4,'label':'Revisión de continuidad'}})
        return result
    except ContractError as error:
        ref.update({'status':'invalid','error':{'code':error.code,'message':str(error)}})
        raise

def recovery_source(cloud,project,source_id,idea_id):
    source=cloud.db.collection('animeShortsJobs').document(source_id).get().to_dict()
    require(source and source.get('projectId')==project['id'] and source.get('owner')==project['owner'], 'RECOVERY_ACCESS','Guion guardado no disponible',404)
    require(source.get('operation')=='develop' and source.get('settled') and source.get('state')=='failed' and source.get('result',{}).get('code')=='REFERENCE_LINK','RECOVERY_STATE','Este trabajo no admite recuperación de referencias',409)
    require(source.get('payload',{}).get('ideaId')==idea_id,'IDEA_CHANGED','El guion guardado corresponde a otra idea',409)
    require(not any(c.get('state')=='submitted_unknown' for c in source.get('providerCalls',[])),'SUBMITTED_UNKNOWN','Hay una llamada pendiente de confirmar',409)
    draft=cloud.entity(project['id'],'developmentDrafts',source_id)
    require(draft.get('ideaId')==idea_id and isinstance(draft.get('data'),dict),'RECOVERY_DRAFT','Falta el borrador guardado',409)
    return draft

def recover(cloud,job,project,idea):
    source=recovery_source(cloud,project,job['payload']['resumeFrom'],idea['id'])
    data=validate_development(link_references(source['data']))
    cloud.put_entity(project['id'],'developmentDrafts',{'id':job['id'],'jobId':job['id'],'ideaId':idea['id'],
        'data':data,'sourceJobId':source['jobId'],'created':time.time(),'status':'validated','approvalState':'incomplete'})
    cloud.db.collection('animeShortsJobs').document(job['id']).update({'progress':{'stage':4,'total':4,'label':'Revisión del guion recuperado'}})
    return data
