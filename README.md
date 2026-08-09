# Anime AI Studio · Your Name Edition

Estudio de generación de anime cinematográfico. Genera universos narrativos, personajes, episodios de 5 a 16 minutos, imágenes, voces, música y clips de video — y exporta todo el material listo para montar.

## Pipeline

|Paso             |Servicio                                                   |
|-----------------|-----------------------------------------------------------|
|Guión y narrativa|Gemini 3.1 Pro (`/api/script`)                             |
|Imágenes         |Nano Banana 2 / Nano Banana (`/api/image`)                  |
|Voces            |Chirp 3: HD (`/api/audio`, lista real desde `/api/voices`)   |
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

## El equipo

Cada miembro existe porque **atrapa un fallo concreto**, no por el título. Un
título más grandilocuente en el prompt no cambia ni un token de la salida; lo que
la cambia es que alguien distinto *revise* lo escrito.

|Miembro|Qué hace|Qué error evita|
|-------|--------|---------------|
|**Director creativo**|Biblia de serie, nota de cada capítulo, dirección musical|Capítulos de plantilla|
|**Director de fotografía**|Cuántos planos, qué muestra cada uno, el movimiento|Imágenes de relleno, saltos entre planos|
|**Director de arte / script**|Lee los prompts ya escritos y los contrasta con el escenario y la narración|Atrezzo imposible, clima dentro de un interior|

El tercero es el que generaliza: no sigue una lista de objetos prohibidos, razona
sobre el par (prompt, lugar), así que caza también el fallo que nadie anticipó —
en cualquier universo, sin tocar código. Corre solo al escribir cada bloque de 5
escenas, y a mano con **"🎬 Revisar la puesta en escena"** en la pantalla de
Universo, para repasar un episodio ya escrito.

Cuesta una llamada de texto por cada 5 escenas. Cero imágenes, cero video.

Cuando corrige un plano no borra nada: dice qué imágenes y qué **clips** quedaron
obsoletos y deja que decidas. Los clips importan porque uno termina en la imagen
del plano siguiente — si esa imagen cambia, el clip anterior también hay que
rehacerlo o el corte queda roto. Si no consigue revisar (límite de peticiones),
lo dice: nunca reporta "sin fallos" sobre algo que no llegó a mirar.

### Los tres niveles del director creativo

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
- APIs habilitadas: `aiplatform.googleapis.com`, `storage.googleapis.com`, `speech.googleapis.com` (subtítulos con timing exacto) y `texttospeech.googleapis.com` (las voces).
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

La duración también se controla: a Veo se le pide la parte de narración que le
toca a ese plano (narración de la escena ÷ número de planos), redondeada a lo que
el modelo acepta — 4, 6 u 8 s en Veo 3.1; 5 a 8 s en Veo 2. Sin eso, un plano de
tres segundos se generaría de ocho y el personaje se pondría a inventar
movimiento en los cinco sobrantes.

Como el redondeo nunca cae exacto, **el montaje ajusta la velocidad, no recorta**.
Recortar el final sería justo tirar el fotograma de enganche, que es lo único que
hace invisible el corte; y repetir el clip para rellenar un hueco lo devolvería a
su primer fotograma, que es peor. Así que el montador mide la duración real del
clip (Veo no siempre devuelve los segundos que se le pidieron), calcula
`R = hueco ÷ duración real` y aplica `setpts` con ese factor: un plano de 3 s
sacado de un clip de 4 s corre un poco más rápido, uno de 10 s sacado de uno de
8 s corre un poco más lento, y **los dos extremos se conservan**.

La ralentización se topa en 2×, porque más allá el movimiento se lee como cámara
lenta en vez de como ritmo; lo que falte se queda quieto en el último fotograma —
que es precisamente el fotograma de enganche, así que la unión sobrevive igual.

Por eso el empate al elegir la duración lo gana la **menor**: al reajustar la
velocidad, quedarse corto o pasarse cuesta lo mismo en imagen, y Veo cobra por
segundo generado.

## La voz

**Solo Chirp 3: HD.** Las otras dos familias se probaron y se descartaron por
motivos concretos:

- **Gemini TTS** vuelve a interpretar en cada llamada. En un episodio de quince
  escenas eso se oye como varios narradores distintos: cambia el registro y hasta
  el timbre, y ninguna cantidad de dirección lo arregla, porque no hay ningún
  parámetro que fije la interpretación.
- **Neural2 / WaveNet** son estables pero suenan a máquina.

Chirp mantiene **la misma persona de principio a fin**, que es lo que hace falta
para narrar.

### El menú no está escrito en el código

