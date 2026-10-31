"""Reject impossible/missing inputs before reserving and dispatching a worker."""
from .contracts import require
from .dependencies import select_assets

def generation_inputs(development,development_id,assets,selections,operation,eid,variant=False):
    by=select_assets(assets,development,development_id,selections)
    shot=next((x for x in development['shots'] if x['id']==eid),None)
    if operation in ('image','veo'):
        if operation=='veo' or variant:
            require(shot,'SHOT','Selecciona una toma existente')
            require((eid,'image') in by,'IMAGE_APPROVAL','Aprueba la imagen vigente de esta toma')
            # Sin tope de duración para pedir video: cualquier toma, dure lo
            # que dure, recibe el video más cercano que se pueda generar y el
            # montaje lo ralentiza o lo acelera para cubrirla. Regla del dueño.
        elif shot:
            require(all((ref,'image') in by for ref in shot['referenceEntityIds']),'REFERENCE','Faltan referencias aprobadas vigentes; no se envió generación')
        else:require(any(x['id']==eid for group in ('characters','locations','props') for x in development['bible'][group]),'REFERENCE','Ficha inexistente')
    elif operation in ('tts','transcribe'):
        require(any(x['id']==eid for x in development['utterances']),'UTTERANCE','Intervención inexistente')
        if operation=='transcribe':require((eid,'pcm') in by,'VOICE_APPROVAL','Aprueba la voz vigente antes de reconocerla')
    elif operation=='music':require(any(x['id']==eid for x in development['musicRequests']),'MUSIC_REQUEST','Encargo musical inexistente')
    return by
