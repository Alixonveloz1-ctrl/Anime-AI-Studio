# Decisiones del usuario posteriores a la especificación v2

Estas instrucciones explícitas de la conversación prevalecen sobre el documento original. El original se conserva completo en `contract-v2.txt`; no se reescribe su historia.

## U001 — eliminar por completo la función de costes

El usuario no pidió una pantalla de producción financiera y consulta su facturación directamente en Google Cloud. Solicita quitarla completamente, no esconderla.

Se eliminan precios, estimaciones, presupuestos, saldos, reservas monetarias, conciliaciones estimadas, vencimiento de tarifas, renovaciones y bloqueos por falta de saldo/tarifa. Las rutas antiguas de presupuestos responden 404. No se integra la factura de Google ni se afirma conocer un coste exacto por recurso.

A034 y A077 del documento original quedan sustituidos: el criterio vigente es ausencia de estas funciones, tanto en la interfaz como en el despacho. Las referencias a reservas/costes de otras secciones se interpretan según esta decisión. El permiso del instalador para crear recursos en una cuenta/proyecto sigue siendo necesario; muestra recursos y pide confirmación sin estimaciones monetarias. No se han autorizado generaciones pagadas ni infraestructura desde esta sesión de desarrollo.

Se conservan autenticación, propiedad, idempotencia, cancelación, concurrencia, alcance finito de la acción solicitada y protección frente a reenvíos desconocidos. Son controles de ejecución y seguridad, no presupuestos.

Código: `shorts/core/requests.py`, `jobs.py`, `recovery.py`, servicio, runner e instalador. `pricing.py` fue retirado. Las pruebas de precios se sustituyen por pruebas de eliminación y se conservan las comprobaciones de modelos, límites de entrada, duplicados, timeouts y recuperación en `test_requests.py`, `test_contracts.py`, `test_workflow.py` y `test_api.py`.

## U002 — simplificación funcional de la interfaz

Cinco áreas: Proyectos, Historia, Producción, Revisión y Exportar. Una acción principal por contexto, versiones anteriores y ajustes avanzados desplegables, separación entre tomas/voces y música/efectos. Las etiquetas muestran nombres y estados comprensibles. No se muestran JSON ni identificadores como instrucciones al usuario.

Una aprobación explícita sustituye las listas repetitivas de casillas. Preparar una preview o exportar ejecuta la compilación automáticamente. La revisión sigue ligada al material y al manifiesto exactos. El ajuste manual por fotogramas/onda, comparar, deshacer y fijar permanece accesible sin IA. No se eliminan capacidades para lograr una pantalla más sencilla.

## Evidencia y límites

La matriz conserva A001–A100 y añade `effectiveRequirement`/`override` en las filas afectadas. El comprobador sigue cotejando literalmente los cien requisitos originales. Las pruebas de interfaz usan un transporte sintético explícito separado de la aplicación real; no prueban Firebase, modelos ni calidad de medios. Las pruebas FFmpeg sí generan/decodifican medios sintéticos. La aceptación con servicios reales y Safari/iPhone sigue pendiente.
