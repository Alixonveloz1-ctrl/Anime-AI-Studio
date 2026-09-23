"""Explicit copies with provenance; no cross-project object references in edits."""
import copy
from .contracts import require,digest
from .dependencies import fingerprint

def import_candidate(source,source_development,target_development,target_id):
    require(source.get('approvalState')=='approved','IMPORT_APPROVAL','Solo se importan recursos aprobados')
    d=copy.deepcopy(target_development);group=None
    for candidate in ('characters','locations','props'):
        original=next((x for x in source_development['bible'][candidate] if x['id']==source['entityId']),None)
        target=next((x for x in d['bible'][candidate] if x['id']==target_id),None)
        if original and target and source['kind']=='image':
            group=candidate;d['bible'][candidate]=[{**copy.deepcopy(original),'id':target_id} if x['id']==target_id else x for x in d['bible'][candidate]];break
    if not group:
        require(source['kind']=='pcm' and any(x['id']==source['entityId'] for x in source_development['musicRequests']) and any(x['id']==target_id for x in d['musicRequests']),'IMPORT_SCOPE','Importa una referencia del mismo tipo o una pieza musical')
        group='musicRequests'
    provenance={'projectId':source['projectId'],'assetId':source['id'],'sha256':source['sha256'],'entityId':source['entityId'],'developmentId':source['developmentId'],'sourceDefinitionHash':digest(source_development),'explicit':True}
    return d,{'entityId':target_id,'kind':source['kind'],'inputFingerprint':fingerprint(d,target_id,source['kind']),'dependencies':[],'provenance':provenance,'source':'import','reviewNote':'Revisa la referencia importada dentro de esta historia; no supone continuidad automática.','importGroup':group}
