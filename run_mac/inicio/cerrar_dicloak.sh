#!/bin/bash
# =============================================
#  Limpieza avanzada de DiCloak (macOS)
#  Equivalente de cerrar_dicloak_avanzado.ps1
# =============================================

QUIET="${1:-}"
PORT="${2:-9333}"
TIMEOUT="${3:-45}"

log() {
    [ "$QUIET" != "-q" ] && echo "$1"
}

log "[INFO] Limpieza de DiCloak iniciada (puerto: $PORT, timeout: ${TIMEOUT}s)"

DEADLINE=$((SECONDS + TIMEOUT))
PASS=0

while [ $SECONDS -lt $DEADLINE ]; do
    PASS=$((PASS + 1))
    log "[INFO] Pass $PASS"

    # Matar procesos DiCloak y ginsbrowser
    pkill -f "DICloak" 2>/dev/null
    pkill -f "ginsbrowser" 2>/dev/null
    pkill -f "DICloakCache" 2>/dev/null

    # Matar procesos en el puerto CDP
    PIDS=$(lsof -ti :$PORT 2>/dev/null)
    if [ -n "$PIDS" ]; then
        log "[KILL] Procesos en puerto $PORT: $PIDS"
        echo "$PIDS" | xargs kill -9 2>/dev/null
    fi

    sleep 0.7

    # Verificar si quedo algo
    SURVIVORS=$(pgrep -f "ginsbrowser|DICloak|DICloakCache" 2>/dev/null)
    PORT_OWNERS=$(lsof -ti :$PORT 2>/dev/null)

    if [ -z "$SURVIVORS" ] && [ -z "$PORT_OWNERS" ]; then
        log "[OK] Limpieza completa: sin procesos residuales."
        exit 0
    fi
done

echo "[ERROR] No se pudo limpiar por completo DiCloak."
pgrep -fl "ginsbrowser|DICloak" 2>/dev/null
exit 1
