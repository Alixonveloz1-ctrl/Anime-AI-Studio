# Actualización de permisos del bucket — 2026-09-24

La captura IMG_3325 muestra el instalador bb22f47 detenido antes del build:
`Adding a binding without specifying a condition to a policy containing conditions is prohibited in non-interactive mode`.

El propio instalador crea un permiso de lectura para la cuenta de construcción,
limitado a `build-source/`. Al actualizar, el permiso del servicio de Cortos
omitía `--condition`; gcloud exige elegir explícitamente cuando el bucket ya
tiene condiciones. El fallo no demuestra falta de permisos del propietario.

La llamada ahora incluye `--condition=None` para el permiso existente del
servicio de Cortos. Conserva el miembro, rol y bucket; no modifica el permiso
condicionado de construcción, no reemplaza la política completa y no toca Animes.

Referencia oficial: https://cloud.google.com/sdk/gcloud/reference/storage/buckets/add-iam-policy-binding

| Requisito | Archivo | Prueba | Estado |
| --- | --- | --- | --- |
| A093 actualizar instalación existente | infra/shorts/install.py | test_A093_update_bucket_with_existing_conditional_builder_binding | Fixture: reproduce el fallo anterior y pasa con la corrección; dos actualizaciones preservan ambos permisos sin duplicarlos |
| A089 conservar versión activa | infra/shorts/install.py | misma prueba y pruebas de rollback de test_installer.py | Fixture: no activa una versión antes del build |

Verificación: 42 pruebas del instalador/conector aprobadas. No se ejecutó una
instalación real en Google desde esta sesión; esa validación sigue pendiente.

Desde el menú que ya está abierto: escribir **6**, Enter; cuando aparezca el
menú actualizado, escribir **1**, Enter. Seleccionar el proyecto habitual y
autorizar la actualización. No hace falta volver a clonar ni editar comandos.
