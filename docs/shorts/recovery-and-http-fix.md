# Incidente de lectura — 2026-09-24

Base inspeccionada y probada: `15118491524fe832a173b43062682ebf3f344f2c` (main, árbol limpio). La suite previa de 36 pruebas pasaba, pero no cubría la precondición HTTP de Vercel ni el archivo real del propietario.

## Evidencia real

Vercel, 03:26–03:29 UTC, proyecto `p1789929671378`: `projectGet` responde 200 y registra universo presente, cero personajes, episodio 1 con cero escenas. El propietario confirma que había escenas e imágenes. Esto acredita que la copia leída está incompleta; no acredita eliminación de los archivos, ni permite atribuir cuándo se perdió el contenido de ese JSON.

Cortos: tres POST de creación devuelven 201, cada uno seguido de un GET rechazado con 412. El frontend mandaba `If-Match` incluso en GET. Se reprodujo el rechazo con una respuesta HTTP 412 vacía: el cliente fallaba al interpretar JSON, antes de poder mostrar Historia. No se llamaron modelos en estas verificaciones.

## Corrección

- Cortos envía la revisión de aplicación mediante `X-Shorts-Revision` solo en escrituras. El gateway la traduce al `If-Match` que espera el worker existente. Las lecturas no llevan precondiciones. Se conservan autenticación, revisión esperada e idempotencia. Un cuerpo no JSON produce un mensaje legible, sin repetir la operación.
- Animes conserva una copia local más completa antes de actualizar la caché con un JSON incompleto. Se mantiene fuera de la limpieza de cachés y no se restaura silenciosamente.
- Cuando la copia de Animes no contiene escenas, la página consulta versiones, copias retenidas y archivos del mismo proyecto. El aviso distingue imágenes existentes de guion recuperado. No inventa escenas a partir de imágenes ni anuncia recuperación completa.
- Recuperación bajo la autenticación de propietario existente: selección explícita de una copia, respaldo previo obligatorio, condición de generación del objeto para evitar pisar una edición concurrente. Las copias retenidas por soft delete se identifican como no leídas hasta restaurarlas. Si la copia restaurada es inválida, se revierte solo esa generación.
- Cada guardado de metadata conserva previamente un respaldo por hash del JSON anterior. Un error de respaldo aborta el guardado. Una lectura antigua nula se comprueba para distinguir un 404 de un error de permisos. Los medios, modelos y ensambladores no cambian.

Las consultas se limitan al ID y prefijo del proyecto, tienen tiempo acotado y paginación limitada explícitamente. La inspección registra solo recuentos y fallos de acceso; no guiones, URLs firmadas ni credenciales. Las búsquedas incompletas muestran advertencias, no ausencia definitiva de copias.

## Verificación y límites

**54 pruebas JavaScript correctas**, más regresión heredada, validación estática e integridad A001–A100. Pruebas de fixtures: rechazo 412 antes del cambio; flujo de ideas/guion después del cambio; traducción de revisión al worker; errores no JSON; acceso privado; lectura paginada de versiones; recuperación con respaldo; rechazo por edición concurrente; backup fallido; soft delete y rollback condicional; preservación de la copia del teléfono; navegación con respuestas tardías; envío de la copia seleccionada desde el diálogo. La regresión heredada sigue comprobando todos los generadores, preferencias, instaladores, worker y CSS original. Sus excepciones nuevas están acotadas al bloque de recuperación y al respaldo de metadata.

**Pendiente real:** leer/restaurar y exportar el proyecto concreto del propietario; una generación de ideas con la API real y autorización de gasto. El navegador de trabajo no tiene sesión de la aplicación y la consola de Google Cloud/Cloud Shell devuelve Site Unavailable. No se ha sorteado la autenticación. La búsqueda de copias se ejecutará con la sesión normal del propietario al abrir el proyecto. No requiere reinstalar el ensamblador.

Referencias oficiales verificadas:
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/restore
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
- https://www.rfc-editor.org/info/rfc7232/
