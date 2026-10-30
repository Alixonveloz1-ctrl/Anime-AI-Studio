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

## U017 — Espera y reintento automático ante cuota (2026-09-25)

El usuario pide no tener que esperar y reintentar manualmente ante 429. Se autoriza repetir la misma solicitud de texto explícitamente rechazada por cuota; esto sustituye la prohibición anterior para ese caso concreto. No autoriza pasar al siguiente paso editorial ni repetir resultados aceptados o inciertos.

El servicio espacia los comienzos de llamadas de texto de Cortos en el mismo proyecto al menos 60 segundos. Ante 429 hace como máximo tres reintentos, con esperas de 60/120/240 segundos más jitter, respetando Retry-After y google.rpc.RetryInfo si piden más tiempo. Hay un presupuesto acumulado de espera de diez minutos y un límite temporal interno para no agotar la petición del servicio. Si Google pide esperar más que ese presupuesto, se detiene sin anticipar el reintento. El preflight gratuito countTokens también admite esperas ante 429.

Cada envío pagado se registra. Solo el rechazo confirmado 429 puede volver a enviarse con el mismo hash; errores 5xx, timeout o resultado desconocido conservan el bloqueo contra duplicados. No se cambian modelos ni se repiten partes terminadas. Durante la espera se muestra el tiempo aproximado y el número de reintento; cancelar o perder la sesión detiene nuevos envíos. La revisión manual entre entregas se conserva.

Referencia: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/error-code-429 (backoff exponencial). Las pruebas usan transporte y relojes simulados: cuota seguida de éxito, agotamiento, Retry-After/RetryInfo, cancelación, separación entre llamadas y ausencia de duplicados. No verifican disponibilidad real de cuota en la cuenta del usuario.

## U018 — Un guion de Cortos no espera minutos por su propio espaciado (2026-10-24)

El usuario pregunta por qué un guion de Cortos tarda diez minutos cuando Animes escribe un episodio largo en unos tres, y tiene razón: el minuto que U017 reservaba antes de cada llamada de texto no protegía de nada. Todas las operaciones de texto de Cortos (ideas, develop, revise, analyze, review, transcribe) comparten un único motor, así que nunca hay dos llamadas de texto a la vez; ese minuto sólo se cobraba a la siguiente llamada del mismo trabajo. Un guion de diez llamadas gastaba 522 segundos esperando su propio turno, medidos sobre el código anterior.

El espaciado entre comienzos de llamadas de texto baja de 60 a 5 segundos (`TEXT_SPACING_SECONDS` en `shorts/service/cloud.py`). Lo demás de U017 queda intacto y es la protección real ante cuota: ante 429, hasta tres reintentos con las esperas que pide Google (Retry-After y google.rpc.RetryInfo, 60/120/240 con jitter), presupuesto acumulado de diez minutos, límite temporal interno, y el preflight gratuito countTokens que también admite esperas. Siguen registrándose los envíos pagados y sólo un 429 confirmado puede reenviarse con el mismo hash.

Este cambio no autoriza llamadas en paralelo ni quita el motor único de texto: sigue habiendo una sola generación de texto de Cortos a la vez en el proyecto. Las pruebas (`tests/shorts/test_quota_retry.py`) miden el espaciado de un guion de diez llamadas y comprueban que la reserva ya tomada por otra llamada se sigue respetando; no verifican la cuota real de la cuenta del usuario.

## U019 — El guion completo con una sola pulsación (2026-10-25)

El usuario señala que el paso Guion le pide aprobar diez tramos uno por uno y pregunta por qué no se genera entero, como en Animes. Tiene razón en la distinción: los tramos de U016 son el tamaño máximo de UNA respuesta del modelo (hasta 48 segundos previstos), no pasos editoriales. Pedir una pulsación por tramo convertía un guion de cinco minutos en diez pulsaciones.

