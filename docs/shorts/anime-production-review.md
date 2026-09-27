# Revisión del recorrido de producción de Anime y Cortos

Fecha: 2026-09-27. Base revisada: f1fad9f.

## Alcance y evidencia

Revisión de código del recorrido de producción, no certificación de cada línea del repositorio ni prueba autenticada con Google. Se siguieron los controles y sus llamadas, persistencia y montaje.

| Recorrido de Anime | Código seguido | Aplicación a Cortos |
|---|---|---|
| Historia y escenas | index.html: generación de universo, episodios, borradores y renderScenes; api/script.js | Las etapas aprobadas conservan contexto. La producción necesita un guion completo, pero no necesita esperar a crear música. |
| Referencias e imágenes | index.html: renderCharacters, referencias de escenario, generateSceneImageAB; api/image.js | Referencias aprobadas y botones por toma. Las descripciones técnicas quedan opcionales. |
| Video | index.html: generateSceneVideo; api/video-start.js y video-status.js | Imagen previa y operación guardada. Cortos conserva sus límites nativos y no adopta el retiming del montaje narrado. |
| Voces | index.html: selección por personaje, generateAudio y generación por escena; api/audio.js y voices.js | Voz japonesa por intervención, reproducción y otra interpretación visibles. |
| Música | index.html: directMusic, renderMusic y generación; api/music.js | Separar planificación escrita de archivos reproducibles. Generación y revisión por pieza. |
| Guardado | index.html: dbSet/dbGet, cloudSaveProject/cloudLoadProject; api/upload-url.js y download-url.js | Conservar recursos y selecciones al continuar el desarrollo. |
| Montaje y subtítulos | index.html: buildMontarScript, buildEpisodeSrt, exportación; api/assemble.js, transcribe.js; worker/montage/runner.sh | Cortos mantiene pausas y acciones, voces japonesas y traducción española; no copia la duración basada principalmente en narración de Anime. |
| Acceso | autenticación, middleware, configuración Vercel y gateway de Cortos | No mezclar las credenciales ni sustituir los trabajos persistentes por llamadas largas del navegador. |

## Bloqueo corregido

Cortos exigía terminar las cuatro etapas editoriales para obtener activeDevelopment. Por eso existían controles de medios pero el proyecto quedaba antes de ellos.

Ahora una acción explícita abre producción desde el paso 2 o 3 completo y aprobado. No llama a Gemini. El servicio vuelve a validar el guion y crea una versión estable, reutilizable al repetir la solicitud. Los proyectos anteriores con ese borrador aprobado también pueden utilizarla.

El marcador editorialStage mantiene pendiente la exportación final hasta completar el plan de sonido y la revisión. Se conserva al crear versiones derivadas. La generación y revisión de medios continúa por toma; los recursos compatibles se reutilizan mediante sus fingerprints. Abrir producción no crea música ni efectos ficticios.

## Verificación

- 28 pruebas de interfaz: incluye abrir producción antes del plan sonoro, generar una voz y continuar hasta revisión sin borrar el recurso.
- 53 pruebas Python de entrada de producción, desarrollo manual, dependencias, revisiones y contratos.
- Los proveedores de las pruebas están simulados. No se hicieron generaciones reales ni se verificaron cuotas de la cuenta.
- El cambio del servicio requiere actualizar Cortos en Google Cloud. Publicar el frontend por sí solo no instala la ruta nueva.

## Límites de esta entrega

No garantiza disponibilidad de cuota ni certifica un MP4 real. Las variantes de edición del desarrollo y el borrador editorial son versiones independientes; continuar la preparación usa el borrador aprobado. El video por toma sigue el tratamiento definido por el guion. Las pruebas automatizadas no sustituyen revisar imagen, voz y montaje reales en la cuenta instalada.
