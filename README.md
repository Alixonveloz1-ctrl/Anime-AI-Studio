# Anime AI Studio · Your Name Edition

Estudio de generación de anime cinematográfico. Genera universos narrativos, personajes, episodios de 5 a 16 minutos, imágenes, voces, música y clips de video — y exporta todo el material listo para montar.

## Pipeline

|Paso             |Servicio                                                   |
|-----------------|-----------------------------------------------------------|
|Guión y narrativa|Gemini 3.1 Pro (`/api/script`)                             |
|Imágenes         |Gemini Image — 2.5 Flash / 3.1 Flash / 3 Pro (`/api/image`) |
|Voces            |Gemini TTS / Cloud TTS Neural2-WaveNet (`/api/audio`)       |
|Música           |Lyria (`/api/music`) — una pista instrumental por acto      |
|Dirección        |Director creativo: biblia de serie, nota por capítulo, música|
|Clips de video   |Veo 3.1 (`/api/video-start` + `/api/video-status`)          |
|Subtítulos       |Alineados al audio real de cada escena (`/api/transcribe`)   |

## Características

- Duración configurable: 15 / 24 / 36 / 48 escenas (~5 a ~16 min), 3 imágenes por escena
- Los episodios largos se escriben acto por acto, encadenando el texto ya escrito
- Multi-episodio con continuidad de personajes y escenarios
- Escenarios extraídos de la historia y reutilizados entre episodios
- Formato 9:16 vertical o 16:9 widescreen
- Persistencia en localStorage + IndexedDB
- Export ZIP: imágenes, videos, audios, música, subtítulos .srt y la dirección creativa

> **Ensamblaje final:** el montaje del MP4 todavía no está en la app — el ZIP entrega todas las piezas ya sincronizadas para montarlas en un editor. Ver "Estado" al final.

## Uso

1. Configura las dos variables de entorno en Vercel (ver más abajo)
1. Elige demografía, género principal y subgéneros → Genera Universo
1. Genera Episodio (personajes + historia + escenas)
1. Genera las imágenes de las escenas
1. Genera las voces
1. Genera la música del episodio (una pista por acto)
1. Exporta el ZIP con todo

## Director creativo

Cada proyecto lo dirige un director creativo especializado en anime, que trabaja en tres niveles:

1. **Biblia de serie** — se escribe al crear el universo: dirección visual (paleta y luz concretas), identidad musical, regla de ritmo, motivos recurrentes, reglas de oro y arco de temporada. Se inyecta en todos los prompts posteriores.
2. **Nota de capítulo** — antes de escribir cada episodio: qué debe lograr en el arco, curva emocional, imagen clave y qué queda abierto.
3. **Dirección musical** — el brief de cada pista, a partir de la identidad musical y de lo que ocurre en cada acto.

El director **no puede cambiar el género**: recibe el mismo contrato de fidelidad que el resto del pipeline y su trabajo es hacer que ese género se sienta excelente, no reinterpretarlo. Puedes regenerar la biblia desde la pantalla de Universo.

## Configuración — solo variables de entorno

Todo se genera con Google Cloud. No hay ningún project ID, bucket, modelo ni región escritos en el código: el proyecto sale siempre del `project_id` de la service account, y cada modelo y región se puede cambiar por variable de entorno.

### Obligatorias

|Variable              |Contenido                                                        |
|----------------------|-----------------------------------------------------------------|
|`GCP_SERVICE_ACCOUNT` |JSON completo de la service account (una sola línea o con saltos) |
|`GCS_OUTPUT_BUCKET`   |Nombre del bucket de salida de Veo, sin `gs://`                    |

### Opcionales — solo si un proyecto no tiene acceso a algún modelo

|Variable                    |Default                            |
|----------------------------|-----------------------------------|
|`GCP_LOCATION`              |`us-central1` (región por defecto) |
|`SCRIPT_MODEL`              |`gemini-3.1-pro-preview`           |
|`SCRIPT_LOCATION`           |`global`                           |
|`IMAGE_MODEL`               |`gemini-2.5-flash-image`           |
|`IMAGE_REGIONS`             |`us-central1,europe-west4,us-east4`|
|`IMAGE_MODEL_LOCATIONS`     |JSON `{"modelo":"region"}`         |
|`TTS_MODEL`                 |`gemini-3.1-flash-tts-preview`     |
|`TTS_FALLBACK_MODEL`        |`gemini-2.5-flash-preview-tts`     |
|`VEO_MODEL`                 |`veo-3.1-lite-generate-001`        |
|`MUSIC_MODEL`               |`lyria-002`                        |
|`STT_MODEL` / `STT_LANGUAGE`|`latest_long` / `es-US`            |

