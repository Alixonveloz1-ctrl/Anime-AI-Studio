# Anime AI Studio · Your Name Edition

Estudio de generación de anime cinematográfico. Genera universos narrativos, personajes, episodios de ~5 minutos con 15 escenas y 45 imágenes, voces y clips de video — y exporta el animatic final como video MP4 (iPhone/iPad) o WebM (resto).

## Pipeline

|Paso             |Servicio                                                   |
|-----------------|-----------------------------------------------------------|
|Guión y narrativa|Gemini 3.1 Pro (`/api/script`)                             |
|Imágenes         |Gemini Image — 2.5 Flash / 3.1 Flash / 3 Pro (`/api/image`) |
|Voces            |Gemini TTS o ElevenLabs (`/api/audio`)                      |
|Clips de video   |Veo 3.1 (`/api/video-start` + `/api/video-status`)          |
|Ensamblaje       |Canvas + MediaRecorder (Ken Burns)                          |

## Características

- 15 escenas por episodio × 3 imágenes por escena = 45 imágenes
- Multi-episodio con continuidad de personajes y escenarios
- Escenarios extraídos de la historia y reutilizados entre episodios
- Ken Burns con 7 direcciones de movimiento
- Formato 9:16 vertical o 16:9 widescreen
- Export MP4 nativo en iPhone Safari
- Persistencia en localStorage + IndexedDB, con Export/Import ZIP

## Uso

1. Las API keys se configuran como variables de entorno en Vercel (`GCP_SERVICE_ACCOUNT`, `GCS_OUTPUT_BUCKET`, `ELEVENLABS_API_KEY`)
1. Elige demografía, género principal y subgéneros → Genera Universo
1. Genera Episodio (personajes + historia + 15 escenas)
1. Genera las imágenes de las escenas
1. Genera las voces
1. Ensambla y exporta el video

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

## Reglas estéticas

- Anime 2D cinematográfico de alto presupuesto (MAPPA / Ufotable / Kyoto Animation / donghua de gama alta)
- Linework fino de grosor variable, cel-shading con degradados suaves, fondos densamente detallados
- Iluminación motivada y cinematográfica
- Proporciones humanas realistas
- NO render 3D, NO CGI, NO Disney/Pixar, NO webtoon plano, NO chibi
- Personajes 18+ (excepto en la demografía Kodomomuke)
