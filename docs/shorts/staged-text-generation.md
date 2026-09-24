# Generación de texto encadenada — 2026-09-24

Referencia leída: api/script.js (Vertex global, JSON, thinkingLevel LOW) e
index.html (generación encadenada y guardado parcial). No se modifican Animes,
sus llamadas, datos ni diseño.

Cortos ahora entrega tres respuestas separadas, seguidas por revisión:
1. Historia, biblias y beats (12288 tokens máximos).
2. Planos, guion y actuación japonés/español (24576).
3. Solicitudes de SFX, música y subtítulos (12288).
4. Revisión de continuidad.

Cada etapa recibe el contexto anterior y el contrato completo de producción.
Su esquema es una partición del esquema original; el documento unido pasa el
mismo validador de 7200 frames, IDs, voces, silencios, cámaras, Veo y música.
El resultado anterior aprobado nunca se sustituye automáticamente. Se conservan
respuestas y datos parciales en developmentDrafts antes de continuar. Esta
versión conserva los borradores para diagnóstico; no ofrece aún reanudación
selectiva de una etapa fallida. No se afirma lo contrario.

Ideas, desarrollo y revisiones se ejecutan en el servicio desde la entrega
HTTP autenticada de Cloud Tasks. Se elimina para estas tareas el arranque de
un Cloud Run Job separado. Capacidad y claim transaccional siguen evitando
duplicados. Los trabajos de medios mantienen su ejecución anterior. La sesión
se comprueba antes de cada llamada; cerrar la página sigue pausando llamadas
futuras. El servicio usa threads para atender lectura/heartbeat durante la
solicitud. Cola y servicio admiten 1800 segundos para las llamadas acotadas.

No se reintenta un 429 ni una respuesta incierta. Se conserva estado incierto
si el proceso se interrumpe tras aceptar trabajo; no se infiere éxito. El
historial anterior de Cloud Run no se altera. La interfaz muestra etapa actual.

Referencias oficiales:
https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
https://docs.cloud.google.com/run/docs/configuring/request-timeout

Validación local con proveedores simulados y regresión de Animes. Requiere
instalar la nueva imagen y verificar Gemini real. No se han generado voces,
imágenes, música ni video como prueba de esta revisión. Una prueba local no
certifica calidad del resultado ni funcionamiento de todas las APIs en GCP.
