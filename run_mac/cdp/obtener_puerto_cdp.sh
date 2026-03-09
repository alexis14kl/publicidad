#!/bin/bash
# =============================================
#  Obtener puerto CDP real del perfil (macOS)
#  Equivalente de obtener_puerto_perfil_cdp.ps1
# =============================================

TIMEOUT_SEC="${1:-120}"
OPEN_IN_PROFILE="${2:-}"

DICLOAK_DATA="$HOME/Library/Application Support/DICloak"
CDP_INFO="$DICLOAK_DATA/cdp_debug_info.json"

test_cdp_port() {
    curl -s --max-time 2 "http://127.0.0.1:$1/json/version" 2>/dev/null | grep -q "webSocketDebuggerUrl"
}

# Buscar puerto desde cdp_debug_info.json
if [ -f "$CDP_INFO" ]; then
    PORT=$(python3 -c "
import json
try:
    data = json.load(open('$CDP_INFO'))
    for key, val in data.items():
        if isinstance(val, dict) and val.get('debugPort'):
            print(val['debugPort'])
            break
except:
    pass
" 2>/dev/null)

    if [ -n "$PORT" ] && test_cdp_port "$PORT"; then
        echo "DEBUG_PORT=$PORT"
        echo "SOURCE=cdp_debug_info.json"
        [ -n "$OPEN_IN_PROFILE" ] && open "http://127.0.0.1:$PORT/json" 2>/dev/null
        exit 0
    fi
fi

# Fallback: buscar en el comando de ginsbrowser
CMD=$(ps aux | grep -i "ginsbrowser" | grep -v grep | grep -v "\-\-type=" | head -1)
PORT=$(echo "$CMD" | grep -oP '\-\-remote-debugging-port[= ](\d+)' | grep -oP '\d+')

if [ -n "$PORT" ] && test_cdp_port "$PORT"; then
    echo "DEBUG_PORT=$PORT"
    echo "SOURCE=process_cmdline"
    [ -n "$OPEN_IN_PROFILE" ] && open "http://127.0.0.1:$PORT/json" 2>/dev/null
    exit 0
fi

# Escaneo de puertos comunes
for P in 9225 9226 9227 9228 9229 9230; do
    if test_cdp_port "$P"; then
        echo "DEBUG_PORT=$P"
        echo "SOURCE=port_scan"
        [ -n "$OPEN_IN_PROFILE" ] && open "http://127.0.0.1:$P/json" 2>/dev/null
        exit 0
    fi
done

echo "ERROR=NO_DEBUG_PORT_FOUND"
exit 1
