# Decisiones del usuario posteriores a la especificación v2

Estas instrucciones explícitas de la conversación prevalecen sobre el documento original. El original se conserva completo en `contract-v2.txt`; no se reescribe su historia.

## U001 — eliminar por completo la función de costes

El usuario no pidió una pantalla de producción financiera y consulta su facturación directamente en Google Cloud. Solicita quitarla completamente, no esconderla.

Se eliminan precios, estimaciones, presupuestos, saldos, reservas monetarias, conciliaciones estimadas, vencimiento de tarifas, renovaciones y bloqueos por falta de saldo/tarifa. Las rutas antiguas de presupuestos responden 404. No se integra la factura de Google ni se afirma conocer un coste exacto por recurso.

A034 y A077 del documento original quedan sustituidos: el criterio vigente es ausencia de estas funciones, tanto en la interfaz como en el despacho. Las referencias a reservas/costes de otras secciones se interpretan según esta decisión. El permiso del instalador para crear recursos en una cuenta/proyecto sigue siendo necesario; muestra recursos y pide confirmación sin estimaciones monetarias. No se han autorizado generaciones pagadas ni infraestructura desde esta sesión de desarrollo.

Se conservan autenticación, propiedad, idempotencia, cancelación, concurrencia, alcance finito de la acción solicitada y protección frente a reenvíos desconocidos. Son controles de ejecución y seguridad, no presupuestos.

Código: `shorts/core/requests.py`, `jobs.py`, `recovery.py`, servicio, runner e instalador. `pricing.py` fue retirado. Las pruebas de precios se sustituyen por pruebas de eliminación y se conservan las comprobaciones de modelos, límites de entrada, duplicados, timeouts y recuperación en `test_requests.py`, `test_contracts.py`, `test_workflow.py` y `test_api.py`.

## U002 — simplificación funcional de la interfaz

Organización inicial (sustituida por U010): cinco áreas, Proyectos, Historia, Producción, Revisión y Exportar. Una acción principal por contexto, versiones anteriores y ajustes avanzados desplegables, separación entre tomas/voces y música/efectos. Las etiquetas muestran nombres y estados comprensibles. No se muestran JSON ni identificadores como instrucciones al usuario.

Una aprobación explícita sustituye las listas repetitivas de casillas. Preparar una preview o exportar ejecuta la compilación automáticamente. La revisión sigue ligada al material y al manifiesto exactos. El ajuste manual por fotogramas/onda, comparar, deshacer y fijar permanece accesible sin IA. No se eliminan capacidades para lograr una pantalla más sencilla.

## U003 — integrar main y publicar la página habitual

El usuario autoriza expresamente fusionar Cortos en `main`, desplegarlo en el proyecto Vercel existente y trabajar después directamente sobre `main`. Probará desde su página habitual. Esto sustituye la obligación anterior de mantener la entrega solo en una rama/preview (A086). No autoriza desde esta sesión generaciones pagadas ni creación de infraestructura GCP.

El instalador usa `main` y variables `SHORTS_*` de producción, conserva todas las variables de Animes y exige el proyecto Vercel ya vinculado a este repositorio. La web puede publicarse antes de conectar GCP: debe indicar honestamente que Cortos todavía no está conectado. Las previews que se creen siguen aisladas de la configuración de producción. Los nombres de recursos GCP anteriores se conservan por compatibilidad de datos; no implican otro producto ni otro despliegue Vercel.

## U004 — instalación desde un enlace en la conversación

El usuario rechaza expresamente cualquier botón de Cloud Shell o panel de instalación dentro de la aplicación. Se retiran por completo. El enlace se entrega en la conversación con repositorio y `main`, y con el correo de Google que el usuario indique para esa instalación. No se presupone una cuenta por antecedentes. Debe iniciar sesión con ese correo; el instalador muestra la cuenta activa y pide confirmar el proyecto antes de modificar recursos.

A087 y A093 se interpretan usando ese enlace de la conversación para abrir o recuperar Cloud Shell. Se conservan el comando real `./c` (respaldo `bash c`), el menú numérico, actualización, diagnóstico, rollback y estado en nube. Esta simplificación no elimina el instalador ni exige copiar scripts, claves o JSON.

## U005 — acceso privado a toda la aplicación

