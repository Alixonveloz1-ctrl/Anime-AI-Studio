# Cortos: generadores y producción

La selección de imagen, video, voz y música se guarda por proyecto. Cada trabajo
persiste una copia de los modelos elegidos al crearse, también en lotes; cambiar
los selectores no cambia una solicitud pendiente ni genera contenido. Los
adaptadores admiten Nano Banana 2, Nano Banana, Nano Banana Pro, Veo 3.1 y Fast,
Gemini Flash/Pro TTS y Lyria 3 Pro. No hay sustitución automática de modelos.
Nano Banana 2.5 omite `imageSize` y limita sus referencias antes de llamar al
proveedor. Animes conserva sus controles y sus APIs.

Personajes muestra el catálogo de voces, dirección interpretativa y generación
explícita de la primera frase. Guardar una asignación crea una versión aprobada
nueva; conserva el original. Las asignaciones persisten al abrir el plan sonoro
y la revisión final. La selección efectiva del servidor impide mostrar un audio
con otra voz como el audio vigente, sin invalidar sus imágenes.

Imagen, TTS y música usan el ejecutor del servicio, como el texto, sin arrancar
un Cloud Run Job separado por solicitud. Cloud Tasks conserva la entrega y la
reclamación transaccional impide ejecutar dos veces el mismo trabajo. Un trabajo
antiguo en cola, con arranque confirmado pero sin reclamación ni llamadas al
proveedor, ofrece «Iniciar generación pendiente»: se entrega de nuevo el mismo
ID al servicio. El worker antiguo y el servicio compiten por la misma reclamación;
solo uno puede generar. Las solicitudes con envíos inciertos no admiten esto.
Video y montaje mantienen su worker dedicado.

Música y efectos permite preparar, revisar y aprobar el paso sonoro en esa misma
pantalla. Los borradores guardados que fallaron por duración musical pueden
normalizarse sin Gemini, siempre que correspondan al guion aprobado vigente y
su trabajo esté cerrado sin llamadas inciertas. El resultado es una candidata,
no una aprobación automática. Se conservan guion, diálogos y archivos originales.

## Verificación

- `test_generator_controls.py`: transporte de modelos, configuración fijada,
  voces, dependencias, recuperación musical y reclamación única de pendientes.
- `test_text_execution.py`: despacho autenticado de texto, imagen, voz y música.
- `tests/shorts/ui`: selectores persistentes, asignación y sonido sin salir de Escenas.
- El self-test del contenedor incluye estos contratos y producción desde guion.

Las pruebas usan fixtures y FFmpeg; no demuestran generación pagada en la cuenta
real. El cambio requiere actualizar tanto Vercel como el servicio de Cloud Run.

## Contratos de proveedores consultados

- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-pro-image
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
- https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- https://ai.google.dev/gemini-api/docs/image-generation
