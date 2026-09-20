#!/usr/bin/env bash
set -Eeuo pipefail

# Anime AI Studio — Google Cloud one-time setup.
# Designed for Cloud Shell: clone/open the repo and run only:
#   bash setup.sh

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_LOCATION:-us-central1}"
JOB="${MONTAJE_JOB:-anime-studio-montage}"
AR_REPO="${ANIME_AR_REPO:-anime-studio}"
BUCKET="${GCS_OUTPUT_BUCKET:-}"
SA_EMAIL="${ANIME_SA_EMAIL:-}"

if [[ -z "$ACTIVE_ACCOUNT" ]]; then
  echo "No hay una cuenta de Google autenticada en Cloud Shell."
  echo "Abre Cloud Shell desde la cuenta de Google que vas a usar y vuelve a ejecutar: bash setup.sh"
  exit 1
fi

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "No hay proyecto activo en gcloud."
  echo "En Cloud Shell, elige el proyecto desde la barra superior y vuelve a ejecutar: bash setup.sh"
  exit 1
fi

if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "La cuenta $ACTIVE_ACCOUNT no puede acceder al proyecto $PROJECT_ID."
  echo "Selecciona el proyecto correcto en Cloud Shell y vuelve a ejecutar: bash setup.sh"
  exit 1
fi

if [[ -z "$BUCKET" ]]; then
  BUCKET="${PROJECT_ID}-anime-ai-studio"
fi

echo
echo "Anime AI Studio"
echo "Cuenta Google activa: $ACTIVE_ACCOUNT"
echo "Proyecto activo:       $PROJECT_ID"
echo "Región:                $REGION"
echo "Bucket nuevo:          gs://$BUCKET"
echo "Job nuevo:             $JOB"
echo

gcloud config set project "$PROJECT_ID" >/dev/null

echo "1/7 · Activando APIs..."
gcloud services enable   aiplatform.googleapis.com   storage.googleapis.com   speech.googleapis.com   texttospeech.googleapis.com   run.googleapis.com   cloudbuild.googleapis.com   artifactregistry.googleapis.com   --project "$PROJECT_ID" --quiet

echo "2/7 · Preparando cuenta de servicio..."

# No hay ningún correo de service account escrito en el repositorio.
# Si ANIME_SA_EMAIL viene definido, se usa ese. Si no, se detectan las cuentas
# que YA existen en el proyecto y se reutilizan. Sólo se crea una nueva cuando
# no hay ninguna utilizable (o cuando el usuario la elige explícitamente).
if [[ -n "$SA_EMAIL" ]]; then
  if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "ANIME_SA_EMAIL apunta a una cuenta que no existe en este proyecto:"
    echo "  $SA_EMAIL"
    exit 1
  fi
