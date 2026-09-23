# Línea base y decisiones

Estado vigente: [decisiones posteriores del usuario](user-overrides.md). Los apartados anteriores al cierre de simplificación son un registro histórico; sus menciones a estimaciones ya no describen el código actual.

HEAD inspeccionado: `958248ec2fe90fb4a2b0b5004d2a53642a274995`.
Rama: `feature/cortos-anime-v2`. Checkout inicial limpio. Contrato completo leído: 31 secciones y A001–A100.

## Evidencia inicial
`node tests/static-check.mjs`: código 0; log completo en baseline.log.
`bash -n setup.sh worker/montage/runner.sh i`: código 0.
No package.json ni tests de render decodificado en HEAD. El chequeo existente parsea JS, compila un script de montaje y verifica contratos por cadenas: no demuestra producción con APIs ni render real.

## Componentes
- index.html: aplicación monolítica; proyectos y medios en GCS mediante upload-url. Conservar motor, preferencias, modos, duraciones y scripts.
- api/_lib/gcp.js: credenciales y firma ligadas a configuración Animes. No reutilizar configuración mutable para Cortos.
- api/assemble.js: acepta script, descargas y hoja; lanza Job con TRABAJO/PREFIJO/SALIDA. Conservar contrato íntegro.
- worker/montage: descarga y ejecuta montar.sh; carpeta compartida /work, imagen base mutable. No apto para manifiestos estructurados nuevos.
- setup.sh/i: instalador previo, claves opcionales y Job propio. Mantener byte a byte.
- README difiere del código: afirma solo Chirp, pero audio/voices y pruebas contienen Gemini. Autoridad: código, no esa afirmación.

## Decisión
Worker y servicio Cortos aislados; manifiesto declarativo, FFmpeg sin shell. Nueva UI estática modular: no imponer React ni build destructivo sobre la raíz. API nueva sin importar configuración Animes. Colecciones y bucket/prefijo exclusivos, identidad administrada en Cloud Run, autenticación de usuario validada por servidor.

## Riesgos y verificación
Rutas Vercel: comprobar raíz y /cortos/; enlace aditivo en Animes. Pruebas previas se conservan. Nada de migraciones. Configuración preview separada y servicio desactivado si falta; no fallback a credenciales/bucket anteriores. Audio Veo siempre false, cuarentena y derivado silencioso. APIs de pago y despliegues GCP no ejecutados durante desarrollo.

## Verificación multimedia inicial
27 tests de contratos y medios pasaron (25,756 s, FFmpeg local). Se renderizó y decodificó un programa sintético de 7200 frames, mezcla PCM de 14.400.000 muestras; ataque del MP3 y contacto visual comparados con preview de cinco segundos. Eso no equivale a una prueba con Veo/Gemini/Lyria reales.

## Avance verificable de la rama

Suite ampliada anterior: 46 pruebas Python, todas correctas. Suite multimedia adicional: 9 pruebas FFmpeg, todas correctas (79,816 s), incluida mezcla con ducking/normalización de programa repetida con checksum idéntico. Gateway: 4 pruebas Node correctas. Regresión estática original y comparación de scripts/API/instaladores antiguos correctas. Suite consolidada final local: **50 pruebas Python correctas en 88,291 s**, sin skips; log en `fixtures.log`.

La revisión inicial detectó y corrigió dependencia excesiva del ID de guion: ahora firmas de contenido conservan referencias/imágenes al cambiar solo la voz/traducción. Aprobaciones nuevas invalidan usos dependientes y no destruyen archivos anteriores. El payload Veo no acepta cambiar audio desde frontend. El worker rechaza playlists disfrazadas de MP3 y enlaces simbólicos.

Ninguna generación pagada ni cambio GCP/producción realizado. No se ha construido la imagen Docker en esta máquina (no hay daemon). Instalador/conector probados parcialmente con transportes simulados; no equivale a Cloud Shell real. El navegador local bloqueó localhost; la revisión visual se hará contra la preview remota si está disponible.

## Trabajo aún abierto (sin reducir el contrato)

