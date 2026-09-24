# Cortos desde el iPhone

La sección está en `/cortos/`, dentro del mismo repositorio y proyecto Vercel. El código se integra en `main` por decisión del usuario. La publicación web y la instalación de los servicios Google son pasos distintos; no equivalen a 100 pruebas aceptadas. Consulta [la matriz completa](acceptance.md) y [la auditoría](audit.md).

## Instalación y actualización

1. Abre **el enlace que recibirás en la conversación**, preparado para el correo de Google que indiques. Inicia sesión con ese correo. El enlace carga este repositorio y `main`; autoriza su apertura cuando Google lo solicite. La aplicación no contiene botones ni paneles de instalación.
2. En la terminal escribe solamente `./c`. Si el sistema no permite ejecutarlo directamente, escribe `bash c`.
3. El menú ofrece **1 Instalar/actualizar**, **2 Diagnóstico**, **3 Restaurar versión anterior**, **4 Salir**, **5 Conectar/recuperar Vercel** y **6 Buscar actualización de la rama**.
4. Comprueba la cuenta activa que muestra Cloud Shell y selecciona el proyecto por número. Antes de crear recursos verás la cuenta, proyecto, región, commit y recursos que se crearán o actualizarán. Cancelar conserva la configuración existente.
5. El instalador construye una imagen del commit, ejecuta fixtures dentro de ella y prepara el servicio y Job aislados. No llama a modelos. Después comprueba escritura/lectura cloud, descarga firmada y entrega de cola autenticada. Una candidata que falla el build, diagnóstico cloud o health no sustituye la versión activa anterior.
6. Para conectar Vercel, autoriza su cliente oficial desde el enlace del navegador y elige el equipo/proyecto por número. Se exige el proyecto ya conectado a este repositorio. Se escriben variables `SHORTS_*` de producción y `STUDIO_ALLOWED_EMAILS` para proteger ambas secciones (U005). Se vuelve a desplegar `main` en tu página habitual para aplicar la conexión; las credenciales y el bucket de Animes se conservan.
7. Si Google aún no está activado en Firebase, el menú ofrece el enlace a su pantalla oficial. Allí selecciona Google y el correo de soporte; vuelve y elige **Comprobar de nuevo**. No debes copiar una clave, JSON ni un ID largo.
8. El resultado se guarda en nube. Si se pierde Cloud Shell, vuelve al enlace de la conversación, escribe `./c` y usa Diagnóstico o Conectar/recuperar. La opción 6 abre la actualización en otro checkout y conserva tus archivos locales.

Las dos variables existentes de Animes (cuenta de servicio y bucket) se conservan. El bucket propio de Cortos se configura en Cloud Run. No debes añadir manualmente una tercera variable de bucket en Vercel: el conector configura allí automáticamente la URL del servicio, el inicio de sesión y la activación de Cortos. Puedes elegir el mismo proyecto Google Cloud que ya usas para Animes.

Si todavía no instalaste Cortos, usa la opción 1. Para actualizar el ensamblador usa **6 Buscar actualización de la rama** y después **1 Instalar/actualizar**. Si el ensamblador ya pasó su prueba y solo falta conectar Vercel/Firebase, usa **5 Conectar/recuperar Vercel**. Cuando recibas una corrección del conector, elige **6** y después **5**: se comprueba que los cambios sean exclusivamente del conector, pruebas o documentación antes de reutilizar el ensamblador. Si cambió el código de producción, el menú pedirá actualizarlo con la opción 1. **No reinstales el ensamblador de Animes**; `i` y `setup.sh` se conservan.

Si Google rechaza la conexión, envía una captura de **Detalle de Google**. No es necesario escribir permisos, claves ni comandos largos. La conexión usa el proyecto que seleccionaste en el menú; no se amplían permisos automáticamente para sortear un rechazo.

Si una versión anterior muestra **Falló npx --yes. Código 1** después de **Acceso privado a Animes y Cortos**, actualiza con **6** y continúa con **5**. El conector corregido envía las variables individualmente: la versión fijada de Vercel CLI no serializa correctamente una lista JSON como cuerpo. Verás **Guardando configuración en Vercel** por cada variable, después **Publicando tu página** y al terminar **Cortos en tu página**. Ante otro fallo aparecerá **Detalle de Vercel**, sin claves ni valores. No uses la opción 1 para resolver este problema. La prueba local con la CLI real no sustituye comprobar la conexión y el acceso en tu cuenta.