else
  mapfile -t EXISTING_SAS < <(
    gcloud iam service-accounts list --project "$PROJECT_ID" --format='value(email)' 2>/dev/null \
      | grep -E "@${PROJECT_ID//./\\.}\\.iam\\.gserviceaccount\\.com$" \
      || true
  )

  if [[ "${#EXISTING_SAS[@]}" -eq 0 ]]; then
    SA_EMAIL="anime-studio@${PROJECT_ID}.iam.gserviceaccount.com"
    gcloud iam service-accounts create "anime-studio" \
      --display-name="Anime AI Studio" --project "$PROJECT_ID"
    echo "  Se creó una cuenta nueva: $SA_EMAIL"
  elif [[ "${#EXISTING_SAS[@]}" -eq 1 ]]; then
    SA_EMAIL="${EXISTING_SAS[0]}"
    echo "  Se reutilizará la cuenta existente:"
    echo "  $SA_EMAIL"
  else
    echo "  Hay varias cuentas de servicio. Escribe SOLO EL NÚMERO:"
    for i in "${!EXISTING_SAS[@]}"; do
      printf '  %2d) %s\n' "$((i + 1))" "${EXISTING_SAS[$i]}"
    done
    printf '  %2d) crear una nueva (anime-studio)\n' "$(( ${#EXISTING_SAS[@]} + 1 ))"

    while true; do
      read -r CHOICE
      if [[ "$CHOICE" =~ ^[0-9]+$ ]] \
        && (( CHOICE >= 1 && CHOICE <= ${#EXISTING_SAS[@]} + 1 )); then
        break
      fi
      echo "  Escribe un número válido."
    done

    if (( CHOICE == ${#EXISTING_SAS[@]} + 1 )); then
      SA_EMAIL="anime-studio@${PROJECT_ID}.iam.gserviceaccount.com"
      gcloud iam service-accounts create "anime-studio" \
        --display-name="Anime AI Studio" --project "$PROJECT_ID"
      echo "  Se creó: $SA_EMAIL"
    else
      SA_EMAIL="${EXISTING_SAS[$((CHOICE - 1))]}"
      echo "  Se reutilizará: $SA_EMAIL"
    fi
  fi
fi

echo "Cuenta de servicio:    $SA_EMAIL"

for ROLE in   roles/aiplatform.user   roles/storage.admin   roles/serviceusage.serviceUsageConsumer   roles/run.invoker
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID"     --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --quiet >/dev/null
done

# The Cloud Shell user needs actAs on the runtime account to deploy the Job.
if [[ -n "$ACTIVE_ACCOUNT" ]]; then
  if [[ "$ACTIVE_ACCOUNT" == *".gserviceaccount.com" ]]; then
    MEMBER="serviceAccount:$ACTIVE_ACCOUNT"
  else
    MEMBER="user:$ACTIVE_ACCOUNT"
  fi
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL"     --member="$MEMBER" --role="roles/iam.serviceAccountUser"     --project "$PROJECT_ID" --quiet >/dev/null || true
fi

echo "3/7 · Preparando bucket..."
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET"     --project "$PROJECT_ID" --location=US --uniform-bucket-level-access
fi

cat >/tmp/anime-studio-cors.json <<'JSON'
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD", "PUT", "OPTIONS"],
    "responseHeader": ["Content-Type", "Range", "Content-Range"],
    "maxAgeSeconds": 3600
  }
]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/anime-studio-cors.json >/dev/null || true

echo "4/7 · Preparando Artifact Registry..."
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO"     --repository-format=docker --location="$REGION"     --description="Anime AI Studio montage images"     --project="$PROJECT_ID"
fi

CB_SA="$(gcloud builds get-default-service-account --project "$PROJECT_ID" 2>/dev/null || true)"
if [[ -n "$CB_SA" ]]; then
  gcloud projects add-iam-policy-binding "$PROJECT_ID"     --member="serviceAccount:$CB_SA"     --role="roles/artifactregistry.writer" --quiet >/dev/null || true
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/montage:latest"

echo "5/7 · Construyendo montador..."
gcloud builds submit worker/montage   --tag "$IMAGE" --project "$PROJECT_ID" --quiet

echo "6/7 · Desplegando Cloud Run Job..."
gcloud run jobs deploy "$JOB"   --image "$IMAGE"   --region "$REGION"   --service-account "$SA_EMAIL"   --cpu 2 --memory 4Gi   --task-timeout 7200s   --max-retries 0   --project "$PROJECT_ID"   --quiet

echo "7/7 · Guardando valores..."
cat > anime-studio-cloud.env <<EOF
GCP_LOCATION=$REGION
GCS_OUTPUT_BUCKET=$BUCKET
MONTAJE_JOB=$JOB
MONTAJE_REGION=$REGION
EOF

echo
echo "✅ Google Cloud quedó preparado."
echo
echo "Valores para Vercel:"
cat anime-studio-cloud.env
echo
echo "GCP_SERVICE_ACCOUNT debe contener el JSON de la cuenta elegida arriba."
echo "Ni el correo de la cuenta Google, ni el correo de la service account, ni el project ID"
echo "quedan escritos en el repositorio: todo se detecta en tiempo de instalación."
echo "Si ya tienes el JSON de esta cuenta de servicio, reutilízalo."
echo
echo "Si NO tienes una clave JSON y quieres crear una nueva, ejecuta:"
echo "  bash setup.sh key"
echo

if [[ "${1:-}" == "key" ]]; then
  mkdir -p .secrets
  KEY=".secrets/anime-studio-service-account.json"
  if [[ -e "$KEY" ]]; then
    echo "Ya existe $KEY; no se creó otra clave."
  else
    gcloud iam service-accounts keys create "$KEY"       --iam-account="$SA_EMAIL" --project="$PROJECT_ID"
    chmod 600 "$KEY"
    python3 - <<PY
import json
src="$KEY"
with open(src, encoding="utf-8") as f:
    d=json.load(f)
with open(".secrets/GCP_SERVICE_ACCOUNT-one-line.txt","w",encoding="utf-8") as f:
    f.write(json.dumps(d,separators=(",",":")))
PY
    echo "Clave creada en $KEY"
    echo "Versión de una línea para Vercel: .secrets/GCP_SERVICE_ACCOUNT-one-line.txt"
    echo "⚠️ No subas esos archivos a GitHub."
  fi
fi