La [matriz A001–A100](acceptance.md) mantiene todos los requisitos abiertos hasta su aceptación. Las áreas añadidas en esta revisión incluyen importación explícita, cámara y máscaras rectangulares, actividad de boca limitada, elección de contacto, alcance estricto de correcciones, lote de pendientes y planificación de pausas. Tienen código integrado y cobertura parcial con fixtures. No se consideran aceptadas sin recorrido cloud/móvil y comprobación con material real. Debe revisarse la experiencia completa y resolverse lo que revelen esas pruebas; no se reduce el contrato.

También faltan build/instalación/rollback en GCP, pruebas IAM/Firestore/cargas desde iPhone, exportación de proyecto Animes representativo y las dos producciones reales autorizadas de géneros diferentes. Las pruebas sintéticas no cubren la calidad emocional ni continuidad visual o vocal de los modelos. Esta rama no debe fusionarse ni activarse en producción todavía.

## Preview y límite de funciones

La rama fue publicada y se abrió la PR #20. El primer deployment de preview `dpl_AGsfuKmzWkFNWA6A4KAHLDCaEnto` falló con `exceeded_serverless_functions_per_deployment`: límite real de 12 funciones en el plan Hobby. Se sustituyó exclusivamente el gateway nuevo por Routing Middleware limitado a `/api/shorts`; las 12 funciones heredadas permanecen byte a byte intactas. Regresión original, cuatro pruebas del gateway y comparación legacy pasan tras el cambio. No se cambió el plan ni producción.

## Segundo cierre de integración

72 tests Python correctos (86,685 s) y SHA-256 incremental contrastado con Node crypto en límites de bloque y archivos grandes. Nuevas pruebas cubren conciliación conservadora, cuotas de llamadas, concurrencia de workers, cambios manuales, subtítulos y hash de preview. El instalador conserva/restaura la revisión anterior también si falla la conexión posterior a activarla; el diagnóstico compara commit real. Un self-test cloud escribe/lee/borra un registro y objeto de diagnóstico con la identidad del worker, sin llamar a modelos; todavía no ejecutado en GCP.

Preview anterior `6ec4150` confirmó READY en Vercel. Cortos cargó su HTML/JS y mostró honestamente la falta de servicio configurado. El enlace a Animes en el navegador de prueba encontró la protección de Vercel; no se desactivó. CI de Animes y Cortos pasó para ese commit.

## Tercer cierre de integración

El nuevo bloque añade recuperación de cargas vencidas, lotes conservadores, importación con copia, variantes regionales, boca por actividad vocal, selección del segundo contacto, pausas explícitas, recuperación de aprobados y lectura paginada de recursos. Las correcciones de ideas se fusionan únicamente en el campo elegido; las de guion solo en la entidad seleccionada. La inspección del render valida también muestras decodificadas y padding AAC. El compilador pasa a 2.2.0 para separar la caché.

Referencias consultadas para reanudación: https://docs.cloud.google.com/storage/docs/resumable-uploads y https://docs.cloud.google.com/storage/docs/performing-resumable-uploads . Sesiones 404/410 se renuevan; un estado incierto no dispara otra sesión. Firebase usa popup para evitar depender del redirect entre dominios bloqueado por Safari: https://firebase.google.com/docs/auth/web/redirect-best-practices .

No se ejecutó Docker/GCP ni producción pagada. Las decisiones de cuenta/proyecto y autorización de costes siguen siendo necesarias para probar la instalación real. La aceptación A097/A098 requiere dos producciones revisadas, no videos sintéticos.

Suite consolidada de este bloque: **90 pruebas Python correctas en 91,029 s**, sin skips (`fixtures.log`). Cinco pruebas Node (gateway/checksum), regresión original y comparación byte a byte de Animes también pasan.

## Revisión de instalación y sonido

El análisis localizado usa la composición efectiva también para cámara/capas. Las propuestas y contadores de análisis quedan fuera de la huella de un ajuste manual fijado; cambiar la solicitud sí marca revisión pendiente. Las selecciones explícitas de versiones se respetan también en la UI, que agrupa voces/visuales por toma y música en Sonido.

Se corrigió actAs de Cloud Tasks y se separó la cuenta de build. Antes de activar se ejecutarán lecturas/escrituras reales, descarga firmada y entrega de cola OIDC de diagnóstico; esta autoprueba está implementada pero NO ejecutada en GCP. Se rechazan recursos ajenos antes de adoptarlos. El menú desglosa costes y pide autorización antes de crear/modificar recursos.