Se lo pide a Google (`/api/voices` → `texttospeech.googleapis.com/v1/voices`) y
ofrece exactamente las voces que tu service account puede sintetizar, en todos
los idiomas que tenga. Una lista escrita a mano es lo que hizo que la app
ofreciera `Perseus`, que no existe, y sólo cuatro voces Chirp cuando el proyecto
tiene muchas más. Cuando Google añada voces, aparecen solas.

El menú viene **separado por género** — masculinas y femeninas en grupos aparte,
alfabéticas dentro de cada uno — para no tener que leer treinta nombres buscando
la mitad que interesa. El género lo dice Google; sólo cuando la API responde
"sin especificar" se completa con una tabla por nombre, y una voz que ni así se
pueda clasificar aparece igual, en su propio grupo, en vez de desaparecer.

El selector de idioma sale de las voces disponibles, y al cambiarlo se conserva
la personalidad elegida si esa misma voz existe en el idioma nuevo.

### La velocidad

Chirp 3: HD **no acepta `speakingRate` ni `pitch`** — está documentado, y la API
los ignora. Remuestrear el audio ya generado lo aceleraría, pero también le
subiría el tono: es el efecto ardilla, y suena metálico.

Así que el tempo se cambia en el navegador con **WSOLA**: la onda se corta en
ventanas solapadas, cada una se desliza hasta donde mejor continúa a la anterior,
y se suman al nuevo espaciado. El periodo de la onda se conserva, así que **el
tono no se mueve — sólo el ritmo**. Hay una prueba que lo mide: a 0,5x y a 2x el
audio sigue sonando a 440 Hz, y el caso de control (remuestrear) sube a 660 Hz.

Se aplica antes de guardar el audio, así que los subtítulos y el montaje miden
exactamente los segundos que vas a oír.

El volumen sí va en la petición, que ese Chirp lo admite.

### Dónde vive el clima

Veo trata la lluvia como una capa de partículas a pantalla completa: si la ve en
el primer fotograma, la extiende a todo el plano — y metía lluvia dentro de un
pasillo. Tres cosas lo causaban a la vez, y las tres están corregidas:

- El prompt de video **no decía dónde ocurre el plano**. Cuando el director
  escribe el movimiento, solo se mandaba ese movimiento, así que la palabra
  "pasillo" no aparecía por ningún lado y Veo deducía la geografía de los píxeles.
- El estilo pedía `wet-surface reflections` en el 100% de los clips. Bajo techo
  eso es literalmente pedir que se moje el suelo. Se quita solo en la ruta de
  video; las imágenes conservan ese brillo.
- El clima elegido en el selector se aplicaba como MANDATORY a las 45 imágenes
  del episodio sin preguntar si la escena tiene techo.

Ahora cada escena sabe si está bajo techo (a partir de su escenario), el clima se
declara **al otro lado del cristal**, y en interiores se añade una regla dura. Y
se usa el **prompt negativo** de Veo, que antes no se usaba: es la única
restricción que el reescritor interno de Veo 3.x no puede diluir, y va redactado
como Google exige — una lista de cosas ("indoor rain"), nunca una orden ("no rain").

Por el mismo motivo se arregló la deriva de cámara: la regla de encuadre le pedía
"usa ángulos over-shoulder" a un clip cuyo ángulo ya viene fijado por el primer
fotograma, así que la única forma de obedecer era mover la cámara.

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
así los planos siempre suman la narración exacta. Cada clip se encaja en su hueco
ajustando la velocidad, nunca recortándolo (ver *Continuidad entre planos*). Los
clips de Veo ya están en el bucket, así que se referencian en su sitio en vez de
bajarlos y volverlos a subir desde el teléfono. Si el render falla, el motivo real
se lee de `error.txt`, porque Cloud Run solo sabe decir "exit code N".

## Reglas estéticas

- Anime 2D cinematográfico de alto presupuesto (MAPPA / Ufotable / Kyoto Animation / donghua de gama alta)
- Linework fino de grosor variable, cel-shading con degradados suaves, fondos densamente detallados
- Iluminación motivada y cinematográfica
- Proporciones humanas realistas
- NO render 3D, NO CGI, NO Disney/Pixar, NO webtoon plano, NO chibi
- Personajes 18+ (excepto en la demografía Kodomomuke)

## Regenerar un episodio

Los ids de escena son posicionales (`s1`…`sN`) y todas las claves de material se
construyen con ellos, así que volver a generar un episodio dejaría la imagen, la
voz y el clip de la escena 1 vieja colgando de la escena 1 nueva — narración
nueva debajo de dibujos viejos, sin avisar.

Por eso el botón **avisa antes** (diciendo cuántos archivos se pierden) y borra
ese material una vez escrita la historia nueva — nunca antes, para que una
generación que falle no se lleve nada por delante. Se borra solo lo de **ese**
episodio: el universo, los personajes, sus imágenes, los escenarios y los demás
episodios quedan intactos.