El usuario requiere que solo su cuenta pueda usar la aplicación completa: proteger únicamente Cortos deja las APIs de Animes capaces de gastar los mismos créditos. Se añade una entrada común con Google y comprobación del propietario en las doce APIs de Animes, además de la comprobación ya existente en Cloud Run para Cortos. Un inicio de sesión Google válido de otra persona no basta. Firebase/Firestore se conservan por decisión explícita del usuario.

Este cambio autoriza modificar el preámbulo de acceso de Animes; no sus modelos, peticiones a proveedores, proyectos, preferencias, montaje ni instalador. `STUDIO_ALLOWED_EMAILS` es la única variable compartida nueva que puede escribir el conector, usando la cuenta activa confirmada y cotejándola con la revisión instalada de Cortos. No modifica `GCP_SERVICE_ACCOUNT` ni `GCS_OUTPUT_BUCKET`.

La configuración incompleta bloquea generaciones en ambas secciones. No se habilita una excepción pública para conservar el acceso mientras falta Firebase. Resolver la activación/permisos de Firebase y comprobar el acceso real del propietario sigue pendiente. Cambiar solo web/autenticación no exige recompilar el worker instalado; se conserva su commit para diagnóstico y rollback.

## U006 — recuperar la carga de proyectos anteriores de Animes

El usuario informa que un proyecto guardado de Animes no carga después de conectar el acceso privado. Se autoriza reparar su carga, manteniendo formatos, preferencias, motores y medios. El arranque espera a que se haya sincronizado la sesión. Una lectura fallida no equivale a un proyecto vacío, no debe purgar otras copias y no debe anunciar éxito. Una copia de emergencia local se identifica como tal. La confirmación de carga espera al renderizado de personajes y escenas.

La comparación heredada admite diferencias en las funciones de carga, el renderizado progresivo de personajes/escenas y la propagación de errores de lectura. Las plantillas de personajes/escenas y sus controles siguen comparándose literalmente con el baseline, además de todos los generadores. `tests/shorts/ui/animes-loading.test.mjs` ejecuta la página real con escenarios sintéticos de sesión, lectura y medios. El endpoint de lectura añade un registro de tipos/recuentos sin texto de historia, credenciales ni URLs; conserva payloads, almacenamiento y permisos. El CSS original y los instaladores permanecen iguales.

## U007 — conservar el diseño original en toda la aplicación

El usuario rechaza la nueva paleta verde y pide el diseño original de Animes también en Cortos. Se reutilizan fondo azul oscuro, magenta, cian, rosa, tipografías, tarjetas con brillo, degradados, estrellas, cometas y transiciones originales. Se aplica a Cortos, acceso y revisión de sonido. No se modifica la hoja de estilos de Animes ni se añaden opciones de apariencia. Las áreas funcionales y controles de Cortos se conservan; se respeta la preferencia del dispositivo de reducir movimiento.

## U008 — formulario único y catálogo completo en Cortos

El usuario informa que el formulario de creación aparece tres veces y que faltan las opciones de Animes. Las notificaciones concurrentes de la sesión comparten un único montaje; los redibujados de Cortos se serializan. Un refresco del token no debe reconstruir ni borrar lo que se está escribiendo.

El catálogo independiente de Cortos incluye las 17 opciones de género y los 23 subgéneros de Animes, junto con las opciones adicionales de Cortos. Ecchi y las primeras opciones aparecen directamente; el resto queda bajo «Más subgéneros». La selección se guarda en el proyecto y llega al director. Donghua / Cultivación se expresa de forma explícita como fantasía + el subgénero donghua / cultivación, ambos persistidos, compatible con el servicio instalado. El catálogo de Animes, sus demografías y sus modos no se modifican. Las tres ideas son resultados generados, nunca tres formularios a rellenar.

## Evidencia y límites

La matriz conserva A001–A100 y añade `effectiveRequirement`/`override` en las filas afectadas. El comprobador sigue cotejando literalmente los cien requisitos originales. Las pruebas de interfaz usan un transporte sintético explícito separado de la aplicación real; no prueban Firebase, modelos ni calidad de medios. Las pruebas FFmpeg sí generan/decodifican medios sintéticos. La aceptación con servicios reales y Safari/iPhone sigue pendiente.

## U009 — Recuperar material previo y resolver Cortos (2026-09-24)