El instalador completo aún requiere ensayo real autorizado en Cloud Shell/iPhone. Un despliegue `READY` acredita el build de Vercel; la conexión a Google se verifica por separado. La autenticación, cargas, permisos y modelos se verifican por separado. La aplicación no tiene pantalla de costes, estimadores, saldos ni reservas; consulta tu facturación directamente en Google Cloud.

## Flujo editorial implementado

La organización sigue la página de Animes:

1. **📁 Proyectos**, arriba: abrir un corto guardado, crear otro o archivar uno conservando sus archivos.
2. **Historia**, abajo: elegir género y subgéneros, añadir un concepto opcional, generar tres ideas y desarrollar/aprobar una.
3. **Personajes**: fichas y referencias visuales de personajes, lugares y objetos.
4. **Escenas**: imágenes y videos visibles, voz japonesa junto al diálogo. La pestaña **Música y efectos** conserva la música y las cargas de sonido.
5. **Exportar**: revisar el corto, sus subtítulos y la mezcla; aprobar el montaje y descargarlo. **Revisar el corto** también está disponible en Escenas.

Toca una imagen para ampliarla. Las candidatas y aprobadas se distinguen; las versiones anteriores se despliegan si las necesitas. Revisa el recurso cargado antes de aprobarlo. Si su carga falla, usa **Volver a cargar**; no regenera el recurso.

Si se guardó el proyecto pero no se pudo abrir, **Abrir historia guardada** vuelve a abrir el mismo registro. Si no se pudo confirmar el guardado, **Revisar proyectos guardados** consulta la lista sin crear otro. Ningún registro anterior se borra automáticamente. Los modelos reales todavía no se han probado en esta corrección.

Genera/aprueba primero referencias de identidad, lugares y objetos; después los planos y voces japonesas. Cada generación conserva la versión anterior. Veo exige `generateAudio:false`; el worker inspecciona la respuesta y solo expone su derivado silencioso. No hay sustitución automática de modelo/proveedor.

En Escenas → Música y efectos, cada solicitud tiene prompt, duración, perspectiva, preparación, cola y su entrada **Subir efecto**. Elige un MP3 desde Archivos. El original se conserva y el worker crea un PCM canónico con su onda y candidatos de ataque. Tras una interrupción, vuelve a seleccionar el mismo archivo para recuperar la sesión de carga. Si la sesión venció, se recupera el mismo destino y se reinicia únicamente la transferencia; no se duplican el recurso ni la solicitud. Esto requiere ensayo real desde iPhone.

## Corregir un sonido

1. Abre **Ajustar sincronización** en su solicitud. La IA de análisis no es necesaria para los controles manuales.
2. Carga los fotogramas indexados de la toma. Usa **← Fotograma / Fotograma →** y **El sonido debe coincidir aquí** en el contacto visible.
3. En la onda selecciona el ataque interno y pulsa **Este es el golpe**. El cero del archivo no se supone equivalente al ataque.
4. Ajusta un fotograma antes/después, ganancia y recortes. A 24 FPS cada paso mueve exactamente 2.000 muestras a 48 kHz. No recortes el ataque ni la cola sin una decisión editorial.
5. Pulsa **Probar ajuste**. Se obtiene un MP4 muxado; no se arrancan dos reproductores separados. **Comparar anterior/candidata** alterna archivos; **Deshacer** recupera el ajuste previo.
6. Escucha y pulsa **Aprobar y fijar**. El análisis automático no puede sobrescribirlo. Una dependencia cambiada obliga a revisar su uso; conserva el material y aprobación históricos.

La extracción usa el mismo compositor para Veo, ilustración y cámara. Cambiar la edición visual exige revisar su ancla. Si hay varios contactos, elige el número y descripción correctos antes del análisis fino. En Escenas → Escenas y voces → un plano → Movimiento y capas puedes editar la cámara o aplicar variantes aprobadas dentro de una región rectangular. La revisión visual en Chrome de un ancho móvil no sustituye las pruebas reales de Safari/iPhone. **Corregir sonido con IA** pide el cambio concreto y analiza la composición visual efectiva. El botón de IA tiene intentos limitados; no sustituye al ajuste manual.