Una sola pulsación encadena los tramos que falten. Cada respuesta correcta se sigue guardando como punto de control inmutable, así que detener la generación, perder la sesión o recibir un 429 conservan lo escrito y la siguiente pulsación continúa desde el último tramo bueno. Un tramo inválido detiene la cadena y muestra su error; «Generar otra versión de esta parte» sigue rehaciendo un solo tramo.

Esto NO sustituye U013: los cuatro pasos editoriales —Historia; Guion, biblias y planos; Sonido, música y subtítulos; Revisión de continuidad— siguen pidiendo su pulsación y su lectura, y aprobar un paso no genera el siguiente. Las biblias se siguen entregando aparte, para leerlas antes de que se escriba el guion. Una entrega parcial sigue sin poder aprobarse para producción.

Pruebas (`tests/shorts/ui/studio.test.mjs`): una pulsación escribe los tramos restantes uno tras otro, un fallo detiene la cadena sin seguir gastando y conserva el último punto de control, y la pulsación siguiente continúa desde ahí hasta el guion completo. El fixture marca el trabajo como fallido cuando su tramo es inválido, igual que el servicio.

## U020 — Todo el texto con una sola pulsación (2026-10-25)

El usuario corrige U013 y U016: no quiere aprobar paso a paso. «Mientras yo menos pasos tenga, mejor. Los únicos pasos que me interesa hacer manualmente son la generación de imagen, de video, de audio. Ya lo que es texto, la historia como tal, no necesito estar aprobando cada paso.» Esta decisión sustituye a U013 en lo que respecta a las entregas de texto.

Una pulsación escribe la historia, el guion y las biblias (con sus tramos encadenados), el plan de sonido y la revisión de continuidad, aprobando cada entrega, y termina aprobando la versión de guion resultante: las tomas quedan listas y la vista pasa a Escenas. No se genera ni una imagen, ni un video, ni una voz: todo lo que se paga por toma se sigue pidiendo una a una.

Se conserva lo que protege el gasto y el trabajo hecho: cada entrega y cada tramo se guardan como punto de control inmutable, un fallo o una cancelación detienen la cadena sin seguir llamando, y la siguiente pulsación continúa desde el último punto bueno. Siguen existiendo, plegadas bajo «Hacer sólo este paso», las acciones de un solo paso: «Generar sólo …» y «Aprobar este paso y parar aquí», para quien quiera leer una entrega antes de pagar la siguiente. Una entrega parcial sigue sin poder aprobarse como guion completo, y abrir producción desde el paso 2 o 3 sigue disponible.

Pruebas (`tests/shorts/ui/studio.test.mjs`): una pulsación produce exactamente las cuatro llamadas de texto en orden, cada una continuando la anterior, sin ninguna llamada a generación de recursos, y deja el guion activo con sus tomas en pantalla; un fallo de tramo detiene la cadena conservando lo escrito y la pulsación siguiente la termina; y un paso suelto se puede generar y aprobar sin que nada siga.

## U021 — Elegir la voz y saber si es femenina o masculina (2026-10-25)

El usuario intenta generar voz, le sale «elige una voz» y responde: «no veo ninguna opción para elegir la voz». Además: «sí necesito saber qué voces son femeninas y qué voces son masculinas. Tengo que probarlas todas una por una para saber quién es quién. Eso no me sirve.»

Eran tres problemas encadenados. El selector existía, pero estaba al final de la ficha del personaje, debajo de la imagen de referencia y de sus botones: el aviso de error aparece arriba de la página y el control quedaba fuera de pantalla. Las treinta voces eran sólo nombres propios (Achernar, Gacrux, Zubenelgenubi…), así que la única forma de saber quién era quién era sintetizarlas una a una. Y una voz fuera del catálogo dejaba la historia muda para siempre: el esquema de respuesta enumera los treinta nombres, pero el modelo contesta a veces con la grafía de Cloud (`ja-JP-Chirp3-HD-Kore`) o con un nombre que no existe, el guion se aceptaba igual y después fallaba cada generación de voz.

