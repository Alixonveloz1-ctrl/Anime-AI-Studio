"""A batch is a persisted intention, never permission to bypass human approvals."""
from .contracts import digest
from .dependencies import fingerprint,select_assets


def pending_plan(development, development_id, assets, jobs, selections=None):
    selected=select_assets(assets,development,development_id,selections)
    nodes=[]
    for group in ('characters','locations','props'):
        nodes.extend({'entityId':x['id'],'operation':'image','kind':'image','requires':[]} for x in development['bible'][group])
    for shot in development['shots']:
        nodes.append({'entityId':shot['id'],'operation':'image','kind':'image','requires':[(x,'image') for x in shot['referenceEntityIds']]})
        if shot['treatment']=='veo':nodes.append({'entityId':shot['id'],'operation':'veo','kind':'veo_silent_validated','requires':[(shot['id'],'image')]})
    nodes.extend({'entityId':u['id'],'operation':'tts','kind':'pcm','requires':[]} for u in development['utterances'])
    nodes.extend({'entityId':m['id'],'operation':'music','kind':'pcm','requires':[]} for m in development['musicRequests'])
    for node in nodes:
        eid,kind=node['entityId'],node['kind'];node['key']=node['operation']+':'+eid
        node['fingerprint']=fingerprint(development,eid,kind)
        if (eid,kind) in selected:
            node.update(state='approved',assetId=selected[(eid,kind)]['id']);continue
        candidate=next((a for a in reversed(assets) if a.get('entityId')==eid and a['kind']==kind and a.get('approvalState')=='candidate'
            and a.get('inputFingerprint')==node['fingerprint'] and all(selected.get((x['entityId'],x['kind']),{}).get('id')==x['assetId'] for x in a.get('dependencies',[]))),None)
        if candidate:
            node.update(state='review',assetId=candidate['id']);continue
        active=next((j for j in jobs if j['operation']==node['operation'] and j['payload'].get('entityId')==eid and j['payload'].get('developmentId')==development_id
            and not j.get('settled') and j['state'] not in ('failed','cancelled')),None)
        if active:
            node.update(state='working',jobId=active['id']);continue
        missing=[eid for eid,kind in node['requires'] if (eid,kind) not in selected]
        node.update(state='blocked' if missing else 'ready',missing=missing)
    return nodes


def batch_key(batch, node):
    return 'batch-'+digest([batch['id'],node['key'],node['fingerprint']])
