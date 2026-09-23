# Línea base y decisiones

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

La [matriz A001–A100](acceptance.md) mantiene todos los requisitos abiertos hasta su aceptación. Los gaps de implementación incluyen: importación explícita entre proyectos; editor de capas/máscaras; selección explícita de ocurrencias múltiples; alcance estricto de corrección IA; generación en lote con omisión de válidos; planificación completa de pausas/actuación. Costes, concurrencia, recuperación, edición manual, subtítulos, gates, omisiones y caché ahora tienen código y pruebas parciales, pero necesitan integración cloud y recorrido móvil.

También faltan build/instalación/rollback en GCP, pruebas IAM/Firestore/cargas desde iPhone, exportación de proyecto Animes representativo y las dos producciones reales autorizadas de géneros diferentes. Las pruebas sintéticas no cubren la calidad emocional ni continuidad visual o vocal de los modelos. Esta rama no debe fusionarse ni activarse en producción todavía.

## Preview y límite de funciones

La rama fue publicada y se abrió la PR #20. El primer deployment de preview `dpl_AGsfuKmzWkFNWA6A4KAHLDCaEnto` falló con `exceeded_serverless_functions_per_deployment`: límite real de 12 funciones en el plan Hobby. Se sustituyó exclusivamente el gateway nuevo por Routing Middleware limitado a `/api/shorts`; las 12 funciones heredadas permanecen byte a byte intactas. Regresión original, cuatro pruebas del gateway y comparación legacy pasan tras el cambio. No se cambió el plan ni producción.

## Segundo cierre de integración

72 tests Python correctos (86,685 s) y SHA-256 incremental contrastado con Node crypto en límites de bloque y archivos grandes. Nuevas pruebas cubren conciliación conservadora, cuotas de llamadas, concurrencia de workers, cambios manuales, subtítulos y hash de preview. El instalador conserva/restaura la revisión anterior también si falla la conexión posterior a activarla; el diagnóstico compara commit real. Un self-test cloud escribe/lee/borra un registro y objeto de diagnóstico con la identidad del worker, sin llamar a modelos; todavía no ejecutado en GCP.

Preview anterior `6ec4150` confirmó READY en Vercel. Cortos cargó su HTML/JS y mostró honestamente la falta de servicio configurado. El enlace a Animes en el navegador de prueba encontró la protección de Vercel; no se desactivó. CI de Animes y Cortos pasó para ese commit.
