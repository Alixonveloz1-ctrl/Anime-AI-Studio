# Comparación de generación con los proyectos de referencia

Revisión del 27 de septiembre de 2026. Los proyectos de referencia se consultaron sin modificarlos. No se trasladaron personajes, historias, credenciales, configuración de cuentas ni estilos de esos proyectos a Cortos.

## Alcance y evidencia

| Repositorio | Commit consultado | Archivos inventariados | Archivos con sintaxis comprobada |
| --- | --- | ---: | ---: |
| studio.LegadodeHierro | 5eeb18b9821a635bc9c48cdd93bb51d61eb01555 | 98 | 78 |
| LA-MIRADA-QUE-EL-MUNDO-TEMERA | ff6b3af905233a5281b7c46000c4b27e3069a6f5 | 117 | 82 |
| Prisma-Negro | 610e56db392f58050fb8d4c0c5d27e24369d0ba5 | 64 | 55 |

Se inventariaron y calcularon hashes de los 279 archivos versionados; se analizaron todos los JSON y se comprobó la sintaxis de JavaScript, Python y shell, sin ejecutar instaladores. El índice adjunto permite comprobar exactamente las versiones examinadas. Esto no equivale a una auditoría semántica línea por línea de todos los archivos ni a ejecutar estos proyectos en producción. La lectura detallada se concentró en los adaptadores de generación y en el seguimiento de sus rutas de interfaz, estado, almacenamiento y montaje.

## Recorridos contrastados

| Área | Legado | Mirada | Prisma | Aplicación en Cortos |
| --- | --- | --- | --- | --- |
| Imagen | `public/app.js` → `server/image.js` → Vertex → GCS y biblioteca | `app/cola.js` → `api/_lib/modos.js` → `imagen.js` → GCS y estado | `app/fases/imagen.js` → `api/ia.js` → `proveedor.js` → almacén | Separar el encargo visual del guion; conservar referencias aprobadas y nombrar su función junto a cada archivo. |
| Video | `video-start.js` y `video-status.js`; operación persistida en el estudio | `veo.js` separa lanzar/consultar; estado conserva la operación | `videoIniciar`/`videoConsultar`; operación conserva modelo y región | Conservar ID y modelo fijado en el trabajo; un fallo de consulta no es un envío incierto. |
| Voz | `_voice.js`, `_chirp.js`, `_eleven.js`; fragmentos guardados por trabajo | `audio.js`: reparto por personaje, bloques japoneses, PCM convertido a WAV | `proveedor.js`, `fases/narracion.js`, `comun/audio.mjs`: voz, guardado, duración medida | La voz asignada llega al proveedor; validar audioContent antes de decodificar; medir el WAV antes del montaje. |
| Música | `music-gen.js`: Lyria 3 generateContent, clasificación del formato recibido | `audio.js`: Lyria 3 generateContent, duración real y formato | Lyria 2 predict; pista de fondo que puede repetirse | Mantener el contrato propio de Lyria 3 Interactions; admitir los dos nombres MIME de MP3. No copiar el bucle musical de Prisma. |
| Persistencia | `_store.js`, `_jobs.js`: escritura condicional, biblioteca y checkpoints | `gcs.js`, `estado.js`, `modos.js`: archivo y estado separados | `almacen.js`, `api.js`: guardado confirmado, recuperación y descarga por trozos | Los medios de Cortos siguen en GCS; el navegador recibe metadatos y una URL autorizada, no el original en base64 a través de Vercel. |
| Montaje | `cloudrun/unify`: duración de audio, ajuste de planos, FFmpeg | `montador/montador.mjs`: manifiesto, capas, mezcla y subtítulos | `comun/hoja.mjs`, `api/_lib/montador.js`, `montador/montar.sh` | Mantener 24 fps/48 kHz y la duración medida de Cortos; no importar ajustes de velocidad ni repetición de otros proyectos. |

## Defectos corregidos a partir de esta comparación