El propietario confirma escenas e imágenes anteriores; que el nombre aparezca en la lista no satisface la recuperación. Se exige abrir el contenido real sin regenerarlo. La búsqueda y restauración deben preservar las copias existentes y comprobar el proyecto concreto antes de declarar el problema resuelto. El fallo 412 de Cortos se corrige manteniendo concurrencia/idempotencia y el worker instalado. Evidencia y límites: [recovery-and-http-fix.md](recovery-and-http-fix.md).


## U010 — Misma organización que Animes, no solo sus colores (2026-09-24)

El usuario aclara que conservar el diseño incluye la organización y los controles conocidos de Animes: proyectos en el encabezado, navegación inferior, imágenes y videos visibles en las escenas, voz junto al texto y música en su apartado. Igualar solamente la paleta no cumple esta instrucción.

Cortos adopta la navegación inferior Historia, Personajes, Escenas y Exportar. «Proyectos» abre una lista compacta desde el encabezado. Historia contiene el único formulario y las tres propuestas generadas; Personajes contiene también lugares y objetos; Escenas conserva voces, música y efectos; la revisión del corto y sus subtítulos es accesible desde Escenas y Exportar. Las referencias y las tomas se muestran directamente; el historial y los ajustes adicionales siguen plegados. No se eliminan aprobaciones, comparación, edición manual, mezcla ni funciones de montaje.

Las tres tarjetas observadas coinciden con tres altas de proyectos (201) seguidas de fallos de apertura (412). No son historias precargadas por la aplicación. Los registros existentes no se borran ni archivan automáticamente. Los títulos vacíos se identifican como «Corto sin título». Una creación confirmada conserva su ID y un reintento abre ese registro; una respuesta desconocida exige revisar la lista antes de crear otro. Abrir una pantalla solo lee recursos, nunca genera modelos.

La adaptación modifica únicamente los archivos de Cortos, sus pruebas y documentación. `index.html`, APIs de Animes, proveedores y worker instalado conservan exactamente el contenido anterior a esta corrección. Evidencia: [animes-interface-adaptation.md](animes-interface-adaptation.md). La reparación del proyecto antiguo sigue siendo un requisito independiente y pendiente de verificar con sus escenas reales.

## U011 — Tres ideas breves y seguimiento visible (2026-09-24)

El usuario aclara que cada una de las tres ideas contiene únicamente un título y un concepto breve. No quiere desarrollar las tres historias para elegir. El guion audiovisual y las biblias se desarrollan solo después de seleccionar una. Se mantiene exactamente tres propuestas distintas, género y subgéneros, concepto opcional y el desarrollo posterior completo de 300 segundos.

El servicio de Cortos hace una sola generación de texto para las tres ideas, con salida limitada a 4096 tokens y contratos `{id,title,premise}`. La interfaz muestra título/concepto incluso para las propuestas antiguas más extensas; no borra los datos anteriores. La llamada de desarrollo sigue usando el límite anterior y solo la idea seleccionada. No cambia ningún proveedor, modelo o región.

La captura «Ideas · En espera» corresponde a un trabajo cuyo arranque ocurrió después del límite de consulta de la web. Se amplía la consulta del mismo ID a doce minutos, se recupera el estado al abrir el proyecto y se muestran errores/cuotas, comprobación, cancelación y recuperación en Historia. No se repiten generaciones automáticamente ni se ofrecen nuevas ideas mientras exista una solicitud de ideas incierta o pendiente. Evidencia y límites: [ideas-and-job-followup.md](ideas-and-job-followup.md).

## U012 — Desarrollo encadenado con producción completa (2026-09-24)

El usuario autoriza usar como referencia las llamadas funcionales de Animes:
dividir desarrollo, conservar contexto y guardar entregas. No se simplifican
los guiones, silencios, voces japonesas, subtítulos españoles, música, SFX ni
montaje establecidos. La generación de ideas sigue limitada a tres títulos
y conceptos; solo la idea elegida se desarrolla. Ver staged-text-generation.md.

## U013 — Pasos manuales y revisión antes de continuar (2026-09-24)

Sustituye el encadenamiento automático de U012. El usuario solicita generar y leer cada entrega antes de pedir la siguiente: Historia; Guion, biblias y planos; Sonido, música y subtítulos; Revisión de continuidad. Cada trabajo solicita una sola respuesta de texto. Aprobar no genera el paso siguiente. Se conserva el contexto aprobado, los requisitos de producción y el diseño.

