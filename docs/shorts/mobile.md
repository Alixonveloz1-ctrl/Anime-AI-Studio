# Cortos desde el iPhone — guía de la rama de desarrollo

La sección está en `/cortos/`, dentro del mismo repositorio y proyecto Vercel. La implementación sigue en desarrollo: no está lista para producción ni equivale a 100 pruebas aceptadas. Consulta [la matriz completa](acceptance.md) y [la auditoría](audit.md).

## Instalación y actualización

1. Pulsa **Instalación y estado → Abrir instalador de Cortos en Cloud Shell**. El enlace incluye el repositorio y la rama `feature/cortos-anime-v2`.
2. En la terminal escribe solamente `./c`. Si el sistema no permite ejecutarlo directamente, escribe `bash c`.
3. El menú ofrece **1 Instalar/actualizar**, **2 Diagnóstico**, **3 Restaurar versión anterior**, **4 Salir**, **5 Conectar/recuperar Vercel** y **6 Buscar actualización de la rama**.
4. Selecciona cuenta/proyecto por número. Antes de crear recursos verás el proyecto, región, commit y aviso de costes. Cancelar conserva la configuración existente.
5. El instalador construye una imagen del commit, ejecuta fixtures dentro de ella y prepara el servicio y Job aislados. No llama a modelos. Una candidata que falla el build o health no sustituye la versión activa anterior.
6. Para conectar Vercel, autoriza su cliente oficial desde el enlace del navegador y elige el equipo/proyecto por número. Se exige el proyecto ya conectado a este repositorio. Solo se escriben variables `SHORTS_*` de esta rama de preview.
7. Si Google aún no está activado en Firebase, el menú ofrece el enlace a su pantalla oficial. Allí selecciona Google y el correo de soporte; vuelve y elige **Comprobar de nuevo**. No debes copiar una clave, JSON ni un ID largo.
8. El resultado se guarda en nube. Si se pierde Cloud Shell, vuelve al botón, escribe `./c` y usa Diagnóstico o Conectar/recuperar. La opción 6 abre la actualización en otro checkout y conserva tus archivos locales.

El instalador completo aún requiere ensayo real autorizado en Cloud Shell/iPhone. Una preview `READY` solo acredita el build de Vercel. La autenticación, cargas, permisos, tarifas y modelos se prueban por separado. Sin una tarifa conservadora verificada, el servidor bloquea la producción: no se habilita un precio ficticio para saltar este bloqueo. Las tarifas se incluyen con fecha y vencimiento; generación y worker se muestran por separado. La conciliación usa tokens/duración observados cuando están disponibles y conserva un techo en los demás casos. Almacenamiento, transferencia, hosting y builds no equivalen al contador de la app. No debes editar JSON.

## Flujo editorial implementado

Entra con Google. Crea una historia con género principal, subgéneros y concepto opcional. Autoriza un límite en Producción antes de solicitar tres ideas. Elige una, desarrolla su guion/biblias y revisa las candidatas antes de aprobarlas. Los modelos reales no se han probado todavía.

Genera/aprueba primero referencias de identidad, lugares y objetos; después los planos y voces japonesas. Cada generación conserva la versión anterior. Veo exige `generateAudio:false`; el worker inspecciona la respuesta y solo expone su derivado silencioso. No hay sustitución automática de modelo/proveedor.

En Sonido, cada solicitud tiene prompt, duración, perspectiva, preparación, cola y su entrada **Subir efecto**. Elige un MP3 desde Archivos. El original se conserva y el worker crea un PCM canónico con su onda y candidatos de ataque. Tras una interrupción, vuelve a seleccionar el mismo archivo para recuperar la sesión de carga. Si la sesión venció, se recupera el mismo destino y se reinicia únicamente la transferencia; no se duplican el recurso ni la solicitud. Esto requiere ensayo real desde iPhone.

## Corregir un sonido

