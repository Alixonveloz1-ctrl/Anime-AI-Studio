from shorts.core.contracts import require, RATE, FPS, FRAMES, plan_beats
from shorts.core.dependencies import select_assets
from shorts.core.subtitles import subtitle_segments,validate_segments

def approved_assets(cloud,pid):
    assets=[x.to_dict() for x in cloud.project_ref(pid).collection('assets').stream()]
    return sorted([a for a in assets if a.get('approvalState')=='approved'],key=lambda a:a.get('created',0))

def assemble_plan(cloud,p,cue_overrides=None):
    pid=p['id'];dev=cloud.entity(pid,'developments',p['activeDevelopment'])
    require(dev['approvalState']=='approved','SCRIPT_APPROVAL','Guion sin aprobar')
    d=dev['data'];available=approved_assets(cloud,pid);by=select_assets(available,d,dev['id'])
    assets={};shots=[];cues=[];subtitles=[];elastic=[];voice_by_shot={};issues=[]
    for u in d['utterances']:
        a=by.get((u['id'],'pcm'))
        if not a:
            issues.append('Falta voz aprobada: '+u['id']);continue
        voice_by_shot.setdefault(u['shotId'],[]).append((u,a))
    for s in d['shots']:
        speech=sum(a['samples'] for _,a in voice_by_shot.get(s['id'],[]));minimum=(speech+1999)//2000
        # Only pauses explicitly approved with development can absorb time.
        lo=max(minimum,s.get('minFrames',s['frames']));hi=s.get('maxFrames',s['frames'])
        require(lo<=hi,'SCRIPT_REVIEW','La voz excede la pausa/acción autorizada en '+s['id']+'; revisa el guion')
        elastic.append({'id':s['id'],'minFrames':lo,'preferredFrames':max(lo,min(hi,s['frames'])),'maxFrames':hi,'timingEvidence':'measured_audio' if speech else 'approved_action'})
    planned=plan_beats(elastic)
    for s,t in zip(d['shots'],planned):
        kind='veo_silent_validated' if s['treatment']=='veo' else 'image'
        a=by.get((s['id'],kind))
        if not a:
            issues.append('Falta material aprobado: '+s['id'])
            a={'id':'missing_'+s['id']}
        else:assets[a['id']]=a
        shot={**s,'startFrame':t['startFrame'],'frames':t['frames'],'assetRevision':a['id'],'trimSeconds':s.get('trimSeconds',0),'speed':s.get('speed',1)}
        if a['id'].startswith('missing_'):shot.update(treatment='black',approvedBlack=True,draftPlaceholder=True)
        shots.append(shot);cursor=t['startFrame']*2000
        for u,audio in voice_by_shot.get(s['id'],[]):
            assets[audio['id']]=audio
            cues.append({'id':'voice_'+u['id'],'track':u['type'],'audioRevision':audio['id'],'anchorSample':cursor,'sourceSyncSample':0,'trimOutSample':audio['samples'],'approvalState':'approved'})
            sub=next((x for x in d['subtitles'] if x['utteranceId']==u['id']),None)
            require(sub,'SUBTITLE_MISSING','Falta traducción española vinculada')
            segments,stale=subtitle_segments(u,audio,sub['text'],p.get('subtitleEdits',{}))
            if stale:issues.append('Revisar subtítulos tras cambiar audio: '+u['id'])
            warnings=validate_segments(segments,audio['samples'])
            if any(not w['exceptionApproved'] for w in warnings):issues.append('Legibilidad de subtítulos pendiente: '+u['id'])
            approved=p.get('subtitleApproval',{}).get('developmentId')==dev['id'] and p.get('subtitleApproval',{}).get('audioHashes',{}).get(audio['id'])==audio['sha256'] and not stale
            for segment in segments:
                subtitles.append({**segment,'startSample':cursor+segment['startSample'],'endSample':cursor+segment['endSample'],'audioRevision':audio['id'],'approvalState':'approved' if approved else 'needs_review','utteranceId':u['id']})
            cursor+=audio['samples']
    all_cues=[x.to_dict() for x in cloud.project_ref(pid).collection('cues').stream()]
    selections={**p.get('cueSelections',{}),**(cue_overrides or {})}
    stored=[]
    omitted={k for k,v in p.get('soundOmissions',{}).items() if v.get('developmentId')==dev['id']}
    for req in d['soundRequests']:
        if req['id'] in omitted:continue
        versions=sorted([c for c in all_cues if c.get('requestId')==req['id']],key=lambda c:c.get('created',0))
        if versions:
            selected=next((c for c in versions if c['id']==selections.get(req['id'])),None) or versions[-1]
            stored.append(selected)
    for c in stored:
        if c.get('supersededBy'):continue
        if c.get('requestId') not in {r['id'] for r in d['soundRequests']}:continue
        a=next((a for a in available if a['id']==c['audioRevision']),None)
        if not a:
            issues.append('Falta efecto aprobado: '+c['id']);continue
        if c.get('eventId') and not cloud.entity_ref(pid,'events',c['eventId']).get().exists:
            issues.append('Falta contacto visual: '+c['id']);continue
        current_shot=next((s for s in shots if s['id']==c['shotId']),None)
        if not current_shot:
            issues.append('Toma del efecto ya no existe: '+c['id']);continue
        event=cloud.entity(pid,'events',c['eventId']) if c.get('eventId') else None
        if event and event.get('videoRevision')!=current_shot['assetRevision']:
            issues.append('Revisar ancla tras cambiar material: '+c['id']);continue
        assets[a['id']]=a;cues.append(c)
    for req in d['soundRequests']:
        if not any(c.get('requestId')==req['id'] for c in stored) and req.get('required',True) and req['id'] not in omitted:issues.append('Falta efecto obligatorio: '+req['name'])
    for r in d['musicRequests']:
        a=by.get((r['id'],'pcm'))
        if not a:
            issues.append('Falta música aprobada: '+r['id']);continue
        assets[a['id']]=a
        duration=(r['endFrame']-r['startFrame'])*2000
        require(duration<=a['samples'],'MUSIC_COVERAGE','La música no cubre el intervalo; ajusta la edición sin inventar extensión')
        cues.append({'id':'music_'+r['id'],'track':'music','audioRevision':a['id'],'anchorSample':r['startFrame']*2000,'sourceSyncSample':0,'trimOutSample':duration,'gainDb':r.get('gainDb',-18),'approvalState':'approved'})
    events={x.id:x.to_dict() for x in cloud.project_ref(pid).collection('events').stream()}
    used_events={c['eventId'] for c in cues if c.get('eventId')}
    return {'schemaVersion':2,'projectId':pid,'format':p['format'],'fps':FPS,'sampleRate':RATE,'frames':FRAMES,'assets':assets,'shots':shots,'cues':cues,'events':{k:v for k,v in events.items() if k in used_events},'subtitles':subtitles,'developmentId':dev['id'],'globalGainDb':0,'draftIssues':issues,'cueOverrides':cue_overrides or {},'mixPolicy':p.get('mixPolicy',{})}
