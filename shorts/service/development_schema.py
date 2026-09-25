"""Vertex responseSchema for new developments; existing stories are not migrated."""

def development_schema():
    def text(description=None):
        return {'type':'STRING',**({'description':description} if description else {})}
    def number(kind='INTEGER',minimum=0,maximum=7560):
        return {'type':kind,'minimum':minimum,'maximum':maximum}
    def obj(**properties):
        return {'type':'OBJECT','properties':properties,'required':list(properties),
                'propertyOrdering':list(properties)}
    def rows(items,minimum=0):
        return {'type':'ARRAY','items':items,'minItems':minimum}
    def strings():return rows(text())
    reference=text('Descripción visual completa y no vacía para generar la referencia maestra de esta entidad; identidad, aspecto, materiales y detalles constantes.')
    character=obj(id=text(),name=text(),japaneseReading=text(),age=number(maximum=130),
        objective=text(),relationships=strings(),speech=text(),
        voice=obj(name=text('Nombre de voz Gemini TTS.'),languageCode={'type':'STRING','enum':['ja-JP']},direction=text()),
        costumes=rows(obj(id=text(),description=text()),1),referencePrompt=reference)
    location=obj(id=text(),name=text(),layout=text('Distribución espacial y posiciones relativas.'),
        entrances=strings(),windows=strings(),furniture=strings(),light=text(),soundZones=strings(),referencePrompt=reference)
    prop=obj(id=text(),name=text(),owner=text('ID del dueño, o ninguno.'),state=text(),referencePrompt=reference)
    state=obj(characters=rows(obj(id=text(),position=text(),pose=text(),physicalState=text(),costumeId=text())),
        props=rows(obj(id=text(),position=text(),state=text())),space=text('Distribución y estado del lugar en este instante.'))
    cameraPoint={'type':'ARRAY','items':{'type':'NUMBER'},'minItems':3,'maxItems':3,
        'description':'[zoom, centroX, centroY]; zoom entre 1 y 2, centros entre 0 y 1.'}
    shot=obj(id=text(),beatId=text(),function=text(),frames=number(minimum=1),
        minFrames=number(minimum=1),maxFrames=number(minimum=1),timingReason=text(),
        leadFrames=number(),tailFrames=number(),treatment={'type':'STRING','enum':['hold','camera2d','localized','veo']},
        prompt=text(),locationId=text(),visibleCharacters=strings(),offscreenCharacters=strings(),props=strings(),
        before=state,after=state,referenceEntityIds=strings(),camera=obj(start=cameraPoint,end=cameraPoint))
    for field in ('frames','minFrames','maxFrames','leadFrames','tailFrames'):
        shot['properties'][field]['description']='FOTOGRAMAS a 24 FPS, no segundos: 8 s = 192; 12 s = 288. frames incluye toda la acción, voz y pausas de esta toma.'
    shot['properties']['maxFrames']['description']+=' Si treatment es veo, máximo absoluto 192 incluso para el margen de ajuste.'
    shot['properties']['treatment']['description']='Elige por la acción: hold/camera2d para encuadre o contemplación; localized para movimiento puntual; veo cuando sea necesaria acción física continua. Una duración breve no exige video. Si veo, frames/minFrames/maxFrames no superan 192.'
    return obj(title=text(),bible=obj(dramatic=text(),visual=text(),characters=rows(character,1),
        locations=rows(location,1),props=rows(prop)),
        beats=rows(obj(id=text(),change=text(),visible=text(),audible=text(),intention=text(),emotion=text(),
            minFrames=number(),preferredFrames=number(),maxFrames=number()),1),
        shots=rows(shot,1),utterances=rows(obj(id=text(),shotId=text(),speakerId=text(),
            type={'type':'STRING','enum':['dialogue','thought','narration','system']},spanish=text(),japanese=text(),
            acting=text(),pauseBeforeFrames=number(),pauseAfterFrames=number())),
        soundRequests=rows(obj(id=text(),name=text(),description=text(),prompt=text(),
            seconds=number('NUMBER',0,600),preparationSeconds=number('NUMBER',0,600),tailSeconds=number('NUMBER',0,600),
            perspective=text(),shotId=text(),eventDescription=text(),required={'type':'BOOLEAN'})),
        musicRequests=rows(obj(id=text(),prompt=text(),seconds=number(minimum=1,maximum=184),
            startFrame=number(maximum=7559),endFrame=number(minimum=1),sourceInSample=number(maximum=15120000),
            gainDb=number('NUMBER',-60,12),fadeInSamples=number(maximum=15120000),fadeOutSamples=number(maximum=15120000))),
        subtitles=rows(obj(utteranceId=text(),text=text())))