"Ver APIs configuradas" en la app muestra todos los valores resueltos y qué variable cambia cada uno.

### Cambiar de cuenta de Google Cloud

1. Crea una service account en el proyecto nuevo y descarga su JSON.
2. Pega el JSON completo en `GCP_SERVICE_ACCOUNT` y el bucket nuevo en `GCS_OUTPUT_BUCKET`.
3. **Redeploy** — Vercel no aplica variables nuevas a un deployment ya construido.
4. Abre "APIs configuradas" en la app: muestra el proyecto, la service account y el bucket en uso, y verifica credenciales, Vertex AI y acceso al bucket (`/api/health`).

En el proyecto nuevo hacen falta:

- Facturación activa.
- APIs habilitadas: `aiplatform.googleapis.com`, `storage.googleapis.com` y — solo si usas las voces `gcp_` Neural2/WaveNet — `texttospeech.googleapis.com`.
- Roles de la service account: `roles/aiplatform.user`, `roles/storage.admin` (hace falta `storage.buckets.update`: `video-status.js` aplica CORS al bucket) y `roles/serviceusage.serviceUsageConsumer`.
- Bucket creado en ese proyecto, en US (Veo corre en `us-central1`).
- Acceso a los modelos preview que uses: `gemini-3.1-pro-preview` (el guión depende de él y no tiene fallback), los modelos de imagen 3.x, y `veo-3.1-fast` / `veo-3.1-quality` requieren allowlist — `veo-3.1-lite` es el default.

## Géneros y categorías

Tres ejes independientes que se combinan:

- **Demografía** (6): Shōnen, Shōjo, Seinen, Josei, Kodomomuke, Donghua — define público, edades y códigos culturales/estéticos, **no** las mecánicas de la trama.
- **Género principal** (17): Acción, Fantasía, Isekai, Mecha, RomCom, Drama, Slice of Life, Terror, Psicológico, Misterio, Deportes, Sci-Fi, Aventura, Sobrenatural, Supervivencia, Videojuego/Sistema, Donghua/Cultivación — decide **qué** pasa y con qué tono real.
- **Subgéneros** (23): capas que **modifican** el género principal sin sustituirlo.

Reglas de coherencia que aplica el código:

- Un subgénero nunca anula el núcleo del género principal (regla de capas).
- Los sistemas de poder (stats, niveles, notificaciones) existen **solo** en Videojuego/Sistema, Donghua/Cultivación o con el subgénero Sistema/Awakening.
- La comedia se activa solo con el género RomCom o el subgénero Comedia, y se construye con el material propio de cada género.
- Los géneros sin componente sobrenatural reciben una restricción explícita de "sin magia ni poderes", salvo que un subgénero lo habilite.
- Kodomomuke (infantil) desactiva los subgéneros para adultos (Ecchi, Harem, Harem Inverso, Gore).
- Harem y Harem Inverso son mutuamente excluyentes.

## Estado

Ya funciona en la app: guion, personajes, escenarios, imágenes, voces, música, clips de video, subtítulos sincronizados y dirección creativa, todo exportable en un ZIP.

Pendiente: el **ensamblaje final** en un único MP4 (imágenes/clips + narración + música + subtítulos quemados). Requiere un servicio con ffmpeg — Vercel no sirve para esto por el límite de 60s y el tamaño de los archivos.

## Reglas estéticas

- Anime 2D cinematográfico de alto presupuesto (MAPPA / Ufotable / Kyoto Animation / donghua de gama alta)
- Linework fino de grosor variable, cel-shading con degradados suaves, fondos densamente detallados
- Iluminación motivada y cinematográfica
- Proporciones humanas realistas
- NO render 3D, NO CGI, NO Disney/Pixar, NO webtoon plano, NO chibi
- Personajes 18+ (excepto en la demografía Kodomomuke)
