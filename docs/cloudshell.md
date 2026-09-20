# Anime AI Studio · instalación en Google Cloud

Este repositorio incluye su propio montador. No necesitas copiar comandos largos desde el iPhone.

## En Cloud Shell

Con el repositorio abierto, ejecuta solamente:

```bash
bash setup.sh
```

El script:
- activa Vertex AI, Storage, Speech-to-Text, Text-to-Speech, Cloud Run, Cloud Build y Artifact Registry;
- crea o reutiliza la cuenta de servicio `anime-studio`;
- crea un bucket exclusivo para el proyecto si no indicas otro;
- configura CORS;
- construye el contenedor de montaje con FFmpeg;
- despliega el Cloud Run Job `anime-studio-montage`;
- crea `anime-studio-cloud.env` con los valores que debes poner en Vercel.

Si ya tienes una cuenta de servicio con otro nombre, antes del comando puedes definir `ANIME_SA_EMAIL`. No hace falta hacerlo si aceptas que el instalador use/cree `anime-studio@TU_PROYECTO.iam.gserviceaccount.com`.

## Si necesitas un JSON nuevo para Vercel

Ejecuta:

```bash
bash setup.sh key
```

Se guarda en `.secrets/`, carpeta ignorada por Git. No compartas ese archivo ni lo subas al repositorio.
