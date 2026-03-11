#!/bin/bash
# =============================================
#  Wrapper macOS para detectar puerto CDP real
#  Delegado a la implementacion Python portable
# =============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

TIMEOUT_SEC="${1:-120}"
OPEN_IN_PROFILE="${2:-}"

python3 "$ROOT_DIR/cdp/detect_port.py" --timeout "$TIMEOUT_SEC"

if [ -n "${OPEN_IN_PROFILE:-}" ]; then
  PORT="$(python3 "$ROOT_DIR/cdp/detect_port.py" --timeout 2 2>/dev/null | awk -F= '/^DEBUG_PORT=/{print $2; exit}')"
  if [ -n "$PORT" ]; then
    open "http://127.0.0.1:$PORT/json" 2>/dev/null || true
  fi
fi
