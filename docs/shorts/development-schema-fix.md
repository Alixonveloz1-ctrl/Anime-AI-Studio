# Desarrollo incompleto: referencePrompt — 2026-09-24

IMG_3329 muestra `Guion y biblias · No se completó / Falta referencePrompt`.
El campo es la descripción visual para generar una referencia maestra de un
personaje, lugar u objeto. El validador ya lo exigía, pero la llamada a Gemini
solo usaba JSON mode y una descripción textual del formato, sin responseSchema.
La captura no identifica cuál de las fichas falló; no se inventó ese dato.

Se añade `shorts/service/development_schema.py`: esquema Vertex explícito de
guion y biblias, con todos sus campos requeridos, incluyendo las tres clases
de referencia. Se envía únicamente en generationConfig.responseSchema y se
quita la duplicación del formato del prompt. El modelo/región y límite de
salida siguen siendo gemini-3.1-pro-preview / global / 32768.

Se mantienen las validaciones semánticas: 7200 frames, relaciones entre IDs,
continuidad antes/después, pausas y restricciones de cámara/Veo/música. No se
rellenan descripciones faltantes con texto genérico ni se relaja la validación.

La respuesta JSON recibida se conserva antes de validar en una colección
privada `developmentDrafts` dentro del proyecto de Cortos. Un borrador
incompleto no se puede aprobar/renderizar ni reemplaza el desarrollo aprobado.
La validación fallida identifica la entidad y no desencadena otra llamada.
No se añadió una recuperación automática ni se afirmó recuperar la respuesta
de la solicitud anterior: esa versión no la guardaba antes de validar.

Pruebas: test_ideas.py cubre transporte real del adaptador con HTTP simulado,
campos requeridos de las tres biblias, persistencia de respuesta inválida con
Cloud.put_entity/entity_ref reales y Firestore simulado, ausencia de reintentos,
candidata válida tras revisión y conservación de validación temporal/continuidad.
Estas pruebas están incluidas en la puerta de validación del contenedor.

Fuente oficial consultada: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output
Google documenta responseSchema/required y advierte que estructuras complejas
pueden ser rechazadas; el contrato de la nueva petición con una API pagada
sigue pendiente. No hay fallback sin esquema ni cambio de modelo automático.

Para activar: desde ./c elegir 6 y luego 1; completar la conexión habitual a
Vercel. Una vez instalado, recargar el mismo corto y desarrollar la idea ya
elegida. La solicitud fallida anterior seguirá en el historial.
