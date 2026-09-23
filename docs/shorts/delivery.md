# Estado de entrega — rama de preview

Base Animes inspeccionada: `958248ec2fe90fb4a2b0b5004d2a53642a274995`. Esta etapa partió del HEAD publicado `b5844747fab306a01a8efe8c2b755fe5c2cdf019`, en `feature/cortos-anime-v2`.

PR real: https://github.com/Alixonveloz1-ctrl/Anime-AI-Studio/pull/20 (borrador; no fusionar todavía). La PR registra commit, CI y preview comprobados después de cada publicación. No se presume READY antes de que exista.

Se aplicaron [las decisiones posteriores del usuario](user-overrides.md): eliminación completa del subsistema monetario y simplificación funcional en cinco áreas. El código de Animes, sus APIs, `i` y `setup.sh` se conservan. Cortos tiene servicio y ensamblador aislados.

98 pruebas Python correctas en 120,812 s, sin skips (`fixtures.log`), incluyendo FFmpeg y servicio. Los cinco recorridos DOM (`ui-fixtures.log`) usan un backend sintético explícito; no llaman a Google. Se comprueban separadamente gateway/checksum y regresión heredada. FFmpeg produce y decodifica medios sintéticos de 300 segundos/7.200 frames/14.400.000 muestras, MP3 y previews comparadas con el final. La matriz conserva cien requisitos trazados; no equivale a cien aceptaciones aprobadas.

La preview todavía necesita servicio GCP/Firebase conectado. READY demuestra el build web, no un flujo de producción con modelos. No se realizaron generaciones pagadas, cambios GCP ni despliegues de producción. Safari/iPhone, instalación/rollback cloud, permisos/cargas reales y dos cortos con modelos siguen pendientes de aceptación. En la preview falta también el GCS_OUTPUT_BUCKET de Animes; no se copian recursos de producción para probarlo.

Para conectar servicios, sigue [la guía móvil](mobile.md): **Ajustes → Cloud Shell → `./c` → 1**. Si ya instalaste Cortos, primero **6 Buscar actualización** y después **1 Instalar/actualizar**. Esta etapa cambió el backend, así que actualizar solo la web no basta. No reinstales Animes. El menú permite seleccionar y autorizar cuenta/proyecto/recursos; la instalación no llama a modelos.

Después de conectar y verificar el ensamblador, quedan las pruebas reales autorizadas de los modelos y de los dos cortos contractuales. La rama no debe activarse en producción antes de resolver esos resultados.
