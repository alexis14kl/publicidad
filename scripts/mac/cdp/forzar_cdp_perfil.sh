#!/bin/bash
# =============================================
#  Wrapper macOS para forzar CDP del perfil
#  Delegado a la implementacion Python portable
# =============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PREFERRED_PORT="${1:-9225}"
TIMEOUT_SEC="${2:-60}"
OPEN_DEBUG="${3:-}"

CMD=(python3 "$ROOT_DIR/cdp/force_cdp.py" --preferred-port "$PREFERRED_PORT" --timeout "$TIMEOUT_SEC")

if [ -n "${OPEN_DEBUG:-}" ]; then
  :
fi

exec "${CMD[@]}"
