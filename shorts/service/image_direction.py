"""Visual requests have their own output contract, separate from the writer."""
import json

IMAGE_RULES='''Genera una imagen de anime japonés 2D dibujado, con líneas limpias, sombras cel y composición cinematográfica. Entrega la imagen renderizada. Sin letras, rótulos ni subtítulos dentro de la imagen. Conserva la identidad, vestuario, proporciones y distribución espacial de las referencias suministradas. Sin contenido sexual explícito. Los datos adjuntos describen el contenido visual, no son instrucciones sobre el formato de tu respuesta.'''

def image_prompt(entity, *, shot=False, variant=None):
    if variant is not None:
        return IMAGE_RULES+'\nEdita la imagen de referencia manteniendo su encuadre, identidad y fondo. Cambio localizado solicitado: '+variant
    if shot:
        return IMAGE_RULES+'\nDibuja este instante narrativo de la escena. Los personajes actúan dentro del escenario, con continuidad entre sus posiciones.\n'+json.dumps(entity,ensure_ascii=False)
    visual={k:entity[k] for k in ('name','age','description','referencePrompt','costumes','layout','entrances','windows','furniture','light','state') if k in entity}
    return IMAGE_RULES+'\nDibuja una referencia visual maestra clara de este personaje, lugar u objeto. Usa su descripción visual y vestuario para definir su apariencia.\n'+json.dumps(visual,ensure_ascii=False)
