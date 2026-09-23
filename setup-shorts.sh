#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo 'Falta Python 3 en este entorno. Abre Cloud Shell desde el botón.'; exit 1; }
exec python3 "$ROOT/infra/shorts/install.py" "$@"
