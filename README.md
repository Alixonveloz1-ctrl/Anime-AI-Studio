# Anime AI Studio · Your Name Edition

Estudio de generación de anime cinematográfico. Genera universos narrativos, personajes, episodios de 5 a 16 minutos, imágenes, voces, música y clips de video — y exporta todo el material listo para montar.

## Pipeline

|Paso             |Servicio                                                   |
|-----------------|-----------------------------------------------------------|
|Guión y narrativa|Gemini 3.1 Pro (`/api/script`)                             |
|Imágenes         |Nano Banana 2 / Nano Banana (`/api/image`)                  |
|Voces            |Gemini TTS / Cloud TTS Neural2-WaveNet (`/api/audio`)       |
|Música           |Lyria (`/api/music`) — una pista instrumental por acto      |
|Dirección        |Director creativo: biblia de serie, nota por capítulo, música|
|Clips de video   |Veo 3.1 Lite (`/api/video-start` + `/api/video-status`)     |
|Subtítulos       |Alineados al audio real de cada escena (`/api/transcribe`)   |
|Ensamblaje       |Cloud Run Job `diezmo-montaje` (ya desplegado) vía `/api/assemble`|

## Características

- Duración configurable: 15 / 24 / 36 / 48 escenas (~5 a ~16 min)
- El director decide cuántos planos necesita cada escena (1, 2 o 3) — no se generan imágenes de relleno
- Un clip de video por plano, encadenados: el clip de un plano termina en la imagen del siguiente
- Cada clip dura su parte de la narración, no ocho segundos fijos
- Los episodios largos se escriben acto por acto, encadenando el texto ya escrito
- Multi-episodio con continuidad de personajes y escenarios
- Escenarios extraídos de la historia y reutilizados entre episodios
- Formato 9:16 vertical o 16:9 widescreen
- Persistencia en localStorage + IndexedDB
- Export ZIP: imágenes, videos, audios, música, subtítulos .srt y la dirección creativa
- Subtítulos alineados palabra a palabra con el audio real (Speech-to-Text), con respaldo proporcional por escena
- Ensamblaje del MP4 final en la propia app: cada escena dura exactamente su narración, con música mezclada y subtítulos quemados
- Export ZIP con todo el material por si prefieres montar fuera

## Uso

1. Configura las dos variables de entorno en Vercel (ver más abajo)
1. Elige demografía, género principal y subgéneros → Genera Universo
1. Genera Episodio (personajes + historia + escenas)
1. Genera las imágenes de las escenas
1. Genera las voces
1. Genera la música del episodio (una pista por acto)
1. Ensambla el video final (MP4) o exporta el ZIP con todas las piezas

## Director creativo

Cada proyecto lo dirige un director creativo especializado en anime, que trabaja en tres niveles:

1. **Biblia de serie** — se escribe al crear el universo: dirección visual (paleta y luz concretas), identidad musical, regla de ritmo, motivos recurrentes, reglas de oro y arco de temporada. Se inyecta en todos los prompts posteriores.
2. **Nota de capítulo** — antes de escribir cada episodio: qué debe lograr en el arco, curva emocional, imagen clave y qué queda abierto.
3. **Dirección musical** — el brief de cada pista, a partir de la identidad musical y de lo que ocurre en cada acto.
4. **Desglose de planos** — cuántas imágenes necesita cada escena. Una conversación estática es UN plano; solo se abren dos o tres cuando hay beats visuales realmente distintos. Un cambio de ángulo no cuenta como beat.
5. **Movimiento de cada plano** — qué se mueve y en qué estado queda el clip al terminar. El estado final de un plano tiene que ser la imagen del plano siguiente: es lo que hace que los clips de una escena se vean como una toma continua.

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
|`IMAGE_MODEL`               |`gemini-3.1-flash-image` (Nano Banana 2)|
|`IMAGE_REGIONS`             |`us-central1,europe-west4,us-east4`|
|`IMAGE_MODEL_LOCATIONS`     |JSON `{"modelo":"region"}`         |
|`TTS_MODEL`                 |`gemini-2.5-flash-preview-tts`     |
|`TTS_FALLBACK_MODEL`        |`gemini-2.5-pro-preview-tts`       |
|`VEO_MODEL`                 |`veo-3.1-lite-generate-001`        |
|`MUSIC_MODEL`               |`lyria-002`                        |
|`STT_MODEL` / `STT_LANGUAGE`|`latest_long` / `es-US`            |
|`GCS_PREFIX`                |`anime-studio` (carpeta propia en el bucket)|
|`MONTAJE_JOB`               |`diezmo-montaje`                   |
|`MONTAJE_REGION`            |`us-central1`                      |

"Ver APIs configuradas" en la app muestra todos los valores resueltos y qué variable cambia cada uno.

### Cambiar de cuenta de Google Cloud

1. Crea una service account en el proyecto nuevo y descarga su JSON.
2. Pega el JSON completo en `GCP_SERVICE_ACCOUNT` y el bucket nuevo en `GCS_OUTPUT_BUCKET`.
3. **Redeploy** — Vercel no aplica variables nuevas a un deployment ya construido.
4. Abre "APIs configuradas" en la app: muestra el proyecto, la service account y el bucket en uso, y verifica credenciales, Vertex AI y acceso al bucket (`/api/health`).

En el proyecto nuevo hacen falta:

