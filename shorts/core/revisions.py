"""Local editorial edits produce candidates; approvals are immutable history."""
import copy
from .contracts import require, digest
from .dependencies import select_assets

ROOTS={'title','bible','beats','shots','utterances','soundRequests','musicRequests','subtitles'}
IDEA_FIELDS={'title','premise','characters','initialSituation','objective','obstacle','emotionalProgression','climax','ending','visualComplexity'}

def idea_scope(idea,scope,replacement=None):
    require(isinstance(scope,dict) and scope.get('field') in IDEA_FIELDS,'REVISION_SCOPE','Elige el campo de la idea que quieres corregir')
    field=scope['field'];require(field in idea,'IDEA_SCHEMA','Campo inexistente')
    if replacement is None:return {'id':idea['id'],field:copy.deepcopy(idea[field])}
    require(replacement.get('id')==idea['id'] and field in replacement,'IDEA_SCHEMA','Corrección incompleta')
    require(type(replacement[field]) is type(idea[field]),'IDEA_SCHEMA','El tipo del campo cambió')
    return {**copy.deepcopy(idea),field:copy.deepcopy(replacement[field])}

def apply_edits(original, patches):
    require(isinstance(patches,list) and 0<len(patches)<=500,'EDITS','Selecciona al menos un cambio')
    result=copy.deepcopy(original)
    # A reorder is a permutation of the SAME shots, recorded as the order of
    # their ids and applied LAST. Applied in sequence with the field edits of
    # the same dialog, it either overwrote them (its value is the shots as they
    # were before the edits) or made them land on whichever shot had moved into
    # that index, so one shot silently got the other one's new description.
    order=None
    fields=[]
    for patch in patches:
        if patch.get('path')==['shots']:
            shots=patch.get('value')
            require(isinstance(shots,list) and sorted(digest(x) for x in shots)==sorted(digest(x) for x in result.get('shots',[])),'EDIT_STRUCTURE','Solo se admite reordenar las tomas existentes')
            order=[x.get('id') for x in shots]
            continue
        fields.append(patch)
    for patch in fields:
        path=patch.get('path',[])
        require(isinstance(path,list) and 0<len(path)<=12 and path[0] in ROOTS,'EDIT_PATH','Campo no editable')
        require('id' not in path and all(type(p) in (str,int) for p in path),'EDIT_ID','Los identificadores se conservan')
        node=result
        for key in path[:-1]:
            require((isinstance(node,dict) and key in node) or (isinstance(node,list) and type(key)is int and 0<=key<len(node)),'EDIT_PATH','Campo inexistente')
            node=node[key]
        key=path[-1]
        require((isinstance(node,dict) and key in node) or (isinstance(node,list) and type(key)is int and 0<=key<len(node)),'EDIT_PATH','Campo inexistente')
        old=node[key];new=patch.get('value')
        require(type(new)==type(old) or (type(old) in (int,float) and type(new) in (int,float)),'EDIT_TYPE','El tipo del campo cambió')
        # Structural edits go through dedicated commands; never accept a hidden rewrite.
        require(not isinstance(new,(list,dict)),'EDIT_STRUCTURE','Solo se admite reordenar las tomas existentes')
        if isinstance(new,str):require(len(new)<=12000,'EDIT_SIZE','Texto demasiado largo')
        node[key]=copy.deepcopy(new)
    if order is not None:
        shots=result.get('shots',[])
        by_id={s.get('id'):s for s in shots}
        require(len(by_id)==len(shots) and sorted(map(str,order))==sorted(map(str,by_id)),'EDIT_STRUCTURE','Solo se admite reordenar las tomas existentes')
        result['shots']=[by_id[i] for i in order]
    digest(result)  # rejects NaN/Infinity
    return result

def changes(old,new,path=()):
    """Actual changes, independent of an AI's self-reported affectedIds."""
    if old==new:return []
    if isinstance(old,dict) and isinstance(new,dict):
        return [c for k in sorted(set(old)|set(new)) for c in changes(old.get(k),new.get(k),path+(k,))]
    if isinstance(old,list) and isinstance(new,list) and len(old)==len(new):
        return [c for i,(a,b) in enumerate(zip(old,new)) for c in changes(a,b,path+(i,))]
    return [{'path':list(path),'before':old,'after':new}]

def impact(old,new,assets,old_id,selections=None):
    before=select_assets(assets,old,old_id,selections);after=select_assets(assets,new,'candidate',selections)
    affected=[{'assetId':a['id'],'entityId':a['entityId'],'kind':a['kind']} for key,a in before.items() if after.get(key,{}).get('id')!=a['id']]
    return {'changes':changes(old,new),'assetsNeedingReview':affected,
            'retainedApprovedAssetIds':[a['id'] for a in after.values()],
            'timelineNeedsReview':old!=new,'paidCalls':0}


def scoped_value(development,scope):
    require(isinstance(scope,dict),'REVISION_SCOPE','Elige el alcance de la corrección')
    group=scope.get('group');eid=scope.get('entityId')
    require(group in ('shots','utterances','soundRequests','musicRequests','characters','locations','props','whole'),'REVISION_SCOPE','Alcance inválido')
    if group=='whole':return development
    rows=development['bible'][group] if group in ('characters','locations','props') else development[group]
    target=next((x for x in rows if x['id']==eid),None)
    require(target,'REVISION_SCOPE','Entidad inexistente');return target


def replace_scope(development,scope,replacement):
    target=scoped_value(development,scope)
    require(isinstance(replacement,dict),'REVISION_SCHEMA','Corrección incompleta')
    if scope['group']=='whole':return copy.deepcopy(replacement)
    require(replacement.get('id')==target['id'],'REVISION_ID','La corrección no puede cambiar el identificador')
    result=copy.deepcopy(development);group=scope['group']
    rows=result['bible'][group] if group in ('characters','locations','props') else result[group]
    rows[next(i for i,x in enumerate(rows) if x['id']==target['id'])]=copy.deepcopy(replacement)
    return result
