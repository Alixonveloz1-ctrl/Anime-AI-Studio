# Adaptación de Cortos a la interfaz de Animes — 2026-09-24

HEAD inspeccionado antes de editar: `e704f71fa045731b2dc38d23b62b3ba0d8e22b09`. Base de pruebas: 54 pruebas JavaScript aprobadas. Instrucción vigente: U010, misma organización y forma de trabajar que Animes, además de su paleta.

## Cambios y trazabilidad

| Requisito | Archivo | Prueba | Estado |
|---|---|---|---|
| Proyectos arriba y navegación inferior conocida | `cortos/index.html`, `presentation.mjs`, `style.css`, `studio.mjs` | `studio.test.mjs`: Four familiar sections; Project list stays in the header | Fixture aprobado; revisión visual real pendiente |
| Un único formulario; géneros/subgéneros de Animes | `cortos/studio.mjs` | Three overlapping mounts; Cortos includes every Animes genre/subgenre | Fixture aprobado |
| Medios directamente en las escenas, voz junto al diálogo, referencias en Personajes | `cortos/studio.mjs`, `style.css` | Scenes show image and voice players inline | Fixture aprobado; no se pagaron generaciones |
| Candidata y aprobada conservadas; fallo de imagen no oculta la escena | `cortos/studio.mjs` | Current and candidate remain visible; A media read failure stays local | Fixture aprobado |
| Solo video validado silencioso y un reproductor activo | `cortos/studio.mjs` | Only validated silent video is displayed | Fixture aprobado; contrato/worker sin cambios |
| Guardado confirmado no duplica al reintentar apertura; envío desconocido no se repite | `cortos/studio.mjs` | A saved project with a failed opening; An unknown create response | Fixture aprobado |
| Conservar ajuste manual, subtítulos, montaje y exportación | `cortos/studio.mjs` | Manual synchronization; Subtitle approval, automatic preview preparation and final export | Fixture aprobado |
| No modificar comportamiento/diseño de Animes ni su worker | Archivos originales sin cambios en esta corrección | `legacy-regression.cjs`, `static-check.mjs`, pruebas de carga y acceso | Aprobado localmente; proyecto real todavía incompleto |

## Evidencia externa y límites

Los logs anteriores muestran tres POST 201 seguidos de tres GET 412 a las 03:28–03:29 UTC. Junto con el flujo de creación anterior, esto explica registros guardados aunque su apertura falló. Las tarjetas no son historias precargadas. No se han inspeccionado sus entidades privadas individualmente ni se han borrado/archivado.

Los logs del proyecto Animes `p1789929671378` a las 03:55 UTC muestran siete personajes, cero escenas, 31 archivos de imagen y 151 referencias de imagen bajo su carpeta. Existen 48–50 versiones/copias; varias requieren restauración para poder leerlas. Estos recuentos no acreditan recuperación completa ni prueban la causa original de pérdida de metadatos. No se declara que las escenas hayan sido recuperadas.

Validación de esta corrección: **60 pruebas JavaScript con fixtures**, regresión del motor antiguo, análisis estático y matriz A001–A100. Los casos anteriores se conservan y se adaptan sus rutas de navegación; no se eliminan pruebas. Los medios sintéticos y los eventos de carga se usan solo en tests. No se confunden con pruebas reales de Safari, proveedores o calidad audiovisual.

No cambian APIs, cuenta de servicio, bucket, instaladores ni worker. Esta actualización de web no requiere reinstalar el ensamblador.