1. Abre **Ajuste manual** en su solicitud. La IA de análisis no es necesaria para los controles manuales.
2. Carga los fotogramas indexados de la toma. Usa **← Fotograma / Fotograma →** y **El sonido debe coincidir aquí** en el contacto visible.
3. En la onda selecciona el ataque interno y pulsa **Este es el golpe**. El cero del archivo no se supone equivalente al ataque.
4. Ajusta un fotograma antes/después, ganancia y recortes. A 24 FPS cada paso mueve exactamente 2.000 muestras a 48 kHz. No recortes el ataque ni la cola sin una decisión editorial.
5. Pulsa **Probar ajuste**. Se obtiene un MP4 muxado; no se arrancan dos reproductores separados. **Comparar anterior/candidata** alterna archivos; **Deshacer** recupera el ajuste previo.
6. Escucha y pulsa **Aprobar y fijar**. El análisis automático no puede sobrescribirlo. Una dependencia cambiada obliga a revisar su uso; conserva el material y aprobación históricos.

La extracción usa el mismo compositor para Veo, ilustración y cámara. Cambiar la edición visual exige revisar su ancla. Si hay varios contactos, elige el número y descripción correctos antes del análisis fino. En Tomas → Movimiento y capas puedes editar la cámara o aplicar variantes aprobadas dentro de una región rectangular. Los recorridos móviles siguen pendientes de verificación. El botón de IA tiene intentos limitados; no sustituye al ajuste manual.

## Preview, exportación y recuperación

Compila el montaje y escucha una preview. Puede contener negros provisionales claramente marcados mientras faltan recursos; el final los bloquea. Las previews y el final usan el mismo compilador, manifiesto y mezcla de programa. La política opcional de sonoridad/ducking se aprueba antes de recompilar.

La exportación produce MP4 con subtítulos, MP4 limpio, SRT/ASS, manifiesto, informe y stems. Un render fallido no borra el anterior. La revisión lingüística, legibilidad y boca visible necesitan revisión humana; no se garantiza continuidad perfecta ni lip sync mediante prompts.

Si un envío queda **desconocido**, no repitas a ciegas: el proveedor puede haberlo aceptado y facturado. El sistema conserva la reserva. Pausar frena despachos futuros; no promete cancelar cobros ya aceptados. El diagnóstico del menú no genera material.

## Edición manual y subtítulos

En Guion y biblias, pulsa **Editar manualmente**, cambia los campos, **Revisar cambios** y **Guardar candidata**. Verás los recursos afectados antes de guardar; aprueba después la candidata. En **Subtítulos** puedes cambiar español, dividir bloques y marcar inicio/fin mientras escuchas la voz definitiva. Las advertencias de lectura requieren corregir el bloque o justificar una excepción. Cambiar la voz conserva la corrección anterior y solicita revisión.

En Producción, **Recuperar pendiente** reencola trabajo no despachado o consulta una operación conocida; **Diagnosticar ejecución** consulta Cloud Run sin generar. Un envío incierto nunca se repite con ese botón.

## Lotes, versiones e importación

**Generar pendientes / continuar lote** muestra cantidad y reserva máxima. Conserva aprobados y candidatas; se detiene cuando debes revisar una referencia. Al volver, consulta el mismo lote. Detener o perder el lease impide nuevos despachos; lo ya aceptado puede terminar. Una tarea desconocida exige diagnóstico, sin reenvío automático.

**Usar esta versión aprobada** recupera un archivo anterior sin borrar el nuevo. **Importar referencia o música de otra historia** requiere elegir origen, recurso y destino; crea una copia propia con procedencia, nunca un enlace compartido implícito. Revisa la candidata de biblia y el archivo antes de activarlos.

## Variantes y boca limitada

En **Movimiento y capas**, genera solo la variante que necesitas (por ejemplo, boca abierta conservando el encuadre), apruébala y selecciona la región. Ajusta sus límites en porcentaje y su intervalo en fotogramas. Puedes vincularla a la actividad medida de una voz aprobada para alternar apertura/cierre. No es sincronía fonética y debes revisar sus bordes, expresión y ritmo en **Preview de toma**. Un cambio de voz exige revisar esa vinculación. **Preview de escena** reúne las tomas de la misma unidad dramática, con mezcla muxada.

Las pausas se editan en Guion y biblias: acción inicial/final y pausa antes/después de cada voz. El planner usa la duración PCM real y solo los márgenes aprobados. Si no cabe, pide revisar la toma; no acelera el diálogo ni repite clips.
