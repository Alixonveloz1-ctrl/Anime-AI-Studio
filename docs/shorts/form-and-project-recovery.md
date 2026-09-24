# Formulario y lectura de proyectos — 2026-09-24

Base: `f9643e26bd7188e7e9fab498b8d289ea3c9e9862`, `main` y producción READY. El usuario confirma que la corrección anterior no resolvió la apertura de su proyecto concreto.

## Evidencia

- Peticiones de `/api/upload-url` a las 03:03–03:05 UTC devuelven 200; no se observan excepciones de servidor ni peticiones a `/api/download-url` en ese tramo. No se deduce de un 200 que el contenido del proyecto esté completo.
- La prueba de tres notificaciones de token concurrentes reproduce **3 montajes en lugar de 1** en la versión anterior. El cambio de `auth/client.mjs` mantiene una sola promesa de montaje por usuario. No se relaja la comprobación de sesión ni se reenvían generaciones.
- La interfaz anterior espera todos los medios antes de insertar el texto de personajes/escenas. Una firma fallida impide pintar la lista completa. `switchProject` además mantiene el selector de proyectos abierto hasta finalizar los medios.
- La consola de almacenamiento de Google no está disponible en este navegador y no hay una sesión autenticada de la aplicación para inspeccionar el proyecto del propietario. No se afirma haber leído/restaurado su archivo real.

## Cambios

Animes pinta primero personajes, narración y controles existentes, y carga archivos por filas con concurrencia limitada y espera acotada. Cierra el selector después de leer el proyecto, conservando una confirmación final honesta. Un archivo fallido muestra un reintento **solo de lectura** en su fila; no se regenera contenido y no se presenta como medio inexistente. Resultados tardíos no pueden pintar otra historia. Un snapshot con forma desconocida no sustituye el proyecto por un estado vacío. Los errores de red al leer caché cloud se propagan; un 404 sigue significando ausencia.

Los controles de una fila aún sin verificar quedan desactivados hasta terminar la lectura; en caso de error se ofrece volver a cargar sus archivos. Los prompts, el HTML de los controles de generación, la selección de proveedores, los contratos de API y la disposición original se conservan. La API registra solo el ID del proyecto, tipo de snapshot, presencia de universo y recuentos de personajes/escenas para poder investigar el caso real.

Cortos serializa sus redibujados y presenta un único formulario. Su catálogo incluye todas las opciones de Animes y mantiene sus opciones adicionales; Ecchi es visible. Los valores existentes de género se conservan y Donghua / Cultivación se guarda como la combinación explícita fantasía + donghua / cultivación, que el director recibe sin depender de actualizar el worker. Todos los géneros del selector se validan usando el constructor real de proyectos Python y el prompt del director.

## Pruebas y límites

36 pruebas JavaScript pasan: acceso privado (11), gateway (6), integridad de medios (1), flujos de Cortos/catálogo/concurrencia (7), montaje de sesión (1) y carga de Animes (10). La prueba de catálogo también ejecuta el contrato Python real; no contacta APIs. Pasan la regresión heredada, la validación estática y la integridad de las 100 filas de aceptación.

Casos nuevos: imagen fallida con historia visible y reintento sin generación, lectura tardía después de cambiar proyecto, error de lectura sin regeneración accidental, snapshot desconocido, tres avisos de token, tres montajes simultáneos y selección persistida de subgéneros. La apertura del archivo concreto del propietario y el recorrido completo en Safari siguen pendientes de verificación real.

No requiere reinstalar el ensamblador, no cambia buckets/credenciales, no ejecuta generaciones ni modifica la infraestructura de Google.