- Facturación activa.
- APIs habilitadas: `aiplatform.googleapis.com`, `storage.googleapis.com`, `speech.googleapis.com` (subtítulos con timing exacto) y — solo si usas las voces `gcp_` Neural2/WaveNet — `texttospeech.googleapis.com`.
- Roles de la service account: `roles/aiplatform.user`, `roles/storage.admin` (hace falta `storage.buckets.update`: `video-status.js` aplica CORS al bucket) y `roles/serviceusage.serviceUsageConsumer`.
- Bucket creado en ese proyecto, en US (Veo corre en `us-central1`).
- Acceso al modelo de texto `gemini-3.1-pro-preview`, del que depende el guión (no tiene fallback).

**El modelo que elijas es el que se usa.** Si falla, la app devuelve el error de Google tal cual; nunca sustituye el modelo por otro a tus espaldas.

Los defaults son los modelos baratos, que son los que se usan a diario: **Nano
Banana 2** para imagen y **Veo 3.1 Lite** para video. Nano Banana Pro sigue en el
selector, de último, para elegirlo a mano cuando haga falta.

## Continuidad entre planos

Cada plano de una escena se convierte en su propio clip. El clip del plano N se
genera con **dos** referencias: la imagen del plano N como primer fotograma y la
imagen del plano N+1 como último (`lastFrame`), así el clip termina justo donde
empieza el siguiente y el corte no salta. El último plano de la escena no lleva
fotograma final: ahí la escena corta.

La duración también se controla: cada clip dura la parte de narración que le
toca (narración de la escena ÷ número de planos), redondeada a lo que el modelo
acepta — 4, 6 u 8 s en Veo 3.1; 5 a 8 s en Veo 2. Sin eso, un plano de tres
segundos se generaría de ocho y el personaje se pondría a inventar movimiento en
los cinco sobrantes. En un empate gana la duración mayor, porque el montaje
recorta el sobrante pero no puede rellenar lo que falta.

No todos los modelos de Veo aceptan fotograma final, y la documentación pública
no coincide consigo misma sobre cuáles sí. Así que no se adivina: se pide con
fotograma final y, si el modelo lo rechaza, **ese mismo modelo** se vuelve a
pedir sin él y la app lo dice ("no acepta fotograma final"). El modelo elegido
no se cambia nunca.

## Dónde se guarda todo

El bucket se puede compartir con otros proyectos. **Todo lo que escribe esta
herramienta vive bajo un único prefijo** (`anime-studio/` por defecto,
configurable con `GCS_PREFIX`), y el código no puede escribir ni firmar nada
fuera de él:

```
gs://<bucket>/
├── diezmo/                                    ← otros proyectos, intactos
└── anime-studio/                              ← todo lo de esta herramienta
    ├── veo/                                   clips generados por Veo
    └── proyectos/
        ├── el-ultimo-cultivador-379829/ep01/  ← una carpeta por universo
        │   ├── hoja.json  montar.sh  descargas.txt  error.txt
        │   ├── material/                      imágenes, narración, música, subs.srt
        │   └── completo.mp4                   el episodio montado
        └── angeles-de-neon-tokio-2099-000001/ep01/
```

Cada universo tiene su carpeta con **su propio nombre**, derivado del título, para
poder distinguirlos al mirar el bucket. Lleva un sufijo corto y estable porque dos
universos pueden llamarse igual, y porque un título puede cambiar si regeneras el
universo: la carpeta se fija al crearlo y ya no se mueve, así renombrar nunca deja
huérfano el material ya renderizado. Los archivos de dentro llevan nombres
genéricos (`img_000.png`, `narr_000.wav`) — la carpeta ya identifica de quién son.

`/api/upload-url` rechaza cualquier ruta fuera del prefijo, `/api/download-url` se
niega a firmar objetos que no estén dentro de él, y el nombre de la carpeta se
vuelve a sanear en el servidor porque viene del cliente.

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

## Ensamblaje final

El montaje del MP4 lo hace el **Cloud Run Job que ya está desplegado en esta
cuenta** (`diezmo-montaje`). No hay que desplegar nada nuevo: ese contenedor es
genérico — baja un encargo del bucket y ejecuta el script de ffmpeg que la app
deja ahí. Toda la lógica de render vive en `buildMontarScript()` en la app, así
que cambiar cómo se ve un episodio no requiere volver a desplegar nada.

Flujo:

```
navegador ──PUT firmado──▶ GCS ◀──baja── Cloud Run Job (ffmpeg)
    │                                          │
    └──encargo──▶ /api/assemble ──:run─────────┘
                   (Vercel)                    │
                                     MP4 ──▶ GCS ──▶ URL firmada
```

El encargo que se deja en `gs://<bucket>/<prefijo>/proyectos/<proyecto>/ep<NN>/` es:
`hoja.json`, `montar.sh`, `descargas.txt` (TSV origen→nombre local) y un
`error.txt` vacío. El job se lanza con `TRABAJO`, `PREFIJO` y `SALIDA`.

Cada escena dura exactamente su narración (medida con ffprobe), y dentro de la
escena esa duración se reparte entre sus planos: el último absorbe el redondeo,
así los planos siempre suman la narración exacta. Los clips de Veo ya están en el
bucket, así que se referencian en su sitio en vez de bajarlos y volverlos a subir
desde el teléfono. Si el render falla, el motivo real se lee de `error.txt`,
porque Cloud Run solo sabe decir "exit code N".

## Reglas estéticas

- Anime 2D cinematográfico de alto presupuesto (MAPPA / Ufotable / Kyoto Animation / donghua de gama alta)
- Linework fino de grosor variable, cel-shading con degradados suaves, fondos densamente detallados
- Iluminación motivada y cinematográfica
- Proporciones humanas realistas
- NO render 3D, NO CGI, NO Disney/Pixar, NO webtoon plano, NO chibi
- Personajes 18+ (excepto en la demografía Kodomomuke)
