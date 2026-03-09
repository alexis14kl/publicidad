#!/bin/bash
# =============================================
#  Lanzar poller en background (macOS)
#  Equivalente de iniciar_poller_oculto.ps1
# =============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER="$SCRIPT_DIR/iniciar_poller.sh"

if [ ! -f "$LAUNCHER" ]; then
    echo "[ERROR] No existe el launcher: $LAUNCHER"
    exit 1
fi

nohup bash "$LAUNCHER" >/dev/null 2>&1 &
echo "[OK] Worker iniciado en background (PID: $!)"