Ahora la voz es lo primero que se ve en la ficha, antes de la referencia visual, con su propio título y una línea que dice cuántas voces femeninas y cuántas masculinas hay. El catálogo (`/generators`) entrega el sexo de cada voz y la lista se agrupa en «Voces femeninas» y «Voces masculinas», con cada opción escrita como «Kore · femenina». Y el nombre de voz que entrega el modelo se normaliza contra el catálogo (`plan_voices` en `shorts/service/development.py`): se reconoce la grafía de Cloud y cualquier mayúscula, y si no hay nada reconocible se asigna una voz del catálogo a partir del id del personaje —siempre la misma— para que el guion nunca quede sin poder hablar. Cambiarla en Personajes sigue siendo una pulsación.

La clasificación es la que publica Google para estas mismas voces (tabla de voces de Gemini-TTS en Cloud Text-to-Speech), contrastada con la tabla de Firebase AI Logic y con el cuaderno de narración de Google: 14 femeninas y 16 masculinas, exactamente los treinta nombres del catálogo. No está inferida de oído ni de memoria. Si Google añade una voz, `tests/shorts/test_sound_plan.py` falla hasta que se clasifique.

Pruebas: `tests/shorts/test_sound_plan.py` (el catálogo clasifica exactamente sus treinta voces y `/generators` lo entrega), `tests/shorts/test_manual_development.py` (una voz inexistente o con la grafía de Cloud no deja la historia muda, y la elección es estable) y `tests/shorts/ui/studio.test.mjs` (el selector va antes de la referencia, agrupado por sexo, y una voz fuera del catálogo se avisa como error sin dejar de ofrecer el catálogo).

## U022 — Efectos que se pueden conseguir, y su prompt a la vista (2026-10-25)

El usuario revisa el plan de sonido de un corto de cinco minutos y encuentra tres cosas: «me está pidiendo 13 efectos especiales… siento que son demasiados. A veces algunos hasta se pueden repetir y solamente necesito subirlo una vez y que los reutilice»; «no veo ningún prompt. Le doy a donde dice prompt y solo me dice cómo se llama el efecto y ya. Necesito el prompt para yo poder generarlo externamente con otra herramienta»; y «me está pidiendo un efecto especial que dura 315 segundos, que es como de ambiente… ¿cómo lo voy a generar? Debería ser uno corto que lo reutilice si es el ambiente, o si es una música de fondo, debería generarla al lyra».

Cada efecto es un archivo que una persona tiene que conseguir a mano, así que la cantidad y la duración son trabajo real. El plan pedía el ambiente entero del corto como un solo archivo de 315 segundos, que no existe en ninguna parte, y además lo trataba como un golpe con instante de contacto, porque el campo que distingue ambiente de efecto se leía en producción pero nunca se escribía.

Qué cambia:

- El plan declara `type`: `sfx` es un golpe con un instante exacto de contacto y dura como máximo `SFX_MAX_SECONDS` (15 s); `ambience` es un lecho del que basta un bucle de hasta `AMBIENCE_LOOP_SECONDS` (20 s). Lo que pase de la duración de un golpe es un lecho, se etiquete como se etiquete, y se recorta al bucle (`plan_sound`). Un fondo continuo o musical no es un efecto: se encarga como música y lo compone Lyria.
- El montaje repite el bucle de ambiente desde su toma hasta que cambia el lugar, con fundido sólo al entrar y al salir, y recorta la última repetición para no pasarse de su sitio (`ambience_placements` en `shorts/service/timeline.py`). Un bucle demasiado corto para su lugar lo dice en los avisos del borrador en vez de dejar silencio sin explicación.
- El mismo sonido en varias tomas es un solo grupo (`soundGroup`) y una sola tarjeta: subir su archivo una vez lo coloca en todas sus tomas, cada una con su propia sincronización, porque un golpe cae en su propio fotograma. Dos solicitudes idénticas en la misma toma dejan de ser dos sonidos.
- El prompt se lee dentro de la tarjeta del efecto, con «Copiar prompt», y también en el plan de sonido que se aprueba —que antes sólo mostraba el nombre del efecto—. La dirección musical de cada pieza se lee igual.
- Las instrucciones del paso de sonido piden entre tres y seis sonidos distintos para cinco minutos, repetir el prompt palabra por palabra cuando el sonido se repite, y no pedir efectos para lo que ya cuentan la voz o la música.

