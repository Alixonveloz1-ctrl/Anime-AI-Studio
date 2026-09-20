#!/usr/bin/env bash
set -Eeuo pipefail

: "${TRABAJO:?Falta TRABAJO}"
: "${SALIDA:?Falta SALIDA}"

WORK="/work"
rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"

report_error() {
  code=$?
  msg="Montaje falló (exit $code). Revisa la ejecución de Cloud Run para el detalle."
  printf '%s\n' "$msg" >/tmp/anime-studio-error.txt
  gcloud storage cp /tmp/anime-studio-error.txt "$TRABAJO/error.txt" >/dev/null 2>&1 || true
  exit "$code"
}
trap report_error ERR

gcloud storage cp "$TRABAJO/descargas.txt" ./descargas.txt
gcloud storage cp "$TRABAJO/montar.sh" ./montar.sh
chmod +x montar.sh

while IFS=$'\t' read -r src dst; do
  [[ -z "${src:-}" || -z "${dst:-}" ]] && continue
  mkdir -p "$(dirname "$dst")"
  gcloud storage cp "$src" "$dst"
done < descargas.txt

./montar.sh

OUT="$(find . -maxdepth 1 -type f -name 'DIEZMO-EP*.mp4' -print -quit)"
if [[ -z "$OUT" ]]; then
  echo "El script terminó pero no produjo DIEZMO-EP*.mp4" >&2
  exit 22
fi

gcloud storage cp "$OUT" "$SALIDA"
printf '' >/tmp/anime-studio-error.txt
gcloud storage cp /tmp/anime-studio-error.txt "$TRABAJO/error.txt" >/dev/null 2>&1 || true

echo "Montaje subido: $SALIDA"
