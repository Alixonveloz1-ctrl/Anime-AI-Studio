# Contratos de proveedores y configuración

Revisión documental: 2026-09-23. No se hicieron llamadas de generación ni se verificó acceso de una cuenta concreta. Un test con transporte simulado solo prueba el contrato que envía nuestro código.

| Función | Modelo configurado | Endpoint / región | Estado |
|---|---|---|---|
| Dirección y análisis | `gemini-3.1-pro-preview` | Vertex `v1 … :generateContent`, `global` | Documentado; acceso/API pendiente |
| Imagen | `gemini-3.1-flash-image` | Vertex `v1 … :generateContent`, `global` | Documentado; API pendiente |
| Video | `veo-3.1-generate-001` | Vertex `v1 … :predictLongRunning` / `:fetchPredictOperation`, `us-central1` | Payload fixture, sin llamada real |
| Voz | `gemini-2.5-pro-tts` | Cloud TTS `v1/text:synthesize`, `global` | Texto japonés separado de prompt, fixture |
| Música | `lyria-3-pro-preview` | Vertex `v1beta1/projects/…/locations/global/interactions` | Contrato documental; API pendiente |
| Transcripción | Cloud Speech `speech:longrunningrecognize` | URI GCS, `ja-JP` | Envío/polling y propuesta de marcas implementados; API real pendiente |

Veo usa imagen aprobada, 4/6/8 segundos, un resultado, 720p y `generateAudio:false` fijado en servidor. El original permanece inaccesible a previews/finales; un derivado normalizado pasa FFprobe y se vuelve a comprobar antes del montaje. No se admite cambiar esa opción para resolver un error del proveedor.

Lyria devuelve una pieza independiente. El prompt instrumental requiere escucha; no garantiza ausencia de letra. La documentación del modelo limita una pieza a 184 segundos. El montaje puede reutilizar un archivo a través de cortes y exige cobertura real; no inventa una extensión idéntica para llegar a 300 segundos.

El servidor conserva una reserva al producirse un timeout o error de resultado desconocido. No cambia modelo, región o proveedor automáticamente. Los fallos recuperables con `operationName` se distinguen de los envíos inciertos sin identificador.

## Fuentes oficiales consultadas

- [Gemini 3.1 Pro](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-pro)
- [Gemini 3.1 Flash Image](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image)
- [Veo 3.1](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate)
- [Gemini TTS](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)
- [Lyria 3](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3)
- [Precios de Vertex/Agent Platform](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- [Precios de Cloud TTS](https://cloud.google.com/text-to-speech/pricing)
- [Firebase Management: configuración](https://firebase.google.com/docs/projects/api/workflow_set-up-and-manage-project)
- [Vercel: variables por rama](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables)
- [Vercel: creación de preview](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)

La página de precios distingue modalidad Veo con/sin audio y publica TTS por tokens. El catálogo instalado incluye reservas conservadoras, conciliación y vigencia; una configuración sin tarifa válida bloquea la generación. Health y CI no verifican acceso a modelos ni cargos reales.

## Tarifas y registro de consumo (2026-09-23)

`shorts/core/pricing.py` incluye precios fechados y vencimiento. Reserva límites de entrada/salida verificados antes del envío, dos llamadas donde hay generación + revisión/análisis fino, y un worker de 2 CPU / 4 GiB / máximo 3600 s. No presupone descuentos ni créditos. Veo reserva ocho unidades de la modalidad sin audio de la tabla pública ($0.20/count); esta lectura conservadora se registra sin prometer una factura exacta por clip. El acceso/cargo real debe verificarse con una prueba autorizada.

Fuentes: https://cloud.google.com/vertex-ai/generative-ai/pricing ; https://cloud.google.com/text-to-speech/pricing ; https://cloud.google.com/text-to-speech/docs/gemini-tts ; https://cloud.google.com/speech-to-text/pricing ; https://cloud.google.com/run/pricing .

Speech v1 convierte copia de trabajo a mono PCM16, guarda el ID y consulta GET /v1/operations/{name}; conserva marcas como propuesta y no sobrescribe subtítulos manuales. Referencia: https://docs.cloud.google.com/speech-to-text/docs/v1/async-time-offsets . Sin prueba API pagada todavía.

## Instalador y permisos verificados documentalmente

El build fija `E2_STANDARD_2`, timeout de 1.800 segundos y cuenta de servicio dedicada. El menú muestra USD 0,006/min (hasta 0,18 por build) y USD 0,000044/s para el Job de 2 CPU/4 GiB (hasta 0,1584 por intento de 1 h). Son techos de cómputo bajo las tarifas consultadas el 2026-09-23, no un límite de la factura: servicio, datos, imágenes y transferencias se añaden según uso. No se asumen créditos.

Fuentes oficiales: https://cloud.google.com/build/pricing ; https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.builds#machinetype ; https://cloud.google.com/run/pricing ; https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts ; https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks . Cloud Tasks exige actAs además de la firma; el instalador concede ServiceAccountUser solo sobre la identidad propia y verifica una entrega OIDC de diagnóstico. El builder puede escribir el repositorio Docker propio, leer objetos build-source y emitir logs; no usa la identidad del runtime.
