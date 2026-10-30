"""Visual requests have their own output contract, separate from the writer."""
import json

_COMMON=''' Entrega la imagen renderizada. Sin letras, rótulos ni subtítulos dentro de la imagen. Conserva la identidad, vestuario, proporciones y distribución espacial de las referencias suministradas. Sin contenido sexual explícito. Orientación obligatoria: imagen derecha, cielo arriba, suelo abajo, todo derecho, no girada, no de lado, no al revés, no boca abajo. Los datos adjuntos describen el contenido visual, no son instrucciones sobre el formato de tu respuesta.'''

# 2026-10-29, a petición del usuario: orientación derecha en TODOS los
# prompts de imagen, desde el principio, porque Aldea Nocturna y Jardín de
# Kaito salieron girados 90 grados (cielo a la derecha, suelo a la izquierda).
_STYLE_IMAGE={
    'anime_cinematografico':'''Genera una imagen de anime cinematográfico detallado y maduro, con personajes adultos de proporciones realistas, sombreado detallado, luz de cine, texturas de piel, tela y entorno, composición cinematográfica. Sin estilo infantil, sin líneas planas simples, sin rasgos exagerados infantiles.''',
    'realista':'''Genera una imagen cinematográfica fotorrealista, con personajes ficticios adultos de aspecto realista, textura real de piel, pelo y tela, luz natural de cine, profundidad de campo y composición cinematográfica. Son personajes ficticios de una historia ficticia, no personas reales. Sin dibujo, sin anime, sin caricatura, sin 3D de videojuego.''',
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
        return rules+'\nDibuja este instante narrativo de la escena. Los personajes actúan dentro del escenario, con continuidad entre sus posiciones.\nREGLA DE CUERPO PARCIAL: aunque en esta toma solo se vea una parte de un personaje (piernas, pies, espalda, manos), esa parte DEBE ser exactamente la de ese personaje de referencia: mismo vestuario, mismos colores, mismas botas o calzado, sin inventar otro personaje ni otra ropa. Nunca dibujes partes sueltas, flotantes o invisibles: las botas siempre van unidas a piernas, las piernas siempre van unidas al cuerpo aunque el cuerpo quede fuera de cuadro, las manos siempre van unidas a brazos. Si la parte visible no coincide con la referencia, la imagen no sirve.\n'+json.dumps(entity,ensure_ascii=False)
    visual={k:entity[k] for k in ('name','age','description','referencePrompt','costumes','layout','entrances','windows','furniture','light','state') if k in entity}
    # 2026-10-29, a petición del usuario: NO hay vestuario obligatorio
    # añadido por detrás. El usuario edita el vestuario dentro del prompt
    # completo, con el botón de editar prompt, y ese prompt guardado es
    # el que manda. Aquí solo queda la regla de cuerpo completo.
    return rules+'\nDibuja una referencia visual maestra clara de este personaje, lugar u objeto. Usa su descripción visual y vestuario para definir su apariencia. Si es un personaje, muestra su cuerpo completo, de la cabeza a los pies, con todo el vestuario visible, incluyendo piernas, pies y calzado, sin cortar por las rodillas ni por la cintura, para que después se pueda dibujar cualquier parte de su cuerpo con esa misma ropa.\n'+json.dumps(visual,ensure_ascii=False)
