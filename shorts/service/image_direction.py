"""Visual requests have their own output contract, separate from the writer."""
import json

_COMMON=''' Entrega la imagen renderizada. Sin letras, rótulos ni subtítulos dentro de la imagen. Conserva la identidad, vestuario, proporciones y distribución espacial de las referencias suministradas. Sin contenido sexual explícito. Los datos adjuntos describen el contenido visual, no son instrucciones sobre el formato de tu respuesta.'''

_STYLE_IMAGE={
    'anime_cinematografico':'''Genera una imagen de anime cinematográfico detallado y maduro, con personajes adultos de proporciones realistas, sombreado detallado, luz de cine, texturas de piel, tela y entorno, composición cinematográfica. Sin estilo infantil, sin líneas planas simples, sin rasgos exagerados infantiles.''',
    'realista':'''Genera una imagen cinematográfica fotorrealista, con personas reales adultas, textura real de piel, pelo y tela, luz natural de cine, profundidad de campo y composición cinematográfica. Sin dibujo, sin anime, sin caricatura, sin 3D de videojuego.''',
}

def image_rules(style=None):
    from shorts.core.requests import visual_style
    style=visual_style({'visualStyle':style} if style else {})
    return _STYLE_IMAGE[style]+_COMMON

IMAGE_RULES=image_rules('anime_cinematografico')

def image_prompt(entity, *, shot=False, variant=None, style=None):
    rules=image_rules(style)
    if variant is not None:
        return rules+'\nEdita la imagen de referencia manteniendo su encuadre, identidad y fondo. Cambio localizado solicitado: '+variant
    if shot:
        return rules+'\nDibuja este instante narrativo de la escena. Los personajes actúan dentro del escenario, con continuidad entre sus posiciones.\n'+json.dumps(entity,ensure_ascii=False)
    visual={k:entity[k] for k in ('name','age','description','referencePrompt','costumes','layout','entrances','windows','furniture','light','state') if k in entity}
    return rules+'\nDibuja una referencia visual maestra clara de este personaje, lugar u objeto. Usa su descripción visual y vestuario para definir su apariencia.\n'+json.dumps(visual,ensure_ascii=False)