En preview 3de1942 se comprobó raíz → Cortos → raíz y el enlace de instalación con repo/rama. La interfaz Animes muestra sus modos originales; su autosave acusa GCS_OUTPUT_BUCKET ausente en ese entorno preview. No se copiaron variables ni recursos de producción. Esto no verifica exportación de Animes ni funcionamiento en Safari/iPhone.

Suite consolidada tras esta revisión: **94 pruebas Python correctas en 108,650 s**, sin skips; cinco pruebas Node y regresión original correctas. `fixtures.log` contiene la salida completa; los tests de instalador se repitieron tras ajustar el orden de creación del bucket y la identidad (12 correctos).

## Cierre de simplificación solicitado por el usuario

Reanudación sobre HEAD real `b5844747fab306a01a8efe8c2b755fe5c2cdf019`, igual al remoto de la rama. Antes de editar: 94 tests Python correctos, contratos originales y comparación de Animes correctos. Se confirmó acceso autenticado al repositorio. El contrato se había leído íntegro; U001/U002 documentan las modificaciones posteriores del usuario.

Se retiró el subsistema monetario, incluyendo sus rutas y condiciones de despacho. El diario de solicitudes mantiene controles de entrada, modelos/regiones, lease y no duplicación. La recuperación de una operación conocida no depende de dinero. Las pruebas antiguas de precios se sustituyeron por comprobaciones acordes a la eliminación solicitada; no se quitó ninguna prueba heredada de Animes.

La UI se separó en bootstrap Firebase, estudio y funciones de presentación. Las cinco áreas muestran acciones contextuales y esconden historial/ajustes secundarios tras desplegables. Se mantienen aprobaciones ligadas al material, candidatos, edición de guion, importación, lotes, sincronización manual, subtítulos y exportación. Se corrigió además la selección explícita de versiones de voz en el editor de subtítulos.

Verificación local: 98 tests Python correctos en 120,812 s, sin skips; cinco recorridos DOM de interfaz con transporte sintético explícito. El recorrido incluye tres ideas, elegir/desarrollar/aprobar, revisar candidata, ajuste manual sin IA y subtítulos → preview automática → exportar. Las páginas `tests/shorts/ui/preview.html` y `frame.html` están rotuladas como pruebas sintéticas y no aparecen en la navegación del producto. No se presentan como servicio funcional.

Riesgos pendientes: build/rollback GCP e IAM reales, acceso a modelos, calidad de guion/continuidad, cargas y reproducción en Safari/iPhone, y exportación representativa de Animes. El contrato de 100 aceptaciones sigue trazado, con A034/A077 sustituidos por orden del usuario. La publicación/CI y revisión visual del nuevo commit se registran en la PR tras existir.

## Revisión de preview tras simplificación

Commit publicado `4e0bf930f4659305747eef7470b754b7ed6e1a9a`: CI de Animes y Cortos correctos; preview `dpl_8dnFS9PfLepwLwyXPwMgjM7DDbzV` READY en el mismo proyecto Vercel. URL: https://anime-ai-studio-dl9yc8yvn-alixonveloz1-3809s-projects.vercel.app/cortos/ .

En Chrome se revisaron los recorridos de la página sintética de interfaz: guion, tomas/versiones plegadas, solicitudes de efectos, editor manual (cargar frames, elegir contacto/ataque, probar y fijar), subtítulos y exportación con sus enlaces. Contenedor de 390 px: cuerpo de 375 px con scrollbar, scrollWidth también 375; botones de navegación de 63,8 × 60 px; editor sin desbordamiento horizontal. Contenedor de 1024 px: cuerpo/scrollWidth 1009 px. No es un dispositivo Safari ni una prueba de reproducción de audio de los modelos: los recursos de esa página son marcadores sintéticos.

La ruta real muestra correctamente que falta conectar el ensamblador y ofrece Cloud Shell con repositorio/rama correctos. Animes carga sus modos previos y permite entrar a Cortos; no se generó ni exportó contenido en esa revisión. El único despliegue de producción continúa en el commit original `958248e`.

Dos ajustes derivados de la revisión: el guion ya aprobado ofrece continuar a Producción y deja regeneración bajo un desplegable; los tiempos de frames se muestran con tres decimales. Se repitieron los cinco recorridos DOM tras esos ajustes. CI/preview del commit siguiente se registran en la PR al finalizar.
