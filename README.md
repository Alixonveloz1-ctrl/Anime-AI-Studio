# Anime AI Studio · Your Name Edition

Estudio de generación de anime cinematográfico estilo Makoto Shinkai. Genera universos narrativos, personajes, episodios de 10 minutos con 30 escenas, imágenes 16:9, voces, música y efectos — y exporta el animatic final como video MP4 (iPhone/iPad) o WebM (resto).

## Pipeline

|Paso             |Servicio                                   |
|-----------------|-------------------------------------------|
|Guión y narrativa|Claude (Sonnet 4)                          |
|Imágenes 16:9    |Gemini 2.5 Flash Image (Nano Banana)       |
|Música de fondo  |Gemini Lyria 3 Pro (clips 2-3 min)         |
|Voces y efectos  |ElevenLabs (Multilingual v2 + Voice Design)|
|Ensamblaje       |Canvas + MediaRecorder (Ken Burns)         |

## Características

- 30 escenas por episodio (~$2.30 USD)
- Asignación automática de voces con IA
- Voice Design para crear voces nuevas cuando no hay match
- Export MP4 nativo en iPhone Safari
- Ken Burns con 7 direcciones de movimiento
- Persistencia en localStorage + Export/Import ZIP

## Uso

1. Configura tus 3 API keys (Claude, Gemini, ElevenLabs)
1. Genera Universo → Personajes → Episodio
1. Genera imágenes (30 por episodio)
1. Asigna voces automáticamente con IA
1. Genera música y efectos
1. Ensambla y exporta video

## Reglas estéticas

- Iluminación natural cinematográfica (golden hour / blue hour)
- Paletas suaves emocionales
- Proporciones humanas realistas
- NO fluorescentes, NO neón, NO estética genérica de IA
- NO hipersexualización
- 16:9 widescreen