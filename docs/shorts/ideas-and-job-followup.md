# Ideas breves y trabajos que parecen detenidos

Base inspeccionada: `787b5e17176f1dfcae8c1cea9108d823f8e84b52`, rama main, árbol inicialmente limpio. No se modifican archivos, generadores ni datos de Animes.

## Diagnóstico del incidente real

Lectura de la consola Firebase autenticada del propietario, sin editar sus datos:

- Proyecto GCP: `civic-genre-507713-m2`; base: `anime-shorts-preview`.
- Proyecto Cortos: `77f1156453cd44af83120ae6679ffabb`, título «Corto sin título», vida cotidiana y los seis subgéneros de la captura.
- Trabajo: `40e9a00e65a043c2ea301a3c5c43eaa2c753431407611d73e0dae1dbd63bf5f0`.
- Creado: epoch `1790223599.2534292`; despacho registrado `1790223599.6635747`; inicio del worker `1790223808.5646658` (209 segundos después de crear).
- Dos llamadas de texto del servicio antiguo registradas como `completed`; finalizan en `1790223849.048502` y `1790223860.1935716`. Resultado `awaiting_review`, `settled:true`, tres IDs de ideas. No hay 429 registrado en este trabajo.
- Las tres entidades existen en la colección `ideas` del mismo proyecto. No hace falta volver a generarlas.
- La web anterior consultaba 60 veces cada tres segundos y dejaba el banner congelado; a los tres minutos el worker todavía no había arrancado. El resultado se guardó unos 261 segundos después de la solicitud, fuera de esa ventana.
- El slot `text-analysis` está libre (`jobId:null`). La ocupación de capacidad y expiración de sesión son problemas adicionales reproducibles del código, **no la causa atribuida a este incidente**.
- Worker observado: `anime-shorts-preview-3595b579df`, ejecución `anime-shorts-preview-3595b579df-gvqkh`. Leer un resultado antiguo no acredita el contrato nuevo ni los demás modelos.

## Cambios

| Requisito | Archivos | Prueba | Estado |
|---|---|---|---|
| U011 / A013–A014: tres títulos/conceptos, una llamada; desarrollar solo elegida | `shorts/service/director.py`, `production.py`, `providers.py`, `shorts/core/contracts.py`, `requests.py` | `test_ideas.py`, flujo real de `studio.test.mjs` con transporte sintético | Fixtures aprobados; servicio nuevo pendiente de instalar/probar con Google |
| A072 / A074–A075: espera larga, reentrada y errores visibles | `cortos/studio.mjs`, `presentation.mjs`, `style.css` | Espera superior a tres minutos, ventana máxima, 429, reentrada sin segunda generación | Fixtures aprobados; se conservan ID y datos reales |
| A074–A078: cola, sesión, capacidad, envío incierto | `shorts/service/cloud.py`, `app.py`, `shorts/core/dispatch.py` | `test_job_recovery.py` | Fixtures aprobados; no se liberan envíos inciertos por antigüedad |
| A092: comprobar el arranque completo antes de activar | `worker/montage-shorts/runner.py`, `shorts/service/app.py` | Prueba autenticada de cola → servicio → Run jobs:run → worker sin modelos; contratos con fixtures | Código incluido en instalador; ejecución cloud pendiente |
| A003 / A006 / A008: regresión Animes | Archivos de Animes sin cambios en este arreglo | `legacy-regression.cjs`, `static-check.mjs`, suites de acceso y recuperación | Pasan; recuperación real del proyecto antiguo sigue pendiente |

El seguimiento consulta el mismo trabajo durante hasta doce minutos, con espera/arranque/modelo diferenciados. Si no termina, deja comprobación manual y cancelación accesibles y no afirma que el trabajo siga avanzando. Esperar o consultar no genera llamadas a modelos. Abrir el proyecto recupera los resultados existentes. La clave idempotente y los bloqueos por envíos inciertos siguen vigentes.

Los errores de creación de tareas se registran sin credenciales ni textos. Una entrega con sesión pausada o capacidad ocupada conserva un motivo visible y requiere Continuar explícito; el mensaje de la cola termina sin reintentar modelos. Solo un slot de trabajo cerrado se libera automáticamente. La respuesta de arranque sin identificador queda incierta, sin segundo despacho.

La prueba del instalador comprueba también `jobs:run` con overrides y el arranque de la versión exacta; antes solo comprobaba la entrega de la cola al servicio. El worker de prueba escribe un acuse en un documento temporal y no ejecuta `run_job`, proveedores ni proyectos de usuario. Espera hasta diez minutos, informando cada veinte segundos. El instalador existente solo activa después del éxito y conserva/restaura la revisión anterior si falla.

## Verificación y límites

- Baseline JavaScript de las áreas afectadas: 22 pruebas aprobadas antes de editar.
- Primera ejecución Python: 127 pruebas; 7 errores y 5 omitidas porque el intérprete carecía de Flask. Se creó un entorno con **todas** las dependencias fijadas de `worker/montage-shorts/requirements.txt`; no se borraron pruebas ni se alteraron versiones.
- Suite Python completa tras instalar dependencias: 142 pruebas aprobadas, ninguna omitida. Incluye FFmpeg con medios sintéticos y contratos de API con transporte simulado.
- Suite web, acceso, recuperación, gateway e interfaz: 67 pruebas aprobadas. El caso de arranque posterior a tres minutos devuelve las tres ideas sin segundo POST.
- El archivo `vercel-cli-contract.mjs` requiere un directorio de CLI como argumento; no pertenece a `node --test`. La invocación inicial sin argumento fue un error de invocación. Después se ejecutó correctamente con vercel@59.25.4 instalado: los cinco cuerpos del conector pasan como application/json en loopback. No se modificó el conector ni se hicieron llamadas autenticadas para esa prueba.
- Sin generaciones pagadas nuevas durante este arreglo. Se inspeccionó el trabajo real ya solicitado por el propietario. Los nuevos textos, latencia y calidad del modelo requieren su prueba posterior a la actualización del servicio.
- Sin acceso operativo a Cloud Shell/Cloud Run desde este navegador: muestran Site Unavailable. Firebase sí permite leer el estado existente. No se afirma que la actualización del worker esté desplegada por publicar main en Vercel.
- El proyecto antiguo de Animes es un incidente independiente pendiente de recuperación verificada.

## Activación desde iPhone

La web se publica con main en Vercel. Para ver las tres ideas ya guardadas basta recargar y abrir el mismo corto; no pulsar Generar otras tres para recuperarlas.

El contrato breve para **futuras** ideas y las mejoras del servicio exigen actualizar Cortos con el instalador `./c` (respaldo `bash c`). Si el menú pertenece a una copia anterior, opción 6 para buscar main, luego opción 1 para instalar/actualizar. Elegir `civic-genre-507713-m2` y confirmar la cuenta `codigodinero7@gmail.com`. No editar claves, JSON, buckets ni variables. El menú 5 únicamente conecta Vercel; no instala este cambio del worker. La prueba de arranque y el rollback son parte de la actualización. Los instaladores de Animes `i` y `setup.sh` permanecen intactos.

## Documentación oficial revisada

- [Cloud Run jobs.run y overrides](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run): requiere `run.jobs.runWithOverrides`, ya incluido por el instalador.
- [Cloud Tasks Queue RetryConfig](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues): los reintentos de entrega no acreditan ejecución de un modelo.
- [GenerationConfig](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/GenerationConfig) y [GenerateContentResponse](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse): límite de salida y motivo `MAX_TOKENS`. Contratos mediante fixtures; ningún cambio de modelo ni fallback.
