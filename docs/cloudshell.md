# Anime AI Studio · instalación en Google Cloud

El correo de tu cuenta Google no está escrito en la aplicación. El instalador trabaja con **la cuenta autenticada en Cloud Shell** y con **el proyecto activo**.

## Desde el iPhone

1. Abre Cloud Shell desde la cuenta Google nueva.
2. Selecciona arriba el proyecto que vas a usar para Anime AI Studio.
3. Abre este repositorio en Cloud Shell.
4. Escribe solamente:

```bash
bash setup.sh
```

Al comenzar verás algo parecido a:

```text
Cuenta Google activa: correo@ejemplo.com
Proyecto activo: mi-proyecto
Región: us-central1
Bucket: gs://mi-proyecto-anime-ai-studio
```

Si la cuenta activa no tiene acceso al proyecto seleccionado, el script se detiene antes de crear recursos.

## Qué prepara

- Vertex AI
- Cloud Storage
- Speech-to-Text
- Text-to-Speech
- Cloud Run
- Cloud Build
- Artifact Registry
- bucket del proyecto
- CORS del bucket
- cuenta de servicio de Anime AI Studio si hace falta
- contenedor FFmpeg
- Cloud Run Job `anime-studio-montage`

Al final crea `anime-studio-cloud.env` con los valores que debes llevar a Vercel.

## Cuenta de servicio

Por defecto crea o reutiliza:

```text
anime-studio@TU_PROYECTO.iam.gserviceaccount.com
```

Eso es independiente del correo personal con el que entraste a Google Cloud.

Si ya existe una cuenta de servicio distinta que quieras reutilizar, se configurará cuando hagamos la instalación definitiva; no es necesario hardcodearla ahora.

## Si hace falta un JSON nuevo para Vercel

Sólo si no tienes ya la clave correspondiente a la cuenta de servicio:

```bash
bash setup.sh key
```

Se guarda en `.secrets/`, carpeta ignorada por Git. Nunca se sube esa clave al repositorio.
