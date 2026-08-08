#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Despliega el servicio de ensamblaje en Cloud Run.
# Ejecutalo desde Google Cloud Shell, dentro de esta carpeta:
#
#   cd cloud-run && ./deploy.sh mi-bucket-de-salida
#
# Al terminar imprime la URL que hay que poner en Vercel como
# ASSEMBLY_SERVICE_URL.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

BUCKET="${1:-${GCS_OUTPUT_BUCKET:-}}"
SERVICE="${SERVICE_NAME:-anime-assembly}"
REGION="${REGION:-us-central1}"
PROJECT="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"

if [[ -z "$BUCKET" ]]; then
  echo "Uso: ./deploy.sh <nombre-del-bucket>   (sin gs://)" >&2
  exit 1
fi
if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "No hay proyecto activo. Ejecutá: gcloud config set project TU_PROYECTO" >&2
  exit 1
fi

echo "▶ Proyecto: $PROJECT"
echo "▶ Región:   $REGION"
echo "▶ Bucket:   $BUCKET"
echo

echo "▶ Habilitando APIs necesarias..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"

# Service account propia del servicio, con acceso solo al bucket.
SA_NAME="anime-assembly"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1; then
  echo "▶ Creando service account $SA_EMAIL..."
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Anime assembly service" --project "$PROJECT"
fi

echo "▶ Dando acceso al bucket..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/storage.objectAdmin --project "$PROJECT" >/dev/null

# La firma de URLs necesita que la SA pueda firmar como sí misma.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/iam.serviceAccountTokenCreator \
  --project "$PROJECT" >/dev/null

echo "▶ Desplegando (esto tarda unos minutos la primera vez)..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT" \
  --service-account "$SA_EMAIL" \
  --set-env-vars "GCS_OUTPUT_BUCKET=${BUCKET}" \
  --memory 4Gi --cpu 4 --timeout 3600 --concurrency 1 --max-instances 3 \
  --no-allow-unauthenticated \
  --no-cpu-throttling

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"

echo
echo "▶ Autorizando a la service account de la app a invocarlo..."
echo "  (pegá el client_email de tu GCP_SERVICE_ACCOUNT de Vercel)"
read -r -p "  client_email: " APP_SA
if [[ -n "$APP_SA" ]]; then
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --region "$REGION" --project "$PROJECT" \
    --member="serviceAccount:${APP_SA}" --role=roles/run.invoker >/dev/null
  echo "  ✅ $APP_SA puede invocar el servicio"
else
  echo "  ⚠️  Saltado. Hacelo después con:"
  echo "     gcloud run services add-iam-policy-binding $SERVICE --region $REGION \\"
  echo "       --member=serviceAccount:TU_SA --role=roles/run.invoker"
fi

echo
echo "════════════════════════════════════════════════════════"
echo " Listo. En Vercel agregá esta variable de entorno:"
echo
echo "   ASSEMBLY_SERVICE_URL=$URL"
echo
echo " Después hacé Redeploy y abrí «APIs configuradas» en la"
echo " app para verificar que el ensamblaje aparece disponible."
echo "════════════════════════════════════════════════════════"