Las historias guardadas antes de este cambio siguen siendo válidas: sin `type` ni `soundGroup` no se les aplica el límite de duración y cada solicitud sigue siendo su propia tarjeta. Un plan ya producido conserva lo que se le encargó; pedirle una corrección con IA lo normaliza como si fuera nuevo, y el informe de impacto dice qué cambió. Una edición manual no se normaliza: si escribes 400 segundos a mano, el guardado lo rechaza explicando por qué, en vez de cambiar tu número en silencio.

La autoprueba de la imagen de Cloud Run —el paso que decide si una instalación recibe tráfico— incluye estas pruebas. La que compara las tablas de voz de Animes y Cortos se salta dentro de la imagen, porque la página de Animes no viaja en ella.

Pruebas (`tests/shorts/test_sound_plan.py`, `tests/shorts/ui/studio.test.mjs`): el efecto de 315 segundos se convierte en bucle de ambiente obtenible; un golpe dentro de su límite se deja intacto; el mismo sonido en dos tomas comparte archivo y la repetición en la misma toma se descarta; los márgenes imposibles se encogen en vez de tumbar el paso; el bucle cubre su lugar y para cuando el lugar cambia; una historia guardada sin los campos nuevos sigue validando; y el prompt del efecto se lee en su tarjeta con su botón de copiar.

## U023 — Las pantallas de lectura no muestran decisiones del director (2026-10-25)

«Esto está demasiado desordenado. No sé dónde está nada. Un montón de información inútil que no necesito yo saber. O sea, como los nombres de los planos o qué toma, desde qué ángulo… Esas son cosas que decide el director.» Y sobre la pantalla de sonido: «veo que en la parte de música y eso hay un historial de actividad que es innecesario».

Las pantallas de lectura volcaban el guion campo por campo: identificadores internos, tratamiento de cada toma, cámara, fotogramas, límites elásticos, estados físicos antes y después, y la fontanería del sonido. El desglose de tomas etiquetaba cada una con su técnica («Ilustración», «Cámara 2D»). Y debajo de la música aparecía siempre un «Historial de actividad» con las últimas treinta generaciones, terminadas incluidas.

Ahora las pantallas de lectura omiten esos campos (lista `TECNICO` en `cortos/studio.mjs`) y el desglose de tomas se lee como un guion: número de toma, duración, lugar, propósito dramático y diálogo. La lista de actividad sólo aparece cuando algo espera una decisión —lo que sigue en curso y lo que falló o quedó sin confirmar— y muestra hasta diez entradas.

Esto no quita acceso a nada: el editor manual del guion sigue mostrando y permitiendo cambiar todos los campos, y la pantalla de producción sigue diciendo el tratamiento de cada toma, porque ahí determina qué se genera. Pruebas (`tests/shorts/ui/studio.test.mjs`): el desglose lee propósito y diálogo pero no técnica, fotogramas ni identificadores; la lista de actividad no aparece sin nada pendiente y sí aparece con una generación en curso.

## U024 — Dos callejones sin salida de la primera sesión real (2026-10-25)

El dueño actualiza, entra a su corto y encuentra dos cosas que no tienen salida.

**«Otro trabajo usa este motor» en el primer intento.** Pide una frase de prueba para escuchar una voz y la tarea queda en espera. No había empezado nada: el motor de voz lo tenía ocupado un trabajo anterior. Dos fallos encadenados. El primero es del servidor: al repartir trabajo se libera el motor si el trabajo que lo ocupa ya está cerrado, pero si su ficha ya no existe en la base de datos no se liberaba nunca —nada puede informar del resultado de algo que no está, así que esa máquina quedaba ocupada para siempre por un fantasma—. Ahora una ficha ausente libera el motor; una generación abierta, aunque parezca vieja, lo sigue protegiendo igual que antes, porque puede estar corriendo de verdad. El segundo es de la web: el aviso no decía qué trabajo bloqueaba, y la pantalla de Personajes no tenía ninguna lista donde encontrarlo. Ahora la tarjeta que espera ofrece «Comprobar el trabajo que lo bloquea»: lo consulta o lo cierra sin repetirlo, y en cuanto el motor queda libre reanuda ahí mismo la generación que esperaba. Personajes también muestra lo que espera una decisión, como Escenas.

