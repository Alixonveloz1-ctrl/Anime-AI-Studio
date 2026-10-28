from shorts.core.contracts import require, RATE, FPS, FRAMES, plan_beats, cue_render_data, digest, duration_target, resolve_event
from shorts.core.dependencies import select_assets
from shorts.core.subtitles import subtitle_segments,validate_segments
from shorts.core.timing import voice_layout,shot_bounds,is_vocal_sound

def approved_assets(cloud,pid):
    assets=[x.to_dict() for x in cloud.project_ref(pid).collection('assets').stream()]
    return sorted([a for a in assets if a.get('approvalState')=='approved'],key=lambda a:a.get('created',0))

AMBIENCE_REPEAT_LIMIT=64

def ambience_placements(shots,cue,audio_samples):
    """Lay a short ambience loop down as many times as its place lasts.

    An ambience used to be asked for as one file covering the whole short — 315
    seconds nobody can obtain. Now the plan asks for a loop of up to twenty
    seconds, and the montage repeats it from its shot until the location
    changes. Each copy is an ordinary cue, so gain, trims and approval travel
    with it; only the first fades in and only the last fades out.
    """
    anchor=cue.get('anchorShotId') or cue.get('shotId')
    index=next((i for i,s in enumerate(shots) if s['id']==anchor),None)
    if index is None:return [cue_render_data(cue)],False
    place=shots[index].get('locationId')
    end=shots[index]['startFrame']+shots[index]['frames']
    for later in shots[index+1:]:
        if later.get('locationId')!=place:break
        end=later['startFrame']+later['frames']
    start=(shots[index]['startFrame']+cue.get('anchorFrameOffset',0))*2000
    span=end*2000-start
    trim_in=cue.get('trimInSample',0);length=max(1,cue.get('trimOutSample',audio_samples)-trim_in)
    if span<=0:return [cue_render_data(cue)],False
    out=[];cursor=start
    while cursor<start+span and len(out)<AMBIENCE_REPEAT_LIMIT:
        piece=min(length,start+span-cursor)
        last=cursor+piece>=start+span
        repeat={**cue_render_data(cue),'anchorSample':cursor,'trimInSample':trim_in,'trimOutSample':trim_in+piece,
                'fadeInSamples':min(cue.get('fadeInSamples',0),piece) if not out else 0,
                'fadeOutSamples':min(cue.get('fadeOutSamples',0),piece) if last else 0}
        # Each repetition carries its own exact instant, so it must not keep the
        # shot anchor or the contact event the first placement was resolved by.
        for field in ('anchorShotId','anchorFrameOffset','eventId'):repeat.pop(field,None)
        if out:repeat['id']=cue['id']+'_bucle'+str(len(out)+1)
        out.append(repeat);cursor+=piece
    return out,cursor<start+span

def veo_retime(asset,frames):
    """Velocidad para que el clip completo cubra la toma, sin recortar.

    Devuelve None si no se conoce la duración real del clip; en ese caso
    el montaje conserva la velocidad que ya trae la toma.
    """
    clip_seconds=asset.get('clipSeconds') or None
    if not clip_seconds:
        try:clip_seconds=float(asset.get('probe',{}).get('format',{}).get('duration',0))
        except (TypeError,ValueError):clip_seconds=0
    if clip_seconds and frames>0:return clip_seconds*24/frames
    return None

