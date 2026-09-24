# Carga de Animes y diseño compartido — 2026-09-24

Base inspeccionada: `161e53f3c940dea28481563920ce48fd5bc85e8c` en `main`.

## Hallazgo y alcance

La página de Animes iniciaba lecturas de proyectos/medios antes de finalizar `protectPage`. En producción se observaron respuestas 401 seguidas de respuestas 200 de `/api/upload-url`; estos registros no bastan para identificar el contenido del proyecto concreto del usuario. La prueba con sesión demorada reproduce el problema en el código anterior.

Además, `loadStateFor` convertía una lectura fallida sin caché en estado vacío, `switchProject` purgaba otras copias y anunciaba éxito, y `renderAll` no esperaba las lecturas asíncronas de medios.

El arranque ahora espera a la sesión; una lectura fallida conserva el estado abierto; la copia local de emergencia no se anuncia como lectura de Google Cloud; solo se purga caché después de obtener el proyecto de nube. La confirmación espera al renderizado. No se crean proyectos vacíos cuando falla la lista de nube. No hay reintentos automáticos de generaciones.

## Diseño

`auth/studio-theme.css` y `auth/starfield.mjs` trasladan los colores, tipografías y efectos originales a Cortos/acceso. Se elimina también el verde de la onda de sonido. No se modifica el CSS original de Animes ni se añaden controles, costes o enlaces de instalación.

## Verificación

- Seis pruebas nuevas ejecutan el HTML/JavaScript real de Animes con transporte e IndexedDB sintéticos. Todas fallan con el código base anterior y pasan con la corrección: sesión demorada, proyecto preservado al fallar, caché identificada y conservada, caché malformada, lista de nube indisponible y confirmación posterior al renderizado de medios.
- 29 pruebas JavaScript pasan: 11 de acceso privado, 6 de gateway, 1 de integridad de medios, 5 de flujos de Cortos y 6 de carga de Animes.
- Comparación heredada y `tests/static-check.mjs` pasan. Las únicas excepciones nuevas de la comparación son cuatro funciones de carga cubiertas por las pruebas anteriores. Generadores, prompts, preferencias, APIs, instaladores y worker de Animes permanecen iguales.
- Las pruebas existentes del ajuste manual de sonido siguen pasando tras cambiar el color de la onda.
- La revisión visual en navegador del fixture local no se pudo completar por restricciones del navegador. Sigue pendiente confirmar el recorrido a 390 px en Safari y abrir el proyecto concreto con la cuenta del propietario. Los fixtures no se presentan como acceso real a Google.

No se ejecutan generaciones pagadas ni se cambian recursos, credenciales o buckets de Google Cloud. Este cambio de web no requiere reinstalar el ensamblador.
