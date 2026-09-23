# Contratos de proveedores y configuración

Revisión documental: 2026-09-23. No se hicieron llamadas de generación ni se verificó acceso de una cuenta concreta. Un test con transporte simulado solo prueba el contrato que envía nuestro código.

| Función | Modelo configurado | Endpoint / región | Estado |
|---|---|---|---|
| Dirección y análisis | `gemini-3.1-pro-preview` | Vertex `v1 … :generateContent`, `global` | Documentado; acceso/API pendiente |
| Imagen | `gemini-3.1-flash-image` | Vertex `v1 … :generateContent`, `global` | Documentado; API pendiente |
| Video | `veo-3.1-generate-001` | Vertex `v1 … :predictLongRunning` / `:fetchPredictOperation`, `us-central1` | Payload fixture, sin llamada real |
| Voz | `gemini-2.5-pro-tts` | Cloud TTS `v1/text:synthesize`, `global` | Texto japonés separado de prompt, fixture |
| Música | `lyria-3-pro-preview` | Vertex `v1beta1/projects/…/locations/global/interactions` | Contrato documental; API pendiente |
| Transcripción | Cloud Speech `speech:longrunningrecognize` | URI GCS, `ja-JP` | Envío implementado; polling/alineación aún pendientes |

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

La página de precios distingue modalidad Veo con/sin audio y publica TTS por tokens. Falta cerrar el estimador por unidades máximas, liquidación de uso real y vigencia de tarifas. `SHORTS_RATE_TABLE` queda vacío en la configuración de ejemplo; este bloqueo es intencional, no una tarifa cero ni una afirmación de ahorro. Health y CI no verifican permisos de generación pagada.