def assemble_plan(cloud,p,cue_overrides=None):
    pid=p['id'];dev=cloud.entity(pid,'developments',p['activeDevelopment'])
    require(dev['approvalState']=='approved','SCRIPT_APPROVAL','Guion sin aprobar')
    d=dev['data'];available=approved_assets(cloud,pid)
    if 'approvedAssetIds' in p:available=[a for a in available if a['id'] in p['approvedAssetIds']]
    by=select_assets(available,d,dev['id'],p.get('assetSelections'))
    assets={};shots=[];cues=[];subtitles=[];elastic=[];voice_by_shot={};issues=[]
    if dev.get('editorialStage',4)<4:
        issues.append('Completa y aprueba el plan de sonido y la revisión de continuidad en Historia antes de exportar.')
    for u in d['utterances']:
        a=by.get((u['id'],'pcm'))
        if not a:
            issues.append('Falta voz aprobada: '+u['id']);continue
        voice_by_shot.setdefault(u['shotId'],[]).append((u,a))
    for s in d['shots']:
        speech=sum(a['samples'] for _,a in voice_by_shot.get(s['id'],[]));_,minimum=voice_layout(s,voice_by_shot.get(s['id'],[]))
        # Only pauses explicitly approved with development can absorb time.
        lo,hi=shot_bounds(s,minimum,draft=True)
        if lo>s.get('maxFrames',s['frames']):
            issues.append(f"La voz medida no cabe en el tiempo previsto de {s['id']}: el borrador alarga esa toma a {lo/24:.1f} s. Ajústala antes de exportar.")
        elastic.append({'id':s['id'],'minFrames':lo,'preferredFrames':max(lo,min(hi,s['frames'])),'maxFrames':hi,'timingEvidence':'measured_audio' if speech else 'approved_action'})
    target=duration_target(sum(b['minFrames'] for b in elastic),sum(b['preferredFrames'] for b in elastic),sum(b['maxFrames'] for b in elastic))
    planned=plan_beats(elastic,target)
    for s,t in zip(d['shots'],planned):
        kind='veo_silent_validated' if s['treatment']=='veo' else 'image'
        a=by.get((s['id'],kind))
        if not a:
            issues.append('Falta material aprobado: '+s['id'])
            a={'id':'missing_'+s['id']}
        else:assets[a['id']]=a
        shot={**s,'startFrame':t['startFrame'],'frames':t['frames'],'assetRevision':a['id'],'trimSeconds':s.get('trimSeconds',0),'speed':s.get('speed',1)}
        if shot['treatment']=='veo' and not a['id'].startswith('missing_'):
            # Regla del usuario, prohibido cortar: el clip completo se
            # acelera o se ralentiza para cubrir la toma, nunca se recorta
            # un segundo del final. La velocidad sale de la duración real
            # del clip aprobado, no de la duración pedida a Veo (4, 6 u 8 s).
            speed=veo_retime(a,t['frames'])
            if speed:shot['speed']=speed;shot['trimSeconds']=0;shot['retimeApproved']=True
        if a['id'].startswith('missing_'):shot.update(treatment='black',approvedBlack=True,draftPlaceholder=True)
        if shot['treatment']=='localized':
            layers=[]
            for layer in s.get('layers',[]):
                variant=next((x for x in available if x['id']==layer['assetRevision']),None)
                if not variant or variant.get('parentAssetId')!=a['id']:
                    issues.append('Revisar variante/máscara de '+s['id']);continue
                if layer['endFrame']>t['frames']:
                    issues.append('Revisar salida de capa tras cambiar duración: '+s['id']);continue
                if layer.get('voiceBinding'):
                    from shorts.core.mouth import mouth_frames
                    binding=layer['voiceBinding'];placements,_=voice_layout(s,voice_by_shot.get(s['id'],[]))
                    row=next((x for x in placements if x['utterance']['id']==binding['utteranceId']),None)
                    if not row or row['audio']['id']!=binding['audioRevision'] or row['audio']['sha256']!=binding['audioHash']:
                        issues.append('Revisar boca tras cambiar voz: '+s['id']);continue
                    layer={**layer,'intervals':mouth_frames(row['audio'],row['offsetSample'],t['frames'],layer['startFrame'],layer['endFrame'])}
                assets[variant['id']]=variant;layers.append(layer)
            shot['layers']=layers
            if not layers:
                issues.append('Faltan capas aprobadas: '+s['id']);shot.update(treatment='hold',draftPlaceholder=True)
        shots.append(shot)
        placements,_=voice_layout(s,voice_by_shot.get(s['id'],[]))
        for placement in placements:
            u,audio=placement['utterance'],placement['audio'];cursor=t['startFrame']*2000+placement['offsetSample']
            trimmed=placement.get('samples',audio['samples'])
            if trimmed<=0:
                issues.append('Sonido vocal sin espacio en el plano: '+u['id']);continue
            assets[audio['id']]=audio
            cues.append({'id':'voice_'+u['id'],'track':u['type'],'audioRevision':audio['id'],'anchorSample':cursor,'sourceSyncSample':0,'trimOutSample':trimmed,'approvalState':'approved'})
            if is_vocal_sound(u):
                # Regla del usuario: los subtítulos son solo para el diálogo
                # hablado. Un sonido vocal entre paréntesis (respiración,
                # gemido, gruñido, grito) suena, pero nunca sale como
                # subtítulo descriptivo en el video final.
                continue
            sub=next((x for x in d['subtitles'] if x['utteranceId']==u['id']),None)
            require(sub,'SUBTITLE_MISSING','Falta traducción española vinculada')
            segments,stale=subtitle_segments(u,audio,sub['text'],p.get('subtitleEdits',{}))
            if stale:issues.append('Revisar subtítulos tras cambiar audio: '+u['id'])
            segments=[{**seg,'endSample':min(seg['endSample'],trimmed)} for seg in segments if seg['startSample']<trimmed]
            warnings=validate_segments(segments,trimmed)
            if any(not w['exceptionApproved'] for w in warnings):issues.append('Legibilidad de subtítulos pendiente: '+u['id'])
            approved=p.get('subtitleApproval',{}).get('developmentId')==dev['id'] and p.get('subtitleApproval',{}).get('audioHashes',{}).get(audio['id'])==audio['sha256'] and not stale
            for segment in segments:
                subtitles.append({**segment,'startSample':cursor+segment['startSample'],'endSample':cursor+segment['endSample'],'audioRevision':audio['id'],'approvalState':'approved' if approved else 'needs_review','utteranceId':u['id']})
    all_cues=[x.to_dict() for x in cloud.project_ref(pid).collection('cues').stream()]
    selections={**p.get('cueSelections',{}),**(cue_overrides or {})}
    stored=[]
    # Una omisión es una decisión editorial sobre esa solicitud de sonido y
    # se mantiene aunque el guion cambie de revisión: si solo se respetara
    # con el mismo developmentId, omitir y luego revisar el guion haría que
    # el efecto volviera a pedirse, que era el error reportado.
    omitted=set(p.get('soundOmissions',{}).keys())
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
        current_shot=next((s for s in shots if s['id']==c['shotId']),None)
        if not current_shot:
            issues.append('Toma del efecto ya no existe: '+c['id']);continue
        # Regla del usuario, arreglo de fondo y no manual por proyecto:
        # al subir o generar un efecto, la app guarda un contacto visual
        # de relleno ('event_...') que todavía no existe, esperando que
        # alguien lo detecte después. Si nadie lo detectó, el montaje
        # antes saltaba el efecto y no sonaba, y eso se repetía en cada
        # proyecto nuevo. Ahora, si no hay contacto real, el efecto suena
        # igualmente: su ataque cae al inicio de su toma. Un ancla manual
        # posterior sigue ganando, porque entonces el evento sí existe.
        event=cloud.entity(pid,'events',c['eventId']) if c.get('eventId') and cloud.entity_ref(pid,'events',c['eventId']).get().exists else None
        if event and event.get('videoRevision')!=current_shot['assetRevision']:
            issues.append('Revisar ancla tras cambiar material: '+c['id']);continue
        req=next(r for r in d['soundRequests'] if r['id']==c['requestId'])
        if c.get('requestFingerprint') and c['requestFingerprint']!=digest(req):issues.append('Revisar efecto tras cambiar solicitud: '+c['id'])
        assets[a['id']]=a
        if c['track']=='ambience':
            placements,incomplete=ambience_placements(shots,c,a['samples'])
            if incomplete:issues.append('El ambiente «'+req['name']+'» es demasiado corto para cubrir su lugar; sube un bucle más largo.')
            cues.extend(placements)
        else:
            rendered=cue_render_data(c)
            # Regla del usuario: un efecto que dura más de lo que exige su
            # plano se recorta a la duración del plano, sin cortar nunca el
            # ataque que lo hace sonar. El ambiente queda fuera porque cubre
            # un lugar, no un solo plano, y ya se repite y recorta a su lugar.
            # Una solicitud omitida no llega aquí: se salta antes y el plano
            # conserva su duración normal, simplemente ese sonido no suena.
            if event:
                try:
                    event_sample=resolve_event(event,current_shot)['sample']
                    cue_start=event_sample-(int(c.get('sourceSyncSample',0))-int(c.get('trimInSample',0)))+int(c.get('offsetSamples',0))
                    shot_end=(current_shot['startFrame']+current_shot['frames'])*2000
                    trimmed_out=int(c.get('trimInSample',0))+max(0,shot_end-cue_start)
                    if trimmed_out<int(c.get('trimOutSample',a['samples'])) and trimmed_out>int(c.get('sourceSyncSample',0)):
                        rendered['trimOutSample']=trimmed_out
                except Exception:
                    pass
            else:
                # Sin contacto real: el ataque cae al inicio de la toma,
                # y el efecto suena desde su ataque hasta el final de la
                # toma, sin audio previo que se cuele en la toma anterior.
                # Nunca se salta un efecto en uso.
                rendered.pop('eventId',None)
                rendered['anchorSample']=current_shot['startFrame']*2000
                rendered['trimInSample']=int(c.get('sourceSyncSample',0))
                shot_samples=current_shot['frames']*2000
                trimmed_out=int(c.get('sourceSyncSample',0))+shot_samples
                if trimmed_out<int(c.get('trimOutSample',a['samples'])):
                    rendered['trimOutSample']=trimmed_out
            cues.append(rendered)
    for req in d['soundRequests']:
        if not any(c.get('requestId')==req['id'] for c in stored) and req.get('required',True) and req['id'] not in omitted:issues.append('Falta efecto obligatorio: '+req['name'])
    for r in d['musicRequests']:
        a=by.get((r['id'],'pcm'))
        if not a:
            issues.append('Falta música aprobada: '+r['id']);continue
        assets[a['id']]=a
        duration=(r['endFrame']-r['startFrame'])*2000
        source=r.get('sourceInSample',0)
        require(0<=source<a['samples'],'MUSIC_COVERAGE','La música no empieza dentro de su archivo')
        # Regla del usuario: música y efectos de sonido SÍ pueden repetirse
        # en bucle. Si la pieza aprobada es más corta que su intervalo, se
        # repite desde su inicio y la repetición se corta exactamente para
        # rellenar solo el tiempo faltante. No se inventa música nueva, no
        # se alarga el archivo y no se cambia la pieza aprobada.
        remaining=duration;anchor=r['startFrame']*2000;piece=0
        while remaining>0:
            take=min(a['samples']-source,remaining)
            cues.append({'id':'music_'+r['id'] if piece==0 else 'music_'+r['id']+'_bucle'+str(piece),'track':'music','audioRevision':a['id'],'anchorSample':anchor,'sourceSyncSample':source,'trimInSample':source,'trimOutSample':source+take,'gainDb':r.get('gainDb',-18),'fadeInSamples':r.get('fadeInSamples',0) if piece==0 else 0,'fadeOutSamples':r.get('fadeOutSamples',0) if take==remaining else 0,'approvalState':'approved'})
            anchor+=take;remaining-=take;piece+=1
    events={x.id:x.to_dict() for x in cloud.project_ref(pid).collection('events').stream()}
    used_events={c['eventId'] for c in cues if c.get('eventId')}
    # Waveforms (1600 peaks per audio) were already used above for subtitles and
    # mouths; copied into every timeline they pushed it past Firestore's 1 MB.
    assets={k:{field:value for field,value in a.items() if field!='waveform'} for k,a in assets.items()}
    return {'schemaVersion':2,'projectId':pid,'format':p['format'],'fps':FPS,'sampleRate':RATE,'frames':target,'assets':assets,'shots':shots,'cues':cues,'events':{k:v for k,v in events.items() if k in used_events},'subtitles':subtitles,'developmentId':dev['id'],'globalGainDb':0,'draftIssues':issues,'cueOverrides':cue_overrides or {},'mixPolicy':p.get('mixPolicy',{})}
