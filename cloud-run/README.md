# Servicio de ensamblaje (Cloud Run + ffmpeg)

Une las piezas de un episodio —imágenes o clips de Veo, narración, música y
subtítulos— en un solo MP4.

Vive fuera de Vercel porque ffmpeg necesita CPU, disco y minutos de reloj: las
funciones de Vercel se cortan a los 60 segundos y no pueden sostener el render
de un episodio de 16 minutos.

## Desplegar

Desde **Google Cloud Shell**, en el proyecto donde está tu bucket:

```bash
git clone <este-repo> && cd Anime-AI-Studio/cloud-run
./deploy.sh mi-bucket-de-salida
```

El script:

1. Habilita `run`, `cloudbuild` y `artifactregistry`.
2. Crea la service account `anime-assembly` y le da acceso al bucket.
3. Despliega el servicio (4 CPU, 4 GiB, timeout 1 h, sin acceso público).
4. Te pide el `client_email` de tu `GCP_SERVICE_ACCOUNT` de Vercel y le concede
   `roles/run.invoker`.
5. Imprime la URL del servicio.

Pegá esa URL en Vercel como `ASSEMBLY_SERVICE_URL`, hacé **Redeploy**, y el
botón «Ensamblar episodio» queda habilitado.

## Cómo encaja

```
navegador ──PUT firmado──▶ GCS ◀──lee── Cloud Run (ffmpeg)
    │                                        │
    └──manifiesto──▶ /api/assemble ──ID token─┘
                     (Vercel)                 │
                                    MP4 ──▶ GCS ──▶ URL firmada
```

Los assets viven en IndexedDB en el navegador y el renderizador corre en Cloud
Run, así que se encuentran en el bucket: el navegador sube cada archivo
directamente con una URL firmada y solo el **manifiesto** (rutas, no bytes) pasa
por Vercel.

El servicio es privado; `/api/assemble` lo invoca con un ID token firmado por la
misma service account de la app.

## Qué hace el render

- Cada escena dura **exactamente** lo que dura su narración (medida con ffprobe).
- Si la escena tiene clip de Veo se usa el clip, recortado o en bucle a esa
  duración; si no, la imagen con un zoom lento.
- La narración va sobre todo el episodio; la música se concatena por actos, se
  repite hasta cubrirlo y va a bajo volumen con fundidos.
- Los subtítulos se queman con el timing real de cada palabra.
- Sale un MP4 H.264 + AAC con `faststart`, subido al bucket bajo
  `ensamblados/<proyecto>/<job>.mp4`, y se devuelve una URL firmada de 7 días.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `POST /render` | Arranca un job y devuelve `{ jobId }` de inmediato |
| `GET /status/:jobId` | `{ state, progress, url, error }` |
| `GET /healthz` | Comprobación de vida y de que ffmpeg está presente |

Los jobs viven en memoria: si el servicio se reinicia a mitad de un render hay
que relanzarlo. No hay estado que merezca una base de datos.

## Coste

Solo cobra mientras renderiza (`--no-cpu-throttling`, `--max-instances 3`). Un
episodio de ~8 minutos tarda unos pocos minutos con 4 CPU.