Recuperar una historia anterior no exige voces, música ni duración final y no llama a modelos. Los errores posteriores conservan las entregas aprobadas. Ver [manual-development.md](manual-development.md).

## U014 — Duración flexible de cinco minutos (2026-09-25)

El usuario permite entre 285 y 315 segundos totales. Sustituye la exigencia de 300 segundos exactos en planificación, compilación, mezcla, vistas previas y exportación. La duración incluye acciones, voces y pausas; música y efectos superpuestos no añaden tiempo. Se conserva la duración natural dentro del margen, sin acelerar voces ni añadir relleno. Las unidades internas siguen siendo 24 FPS y audio a 48 kHz.

El prompt del paso Guion incluye un presupuesto orientativo por momento de la historia aprobada, explica segundos frente a fotogramas y exige cubrir el relato completo. No se cambia la historia aprobada ni se encadenan llamadas. Un plan de 32 segundos sigue siendo incompleto: el margen no permite aceptarlo ni estirarlo arbitrariamente.

Pruebas: test_duration_range.py comprueba límites, música y efectos respecto de la duración real, compilación y exportación FFmpeg de 285 y 315 segundos. Son medios sintéticos sin llamadas a modelos; la generación de Gemini en la cuenta del usuario sigue pendiente de aceptación real.

## U015 — Priorizar generación nueva válida (2026-09-25)

El usuario aclara que regenerar no es el problema: prioriza que la generación funcione, tomando como referencia las llamadas de Animes. No se añaden botones de recuperación o reparación selectiva.

Comparación realizada: api/script.js y api/video-start.js frente a shorts/service/providers.py y production.py. Animes solicita duraciones soportadas próximas a la deseada; Cortos fijaba ocho segundos. Cortos ahora elige 4/6/8 como la menor duración que cubra el intervalo aprobado, sin adoptar el retiming de Animes. El esquema del paso Guion diferencia planos de imagen y video mediante anyOf: los campos temporales de Veo tienen máximo 192 frames; las imágenes mantienen límites de hasta 7560. Los campos treatment se generan primero. Documentación consultada: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output (anyOf y maximum admitidos).

El planificador solo limita un margen máximo excesivo cuando la duración prevista y mínima ya caben en ocho segundos; no recorta una acción larga ni cambia su tratamiento automáticamente. Las acciones largas permanecen sujetas a planificación narrativa compatible. Pruebas de esquema, límites, selección 4/6/8, API e interfaz no equivalen a una generación real con Gemini.

## U016 — Guion completo por tramos revisables (2026-09-25)

La captura IMG_3353 muestra que el plan generado solo permite 72.9–96.4 segundos. No demuestra un fallo de transporte ni un rate limit: sí demuestra que el guion obtenido no cubre los cinco minutos. El paso 2 todavía pedía biblias, todas las tomas, diálogos y continuidad en una única respuesta. Se sustituye esa solicitud monolítica por biblias y tramos, manteniendo una sola llamada por pulsación y las cuatro etapas editoriales.

El reparto temporal cubre todos los momentos de la historia aprobada y divide los largos en solicitudes de hasta 48 segundos previstos. Cada tramo admite un margen del 5%; la suma final sigue entre 285 y 315 segundos. Esto limita el alcance de cada respuesta, no la duración de las tomas: Veo conserva su máximo de ocho segundos y el tratamiento se decide por la acción. No se duplican planos, estiran imágenes ni convierten silencios artificialmente para rellenar.

Cada respuesta correcta se guarda en un borrador parcial. La web muestra tramos/segundos guardados, permite leer y volver a generar la parte actual, y requiere una pulsación para continuar. Una respuesta inválida o 429 conserva el último punto válido. El servidor verifica que la continuación corresponde a la historia aprobada, fija su hash al enviar y lo comprueba al ejecutar. Solo el guion completo puede aprobarse para sonido y revisión; no se permite aprobar una entrega parcial para producción. El contexto conserva las biblias, planos y diálogos anteriores, el relato completo y el plan pendiente.

Se mantienen japonés, traducción española, silencios con intención, música/SFX posteriores, revisión, montaje y diseño. No se modifica Animes. Pruebas locales con respuestas simuladas verifican el recorrido completo, fallos/reintentos, referencias cruzadas, fronteras de aprobación y los botones de continuación. No equivalen a una generación real de Gemini ni a un despliegue verificado en la cuenta del usuario.