**El paso 4 ofrecía una aprobación imposible.** Con el guion ya aprobado, el botón principal seguía diciendo «Aprobar y seguir desde "Revisión de continuidad"» y, al pulsarlo, el servidor respondía siempre que el paso no está listo para aprobar. No era un estado raro: el paso 4 no deja un borrador aprobable, deja una VERSIÓN candidata del guion, y lo que se aprueba es esa versión. El botón pedía lo único que ese paso nunca puede dar. Ahora, cuando el paso 4 ha entregado, el botón se llama «Aprobar el guion y abrir producción» y lleva a las tomas; si el guion ya estaba aprobado, entra directamente a Escenas.

Esto pasó inadvertido porque el simulador de pruebas aprobaba cualquier borrador, incluido el del paso 4, cosa que el servicio real nunca hace. El simulador ahora rechaza esa aprobación igual que el servidor: con el fallo delante, seis pruebas de la cadena de texto fallan.

El primer botón que di para esto no bastaba: consultaba o cerraba el trabajo bloqueante, pero el caso más común —una generación que nunca llegó a entregar nada— no se puede ni consultar ni cerrar, y la espera seguía sin salida. Ahora la tarjeta dice qué ocupa el motor («Lo ocupa: Voz · Preparando») y «Liberar el motor y continuar» hace lo que haga falta en orden de menor daño: consultarlo, cerrarlo sin repetirlo o, si nunca arrancó, cancelarlo tras confirmar. Después comprueba de verdad que el motor quedó libre antes de reanudar, para no volver al mismo aviso rojo; si sigue ocupado por algo en marcha, lo dice y avisa de que arrancará sola. Y cuando el motor lo retiene una ficha que ya no existe —lo único que la web no puede soltar— lo dice con lo que falta por hacer: ejecutar «./c».

Pruebas: `tests/shorts/test_engine_release.py` (un motor retenido por una ficha inexistente se libera; uno retenido por una generación abierta se sigue protegiendo) y `tests/shorts/ui/studio.test.mjs` (el paso 4 abre producción sin pedir esa aprobación; una tarjeta en espera dice qué la bloquea y lo resuelve consultando, cerrando o cancelando; no se reanuda contra un motor que sigue ocupado; y con el servidor sin actualizar dice que hay que ejecutar «./c»).

## U025 — Esperar turno es una cola, no un error (2026-10-25)

«Yo quiero que si le doy al botón de generar la voz, que se genere. Y si está otra voz generándose, pues que se ponga en la cola y ya, y se genere en el orden. Y ya. Cuatro botones ahí que ni sé qué funcionan.»

Tiene razón y la cola ya existía: el servidor recuerda quién espera cada motor y arranca al primero en cuanto queda libre. Lo que estaba mal era la web. Pintaba la espera como un fallo —aviso rojo, «Otro trabajo usa este motor»— cortaba el seguimiento del trabajo y ofrecía cuatro acciones de rescate (comprobar, continuar, cancelar y, por mi parte, liberar el motor) para algo que no requiere ninguna decisión. Los arreglos anteriores iban en la dirección equivocada: mejoraban los botones en vez de quitar el problema.

Ahora esperar turno se lee como lo que es: «En cola: otra generación está usando este motor. Ésta empezará sola cuando termine.» Sin rojo. El único botón es Cancelar, por si no la quieres. El seguimiento no se corta: la página sigue mirando hasta que le toca y entrega sola. Y mientras espera reintenta el reparto cada treinta segundos, que es lo que hace que un motor retenido por un trabajo ya cerrado se suelte sin que nadie pulse nada.