1. **Consulta fallida confundida con generación enviada.** Un timeout/5xx de countTokens ahora termina como consulta fallida, sin bloquear una generación inexistente. Un fallo consultando una operación Veo conserva `waiting_provider` y su ID. El worker y la recuperación existente pueden volver a consultar sin `predictLongRunning` adicional. Los timeouts de generaciones pagadas siguen siendo inciertos y no se repiten.
2. **Respuesta recibida pero ilegible.** Un HTTP exitoso con JSON inválido se registra como respuesta completada e inutilizable, no como un envío desconocido que retiene el trabajo indefinidamente.
3. **Música MP3 válida rechazada.** Lyria acepta ahora `audio/mp3` además de `audio/mpeg`; ambas salidas pasan por la misma decodificación y medición real. La URL Interactions no se sustituyó por la de los ejemplos: es un contrato documentado por Google.
4. **Audio vacío o corrupto como excepción interna.** Voz y música comprueban presencia y base64 antes de procesar. La falta de archivo termina con un error explícito, sin otra llamada pagada.
5. **Referencias sin correspondencia explícita.** Cada imagen de referencia de una toma lleva el nombre, ID y tipo de personaje/lugar/objeto al lado del archivo; una variante identifica la imagen aprobada que se edita.
6. **Imagen WebP etiquetada como JPEG.** El archivo guardado conserva su extensión y MIME; los formatos no admitidos producen un error explícito.

El defecto anterior que reutilizaba «Devuelve solo JSON» en las imágenes ya se corrigió en `4b2b362`. La corrección de planificación musical (`plan_music`) ya deriva segundos desde los intervalos, divide piezas de más de 184 s y permite recuperar el borrador inválido sin pagar otra generación de guion. Es distinta del rechazo del formato del audio recibido. La validación contra la duración REAL del archivo permanece: pedir 30 s no garantiza recibir exactamente 30 s.

## Diferencias que no justifican copiar una implementación

Los ejemplos contienen comentarios que no coinciden con la documentación actual: que Gemini 2.5 solo acepta IMAGE, o que toda Lyria exige inglés. Se contrastaron las llamadas con documentación oficial, no se usaron esos comentarios como prueba. Tampoco se importaron reintentos automáticos de generaciones, sustitución silenciosa de modelos ni descarte de referencias para reducir el tamaño de petición.

- [Generación de imágenes con Gemini](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation): TEXT + IMAGE documentado; Cortos lo conserva.
- [Generación con Lyria](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/generate-music): endpoint Interactions y cuerpo input documentados.
- [Lyria 3](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3): audio/mp3 y modelos/regiones.
- [Gemini TTS](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts): Cloud Text-to-Speech con modelName, prompt, text y LINEAR16 es válido; no hace falta convertirlo a Vertex AUDIO solo para parecerse a otro proyecto.

## Verificación y límites

`test_provider_lifecycle.py` reproduce los fallos de preflight/consulta/respuesta, comprueba que no se repite una llamada pagada y recorre recepción → FFmpeg → onda → registro de recurso con WAV/MP3/WebP locales válidos. El transporte de Google y el almacén están simulados; estas pruebas no demuestran que la cuenta de producción haya generado imágenes o voces. Se incorpora esta suite al self-test obligatorio del contenedor.

Falta verificar una generación real en la cuenta de Cortos después de instalar la nueva versión de Cloud Run. No se declara éxito de producción por ver un selector, recibir HTTP 200 ni pasar pruebas locales. Para cerrarlo hacen falta un archivo de imagen visible, una voz japonesa reproducible con la voz elegida, una pieza musical reproducible y un video recuperado de su operación guardada.

Resultado local: las 22 suites del contenedor completaron 185 pruebas correctas. La primera ejecución local se detuvo por faltar el directorio del worker en PYTHONPATH; las suites restantes se ejecutaron con las mismas rutas que declara el Dockerfile. Los 215 archivos de referencia comprobados sintácticamente pasaron; sus servicios de producción no se ejecutaron. A las 23:21 UTC, /health de Cortos seguía sirviendo c53df0605e98e79c7f89636ab9333377c406d763; publicar main no actualiza por sí solo ese servicio de Cloud Run.
