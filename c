#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# iPhone/Cloud Shell entry point: one short command.
# Default updates the existing Cortos installation and runs the guarded real
# image + Japanese voice release checks before any new revision gets traffic.
# Keep the old installer/menu available explicitly for first install/recovery.
if [[ "${1:-}" == "--menu" || "${1:-}" == "--install" ]]; then
  shift || true
  exec bash "$ROOT/setup-shorts.sh" "$@"
fi
exec bash "$ROOT/repair-shorts.sh" "$@"
