# Criterios de aceptación · Long-form Story Engine

Esta lista define cuándo la rama puede considerarse lista para `main`.
No reemplaza una prueba creativa real con Google Cloud; separa claramente lo que
puede comprobar CI de lo que debe escucharse/verse en una muestra.

## Automático en GitHub Actions

- `index.html` y todos los endpoints JavaScript parsean.
- `setup.sh` y `worker/montage/runner.sh` pasan `bash -n`.
- `buildMontarScript()` genera un shell válido.
- Existe formato de 60 y 90 minutos.
- Existen modos Narrado y Dramatizado.
- Existe perfil Motion anime.
- Anime japonés 2D es el estilo por defecto.
- Ningún error de referencia vuelve a generar silenciosamente sin identidad.
- Las historias largas guardan borrador y pueden reanudarse.
- Los proyectos anteriores conservan su número real de escenas.
- El servidor de imagen no fuerza fan service genérico en cada fotograma.

## Prueba creativa mínima tras desplegar

Antes de producir una hora completa, generar **una sola prueba de 5–8 minutos**
con el mismo motor:

### Narrada
- Gancho comprensible en 60–90 s.
- Sinopsis/universo conservados; el desarrollo no se convierte en tesis.
- Cada solución produce una consecuencia o necesidad nueva.
- Revelaciones tienen reacción antes de cambiar de asunto.
- Una sola voz se mantiene estable.
- La narración no describe por duplicado lo que ya está en pantalla.

### Dramatizada
- Cada personaje recurrente conserva su voz.
- Pensamientos usan la voz de su personaje.
- Narrador aparece sólo donde aporta contexto útil.
- Las intervenciones tienen pequeñas pausas naturales.
- No se mezclan speakerId entre personajes.

### Imagen
- Una sola referencia limpia por personaje.
- Rostro/proporciones se mantienen entre escenas.
- Vestuario puede cambiar por escena sin cambiar identidad.
- Resultado parece fotograma de anime japonés 2D: línea dibujada, cel-shading,
  piel mate y cabello por masas; no CGI, videojuego, donghua/manhua ni retrato semirrealista.
- Conversaciones largas usan cobertura (hablante/reacción/conjunto/detalle), no
  una sola ilustración inmóvil durante decenas de segundos.

### Movimiento y montaje
- Perfil Motion anime genera Veo sólo para acciones marcadas `action`.
- Planos still/limited se montan con cortes, zooms/paneos discretos.
- No hay órbitas 3D ni movimiento de cámara de videojuego.
- El MP4 mantiene exactamente la duración del audio.
- Música no tapa la voz.
- Cortes normales no intentan interpolar entre ángulos incompatibles.

### iPhone / recuperación
- Generación de referencias maestras disponible en un solo botón.
- "Todas las imágenes" se niega a empezar si falta una referencia.
- Si la página se recarga durante una historia larga, al volver a pulsar Generar
  continúa desde los bloques guardados.
- Imágenes/audio/video ya terminados se omiten al reanudar sus lotes.

## Prueba final de una hora

Sólo después de aprobar la muestra corta:

1. Generar historia completa de ~60 min.
2. Confirmar que el conflicto central llega a un cierre cuando se eligió
   `Historia completa`.
3. Confirmar reparto, referencias y escenarios.
4. Generar imágenes.
5. Generar audio.
6. Generar sólo clips Veo necesarios en Motion anime.
7. Montar MP4.
8. Revisar inicio, 25 %, 50 %, 75 % y final antes de publicar.

## Google Cloud nuevo

La infraestructura se instala al final, en Cloud Shell:

```bash
bash setup.sh
```

El instalador prepara APIs, bucket, cuenta de servicio, Artifact Registry y el
Cloud Run Job de montaje. No se ejecuta desde CI porque requiere el proyecto real
y puede generar recursos facturables.
