# Criterios de aceptación · Anime AI Studio

Esta lista define cuándo una versión puede considerarse lista para producción.

## Automático en GitHub Actions

- `index.html` y todos los endpoints JavaScript parsean.
- `setup.sh` y `worker/montage/runner.sh` pasan `bash -n`.
- `buildMontarScript()` genera un shell válido.
- Existen formatos aproximados de 5, 8, 15, 30, 60 y 90 minutos.
- Sólo existen dos modos de historia seleccionables: **Narrada** y **Dramatizada**.
- No existe selector Motion Anime / Mixto / Animar todo.
- No existe botón de reparar escenas.
- Un episodio no se confirma si faltan escenas, texto, título o dirección visual.
- Un bloque de historia demasiado corto no se acepta como éxito.
- La división de escenas nunca rellena con escenas vacías.
- Vertex AI 429/RESOURCE_EXHAUSTED usa espera y reintento central.
- Los borradores de generación se guardan para cualquier duración.
- Referencias, imágenes, audio, música y videos ya terminados se omiten al continuar una tanda.
- Las operaciones de Veo iniciadas se guardan y pueden seguir consultándose después de una recarga.
- El director guarda una recomendación de video por plano, pero el usuario conserva el botón manual de video.
- Anime japonés 2D es el contrato visual predeterminado.
- Ningún error de referencia vuelve a generar silenciosamente sin identidad.
- Los proyectos anteriores conservan su número real de escenas.
- El servidor de imagen no fuerza fan service genérico en todos los fotogramas.
- El montador no usa el mismo clip dos veces consecutivas para rellenar tiempo.
- Los clips se retiman a la duración de su toma sin loop.
- Las imágenes fijas reciben movimientos de cámara visibles durante el montaje.
- `setup.sh` detecta la cuenta Google y el proyecto activos; no depende de un correo hardcodeado.

## Prueba creativa mínima

Antes de producir una hora completa, generar una prueba de 5–8 minutos con el mismo motor.

### Narrada

- La premisa y el universo aprobados se conservan.
- El desarrollo no se convierte en tesis ni resumen plano.
- Cada solución produce una consecuencia o una nueva necesidad.
- Las revelaciones reciben reacción antes de cambiar de asunto.
- Una sola voz conduce narración, pensamientos y diálogos.

### Dramatizada

- Cada personaje recurrente conserva su voz.
- Pensamientos usan la voz del personaje.
- El narrador aparece sólo cuando aporta contexto útil.
- Las intervenciones tienen pausas naturales.
- No se mezclan speakerId.

### Imagen

- Una sola referencia limpia por personaje.
- Rostro y proporciones se mantienen.
- El vestuario puede cambiar por escena sin cambiar identidad.
- El resultado se ve como anime japonés 2D: línea dibujada, cel-shading definido, piel mate.
- Conversaciones largas usan cobertura: hablante, reacción, conjunto o detalle según haga falta.

### Video y montaje

- El director recomienda qué planos animar.
- **Videos recomendados** genera sólo esos clips faltantes.
- Cada imagen conserva su botón 🎬 manual.
- Si el usuario generó un clip manual, el montaje lo usa aunque el director no lo hubiera recomendado.
- Un clip de 8 s puede ralentizarse para ocupar, por ejemplo, 12 s.
- Un clip nunca se repite inmediatamente detrás de sí mismo.
- Si no hay clip, la ilustración recibe zoom/paneo claramente visible.
- No hay órbitas 3D ni movimiento tipo videojuego.
- El MP4 mantiene la duración del audio.

### Recuperación

Probar en una historia corta y en una larga:

1. Interrumpir después de varios bloques de guion.
2. Continuar y verificar que no reescribe lo ya terminado.
3. Interrumpir una tanda de imágenes; continuar y verificar que omite las existentes.
4. Interrumpir audio; continuar y verificar que omite los existentes.
5. Iniciar Veo, recargar después de recibir operationName y verificar que se retoma esa operación.
6. Interrumpir música; continuar y verificar que las pistas existentes no se regeneran.

## Google Cloud nuevo

La infraestructura se instala al final.

Desde la cuenta Google nueva, abre Cloud Shell, selecciona el proyecto que vas a usar y ejecuta:

```bash
bash setup.sh
```

El script muestra la cuenta activa y el proyecto activo antes de crear recursos. El correo de inicio de sesión no se escribe en el código.

El instalador prepara APIs, bucket, cuenta de servicio, Artifact Registry y el Cloud Run Job `anime-studio-montage`. No se ejecuta desde CI porque crea recursos reales.
