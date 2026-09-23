# Estado de entrega — implementación en curso

Base inspeccionada: `958248ec2fe90fb4a2b0b5004d2a53642a274995`. Rama `feature/cortos-anime-v2`.

PR real: https://github.com/Alixonveloz1-ctrl/Anime-AI-Studio/pull/20 (borrador; no fusionar todavía).
Preview verificada antes de este bloque, READY para `3de194265193720d3c924ddf82502bb71e83f467`: https://anime-ai-studio-313doj2tf-alixonveloz1-3809s-projects.vercel.app/cortos/
El resultado de CI/preview del siguiente commit se registra en la PR; no se presume antes de publicarlo.

La preview muestra la sección; todavía no tiene servicio GCP/Firebase conectado. READY no demuestra un flujo de producción completo. La primera preview falló por superar 12 funciones; el gateway nuevo pasó a Routing Middleware y las funciones Animes quedaron intactas.

94 pruebas Python pasaron en 108,650 s, sin skips; log completo en `fixtures.log`. Cuatro del gateway y una de checksum incremental pasan. FFmpeg produjo y decodificó los fixtures de 300 segundos/7.200 frames/14.400.000 muestras, MP3 y preview comparada con final. Las 100 entradas de aceptación siguen trazadas individualmente; no se presentan como 100 aceptaciones aprobadas.

No se ejecutaron generaciones pagadas, despliegues GCP ni cambios en producción. Quedan implementaciones y verificaciones enumeradas en audit.md y acceptance.md; no se ha reducido el contrato.

El rechazo inicial del conector GitHub no incluyó causa ni demuestra una interrupción del usuario. La publicación se recuperó; no se pidieron tokens ni claves.

Navegación Animes → Cortos → Animes verificada en Chrome en la preview 3de1942. El entorno preview no tiene el GCS_OUTPUT_BUCKET antiguo; una exportación de Animes sigue pendiente. Ninguna prueba de Safari/iPhone, instalación GCP ni generación real se presenta como aprobada.

Para continuar con servicios reales hace falta seleccionar cuenta/proyecto y autorizar sus costes desde el menú numérico `./c`; después deben autorizarse las pruebas de modelos y comprobarse los dos cortos contractuales. No se ha fusionado esta rama.
