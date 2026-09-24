# Recuperación del conector Vercel — 2026-09-24

Base inspeccionada: `94339cb5cac019b74112fc586977bd61c64efd85`, `main`, árbol limpio. Último despliegue consultado antes del cambio: `dpl_BPHeo3bVJHRuLfvW3kKbpkhiCXUf`, READY; no acredita que la conexión esté completa.

## Evidencia y causa

IMG_3317 muestra Firebase y comprobación del propietario superados, y después `Falló npx --yes. Código 1`. El runner anterior descartaba stderr de Vercel. No se dispone del cuerpo de error remoto de ese intento.

Se instaló la misma versión del paquete oficial `vercel@59.25.4`. Su implementación `Client._fetch` solo serializa objetos cuya propiedad `constructor` es `Object`. El conector le entregaba una lista raíz mediante `--input`. La prueba con ese componente real y un servidor HTTP local recibe `[object Object],…` con `text/plain`, no JSON. Un objeto individual llega como JSON íntegro con `application/json; charset=utf-8`. Es una incompatibilidad determinista en la petición usada por el conector, no un diagnóstico especulativo de permisos del usuario.

Referencias oficiales: https://vercel.com/docs/cli/api y https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables . No se cambió de versión CLI ni se añadieron flags para omitir permisos.

## Cambio y pruebas

- `infra/shorts/connect.py`: una petición JSON por variable, conserva `upsert=true`, equipo, producción y lista permitida de variables. No publica si alguna escritura falla. Captura diagnóstico seguro, limita espera y desactiva el aviso de actualización para las llamadas API. El login del usuario sigue siendo el oficial.
- `tests/shorts/test_installer.py`: contratos individuales, fichero temporal privado, rechazo preventivo de arrays, errores sin secretos, timeout y parada tras escritura fallida.
- `tests/shorts/vercel-cli-contract.mjs`: reproduce el defecto del lote antiguo y comprueba los cinco payloads del conector actual con el transporte real de la CLI fijada, contra loopback sin credenciales. Se añade a CI.
- No cambia `infra/shorts/install.py`, `i`, `setup.sh`, Animes, web, autenticación, modelos ni worker. La corrección es compatible con recuperar el worker existente mediante 6 → 5.

## Verificación local final

- Suite Python completa: **127/127**, sin omisiones, con las dependencias fijadas de `worker/montage-shorts/requirements.txt` en entorno temporal aislado. Incluye FFmpeg/FFprobe, montaje de 300 segundos, audio y API con fixtures. El primer intento sin dependencias dio siete errores de importación y cinco omisiones; se resolvió instalando los requisitos, sin modificar ni retirar pruebas.
- Subconjunto del instalador/conector: **41/41**, incluido el bloqueo de publicación tras un fallo de variables.
- Acceso privado, gateway, hash e interfaz: **23/23** pruebas Node.
- Transporte real `vercel@59.25.4` contra HTTP local: defecto antiguo reproducido y cinco escrituras corregidas verificadas.
- Contratos estáticos y regresión de Animes, sintaxis de instaladores, `git diff --check` y trazabilidad A001–A100: aprobados. La trazabilidad no equivale a aceptación funcional con proveedores reales.

## Límite de entrega

La serialización se prueba con la CLI real; las respuestas cloud de las pruebas unitarias son fixtures. No se hacen generaciones pagadas ni se escriben variables de la cuenta real desde estas pruebas. El usuario aún debe ejecutar el conector actualizado en su Cloud Shell autenticado y comprobar el inicio de sesión en ambas secciones. La aplicación no se declara lista hasta esa comprobación. La matriz A001–A100 conserva las aceptaciones pendientes.