Quitado por completo el botón «Liberar el motor y continuar» y su maquinaria. Un trabajo realmente atascado sigue apareciendo en la lista de actividad con sus acciones, que es donde corresponde: una lista de cosas que esperan una decisión, no la tarjeta de algo que sólo espera su turno.

Falta la causa de origen, y es la que el dueño describe: «con la primera generación ya decía que había otra cosa trabajando, cuando yo no había mandado a hacer más nada antes, y ahí se quedaba y nunca paraba». El motor lo retenía un envío anterior que quedó incierto. Un envío incierto NO se está ejecutando —el worker suelta su motor por esa misma razón cuando llega a hacerlo— pero si al worker lo matan antes, nadie lo suelta nunca. Ahora al repartir trabajo también se libera el motor de un envío incierto: el trabajo sigue abierto, sin cerrarse ni reenviarse, para que su dueño decida; lo único que cambia es que deja de retener una máquina que no está usando. Un trabajo que sí puede estar ejecutándose sigue protegiendo su motor igual que antes.

Y mientras una tarea espera turno, la página comprueba cada treinta segundos el trabajo que ocupa el motor. Comprobarlo es gratis y no reenvía nada, y es lo que cierra un worker muerto y suelta su motor sin que nadie busque ningún botón.

Pruebas (`tests/shorts/test_engine_release.py`, `tests/shorts/ui/studio.test.mjs`): un motor retenido por un envío incierto se libera sin cerrar ni reenviar ese trabajo; uno retenido por algo que puede estar ejecutándose se sigue protegiendo; una tarea encolada se lee como cola, sin rojo y con Cancelar como único botón; y una tarea pedida con el motor ocupado termina sola, comprobando al ocupante y reintentando el reparto, sin que el usuario pulse nada más.

## U026 — La vista previa de una toma se ve, y lo pendiente se cuenta (2026-10-25)

«Le doy a ver toma completa y convirtió la imagen en un video de 10 segundos… le restó como un 90% de calidad. La imagen pasó de Ultra HD a parecer calidad 360.»

Era literal: toda vista previa se renderizaba a 640×360, incluida la de una sola toma. No se gastó ninguna generación de Veo —una vista previa no llama a ningún modelo, sólo monta con lo ya generado—, pero el resultado llegaba borroso y parecía que previsualizar hubiera estropeado la imagen. Los 360p existen para que revisar el corto entero sea rápido, no para mirar una toma.

Ahora la resolución depende de lo que se previsualiza: hasta 45 segundos se ve a tamaño real (1920 o 1080 según el formato), hasta dos minutos y medio a tamaño intermedio, y sólo por encima de eso se reduce. Una toma suelta se ve como se generó.

Y debajo del reproductor aparecía la lista de pendientes del borrador una por una: treinta veces «Falta voz aprobada» con la frase entera de cada intervención, un muro de texto que no decía más que «faltan treinta voces». Ahora se agrupan y se cuentan: «Falta voz aprobada: 30 pendientes».

Pruebas (`tests/shorts/ui/studio.test.mjs`): los pendientes de una vista previa se resumen por tipo y no se enumeran uno a uno.

## U027 — El límite de Google se espera también en imagen, voz y música (2026-10-25)

«Si hay rate limit, pues se espera y a los 60 segundos reintenta la imagen y se genera sin ningún problema.» Eso es lo que el dueño espera, y es lo que hacía sólo el texto.

Un 429 de Google es un rechazo: no generó nada y no cobró nada. El texto esperaba lo que Google pide y reintentaba la misma solicitud, hasta tres veces, con un presupuesto total de espera. Una imagen, una voz o una música se daban por fracasadas en el primer 429, aunque bastara esperar un minuto.

