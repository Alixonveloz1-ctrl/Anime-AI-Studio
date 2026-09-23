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

El instalador completo aún requiere ensayo real autorizado en Cloud Shell/iPhone. Una preview `READY` solo acredita el build de Vercel. La autenticación, cargas, permisos, tarifas y modelos se prueban por separado. Sin una tarifa conservadora verificada, el servidor bloquea la producción: no se habilita un precio ficticio para saltar este bloqueo. La tabla de tarifas todavía necesita completar su cálculo e integración; no se pide al usuario editar JSON.

## Flujo editorial implementado

Entra con Google. Crea una historia con género principal, subgéneros y concepto opcional. Autoriza un límite en Producción antes de solicitar tres ideas. Elige una, desarrolla su guion/biblias y revisa las candidatas antes de aprobarlas. Los modelos reales no se han probado todavía.

Genera/aprueba primero referencias de identidad, lugares y objetos; después los planos y voces japonesas. Cada generación conserva la versión anterior. Veo exige `generateAudio:false`; el worker inspecciona la respuesta y solo expone su derivado silencioso. No hay sustitución automática de modelo/proveedor.

En Sonido, cada solicitud tiene prompt, duración, perspectiva, preparación, cola y su entrada **Subir efecto**. Elige un MP3 desde Archivos. El original se conserva y el worker crea un PCM canónico con su onda y candidatos de ataque. Tras una interrupción, vuelve a seleccionar el mismo archivo para recuperar la sesión de carga. La reanudación real desde iPhone y la expiración de sesiones aún deben verificarse.

## Corregir un sonido

1. Abre **Ajuste manual** en su solicitud. La IA de análisis no es necesaria para los controles manuales.
2. Carga los fotogramas indexados de la toma. Usa **← Fotograma / Fotograma →** y **El sonido debe coincidir aquí** en el contacto visible.
3. En la onda selecciona el ataque interno y pulsa **Este es el golpe**. El cero del archivo no se supone equivalente al ataque.
4. Ajusta un fotograma antes/después, ganancia y recortes. A 24 FPS cada paso mueve exactamente 2.000 muestras a 48 kHz. No recortes el ataque ni la cola sin una decisión editorial.
5. Pulsa **Probar ajuste**. Se obtiene un MP4 muxado; no se arrancan dos reproductores separados. **Comparar anterior/candidata** alterna archivos; **Deshacer** recupera el ajuste previo.
6. Escucha y pulsa **Aprobar y fijar**. El análisis automático no puede sobrescribirlo. Una dependencia cambiada obliga a revisar su uso; conserva el material y aprobación históricos.

La extracción manual actual cubre tomas Veo normalizadas. Falta completar el editor de frames de cámara/capas, la elección explícita de ocurrencias múltiples y varios recorridos móviles indicados en la matriz. El botón de IA tiene intentos limitados; no sustituye al ajuste manual.

## Preview, exportación y recuperación

Compila el montaje y escucha una preview. Puede contener negros provisionales claramente marcados mientras faltan recursos; el final los bloquea. Las previews y el final usan el mismo compilador, manifiesto y mezcla de programa. La política opcional de sonoridad/ducking se aprueba antes de recompilar.

La exportación produce MP4 con subtítulos, MP4 limpio, SRT/ASS, manifiesto, informe y stems. Un render fallido no borra el anterior. La revisión lingüística, legibilidad y boca visible necesitan revisión humana; no se garantiza continuidad perfecta ni lip sync mediante prompts.

Si un envío queda **desconocido**, no repitas a ciegas: el proveedor puede haberlo aceptado y facturado. El sistema conserva la reserva. Pausar frena despachos futuros; no promete cancelar cobros ya aceptados. El diagnóstico del menú no genera material.