## Preview, exportación y recuperación

Pulsa **Preparar vista previa**: la aplicación compila y prepara el MP4 automáticamente. Escúchalo y pasa a **Exportar → Aprobar y exportar**. Si el material cambió, pide una nueva preview antes de exportar. Puede contener negros provisionales claramente marcados mientras faltan recursos; el final los bloquea. Las previews y el final usan el mismo compilador, manifiesto y mezcla de programa. La política opcional de sonoridad/ducking se aprueba antes de recompilar.

La exportación produce MP4 con subtítulos, MP4 limpio, SRT/ASS, manifiesto, informe y stems. Un render fallido no borra el anterior. La revisión lingüística, legibilidad y boca visible necesitan revisión humana; no se garantiza continuidad perfecta ni lip sync mediante prompts.

Si un envío queda **desconocido**, no repitas a ciegas: el proveedor puede haberlo aceptado y facturado. El sistema conserva el registro del envío. Pausar frena despachos futuros; no promete cancelar cobros ya aceptados. El diagnóstico del menú no genera material.

## Edición manual y subtítulos

En Guion y biblias, pulsa **Editar manualmente**, cambia los campos, **Revisar cambios** y **Guardar candidata**. Verás los recursos afectados antes de guardar; aprueba después la candidata. En **Subtítulos** puedes cambiar español, dividir bloques y marcar inicio/fin mientras escuchas la voz definitiva. Las advertencias de lectura requieren corregir el bloque o justificar una excepción. Cambiar la voz conserva la corrección anterior y solicita revisión.

En Escenas → Actividad, **Continuar** reencola trabajo no despachado o consulta una operación conocida; **Comprobar estado** consulta Cloud Run sin generar. Un envío incierto nunca se repite con ese botón.

## Lotes, versiones e importación

**Generar pendientes / continuar lote** recupera las tareas pendientes de esa historia. Conserva aprobados y candidatas; se detiene cuando debes revisar una referencia. Al volver, consulta el mismo lote. Detener o perder el lease impide nuevos despachos; lo ya aceptado puede terminar. Una tarea desconocida exige diagnóstico, sin reenvío automático.

**Usar esta versión aprobada** recupera un archivo anterior sin borrar el nuevo. **Importar referencia o música de otra historia** requiere elegir origen, recurso y destino; crea una copia propia con procedencia, nunca un enlace compartido implícito. Revisa la candidata de biblia y el archivo antes de activarlos.

## Variantes y boca limitada

En **Movimiento y capas**, genera solo la variante que necesitas (por ejemplo, boca abierta conservando el encuadre), apruébala y selecciona la región. Ajusta sus límites en porcentaje y su intervalo en fotogramas. Puedes vincularla a la actividad medida de una voz aprobada para alternar apertura/cierre. No es sincronía fonética y debes revisar sus bordes, expresión y ritmo en **Preview de toma**. Un cambio de voz exige revisar esa vinculación. **Preview de escena** reúne las tomas de la misma unidad dramática, con mezcla muxada.

Las pausas se editan en Guion y biblias: acción inicial/final y pausa antes/después de cada voz. El planner usa la duración PCM real y solo los márgenes aprobados. Si no cabe, pide revisar la toma; no acelera el diálogo ni repite clips.


## Entrada privada para Animes y Cortos (U005)

La misma cuenta de Google abre ambas secciones. Otra cuenta no puede generar aunque conozca la dirección de la página. Salir cierra la sesión de toda la herramienta. No se cambian tus proyectos, bucket de Animes ni credenciales de los generadores.

Mientras Firebase esté pendiente, la página mostrará que falta conectar el acceso privado y bloqueará las generaciones. Después de resolver la activación/permisos de Firebase, recupera la carpeta existente de Cloud Shell, escribe `./c`, elige **6** para actualizar y **5** para conectar/recuperar Vercel. Confirma tu misma cuenta y proyecto habituales. El instalador escribe la configuración automáticamente; no copies JSON ni claves. Una actualización de acceso/web compatible conserva el ensamblador ya instalado.

Verifica desde tu iPhone que puedes entrar a Animes y Cortos con tu cuenta, salir y que una ventana privada no permite generar. No ejecutes una generación solo para comprobar el inicio de sesión. La opción de diagnóstico y las pruebas de acceso no generan medios pagados.