Eran dos frenos encadenados. El reintento estaba habilitado sólo para `kind=='text'`. Y aunque se habilitara, el control de presupuesto de llamadas (`check_call_scope`) sólo perdonaba el rechazo por cuota al texto: para los demás, el intento rechazado contaba como llamada gastada, así que el reintento se rechazaba al instante por «la acción solicitada ya realizó sus llamadas». Ahora un rechazo por cuota no cuenta como llamada gastada en ningún tipo, que es lo que ya decía su propio nombre.

Lo que no cambia: el tope de tres reintentos por cuota, el presupuesto acumulado de espera, el plazo interno, y que un envío cuyo resultado no se conoce nunca se reenvía. Un 429 no es un envío incierto: es un rechazo confirmado.

Pruebas (`tests/shorts/test_quota_retry.py`): una voz, una imagen, una música y un video esperan el minuto que pide Google y reintentan la misma solicitud, sin espaciado de texto y sin gastar su presupuesto en el intento rechazado.

## U028 — Tres cosas de la primera sesión que sí funcionó (2026-10-25)

Con el motor de voz ya libre, la voz se generó. Tres cosas más de esa misma sesión.

**«La voz, pausas y acciones exceden el intervalo aprobado en t1_shot03».** La voz grabada no cabía en el tiempo que el guion había previsto para esa toma, y eso bloqueaba cualquier vista previa de todo el corto. Pero la duración de una toma se planea ANTES de que la voz exista: el propio guion dice que la duración definitiva depende del audio medido. Ahora un borrador deja caber la voz —alargando la toma, nunca acelerando el audio—, señala esa toma entre los pendientes del borrador y se puede ver y escuchar. Exportar sigue exigiendo revisarla, porque cambia el metraje aprobado, y el tope de ocho segundos de una toma Veo no se relaja ni en borrador.

**«¿Qué significa ver toma completa?»** No decía lo que hace: arma un video de esa toma con sus voces, su música y sus efectos. Pasa a llamarse «Ver y escuchar esta toma», y la de la escena, «Ver y escuchar la escena entera».

**«Por cada cosa que genero, se recarga la página completa».** Al terminar una generación la pantalla se repinta entera y el navegador saltaba al principio, así que por cada imagen y por cada voz había que volver a buscar dónde estabas. Ahora el repintado conserva la posición, incluso después de que entren las imágenes, que cambian el alto. Cambiar de sección sí empieza arriba, que es lo que se espera.

Pruebas: `tests/shorts/test_workflow.py` (el borrador alarga la toma, exportar la exige revisada, y Veo sigue acotado) y `tests/shorts/ui/studio.test.mjs` (terminar una generación te deja donde estabas; cambiar de sección empieza arriba).

## U029 — Abrir una pantalla no pide los medios de todo el corto (2026-10-30)

«Tarda mucho en cargar todo.»

Medido con cuarenta tomas, que es un corto de cinco minutos: abrir Escenas
lanzaba **84 peticiones al servicio**, y 80 de ellas eran la dirección firmada
de un archivo —una por cada imagen y cada voz de las cuarenta tomas—, de tres
en tres, antes de haber mirado la primera toma. Las otras cuatro también
sobraban en parte: la lista de trabajos se leía dos veces por pantalla, y el
catálogo de generadores se volvía a pedir en cada cambio de sección aunque sólo
cambie cuando esta misma página lo guarda.

Ahora el archivo de una tarjeta se pide cuando esa tarjeta entra en pantalla,
con 400 píxeles de margen para que ya esté al llegar, y siguen bajando tres a
la vez como máximo. La lista de trabajos se pide a la vez que el proyecto, no
después, y se lee una sola vez. El catálogo de generadores se lee una vez por
corto. Las mismas cuarenta tomas, en una pantalla de teléfono: **5
peticiones**. Un navegador que no sepa qué hay en pantalla las pide todas, como
antes.

Pruebas (`tests/shorts/ui/studio.test.mjs`): con cuarenta tomas pintadas,
abrir Escenas pide como mucho cuatro archivos y lee los trabajos una vez;
bajar hasta la toma veintiuno pide entonces su imagen; y el catálogo de
generadores se lee una vez aunque se cambie de sección tres veces.
