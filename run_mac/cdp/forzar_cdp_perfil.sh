#!/bin/bash
# =============================================
#  Forzar CDP en perfil DiCloak (macOS)
#  Equivalente de forzar_cdp_perfil_dicloak.ps1
# =============================================

PREFERRED_PORT="${1:-9225}"
TIMEOUT_SEC="${2:-60}"
OPEN_DEBUG="${3:-}"

DICLOAK_DATA="$HOME/Library/Application Support/DICloak"
CDP_INFO="$DICLOAK_DATA/cdp_debug_info.json"

# Buscar proceso principal de ginsbrowser (sin --type=)
get_main_gins_pid() {
    ps auxww | grep -i "GinsBrowser" | grep -v "grep" | grep -v "\-\-type=" | awk '{print $2}' | head -1
}

get_main_gins_cmd() {
    MAIN_PID=$(get_main_gins_pid)
    [ -z "$MAIN_PID" ] && return 1
    ps -o command= -p "$MAIN_PID" 2>/dev/null
}

extract_env_id() {
    python3 - "$1" <<'PY'
import re
import sys
cmd = sys.argv[1]
match = re.search(r"\.DICloakCache/(\d{10,})/", cmd)
print(match.group(1) if match else "")
PY
}

extract_debug_port() {
    python3 - "$1" <<'PY'
import re
import sys
cmd = sys.argv[1]
match = re.search(r"--remote-debugging-port(?:=| )(\d+)", cmd)
print(match.group(1) if match else "")
PY
}

test_cdp_port() {
    local port=$1
    curl -s --max-time 2 "http://127.0.0.1:$port/json/version" 2>/dev/null | grep -q "webSocketDebuggerUrl"
}

get_free_port() {
    local start=$1
    local span=${2:-200}
    for ((p=start; p<=start+span; p++)); do
        if ! lsof -ti :$p >/dev/null 2>&1; then
            echo $p
            return
        fi
    done
    echo $start
}

upsert_cdp_info() {
    local port=$1
    local ws_url=$2
    local pid=$3
    local env_id="${4:-unknown_env}"

    mkdir -p "$(dirname "$CDP_INFO")"

    if [ -f "$CDP_INFO" ]; then
        EXISTING=$(cat "$CDP_INFO" 2>/dev/null || echo "{}")
    else
        EXISTING="{}"
    fi

    python3 -c "
import json, sys
try:
    data = json.loads('''$EXISTING''')
except:
    data = {}
data['$env_id'] = {
    'debugPort': $port,
    'webSocketUrl': '$ws_url',
    'pid': $pid,
    'envId': '$env_id'
}
print(json.dumps(data, indent=2))
" > "$CDP_INFO" 2>/dev/null

    echo "$CDP_INFO"
}

# --- Main ---
MAIN_PID=$(get_main_gins_pid)
if [ -z "$MAIN_PID" ]; then
    echo "ERROR=NO_MAIN_GINS_PROCESS"
    exit 1
fi

CMD=$(get_main_gins_cmd)

# Extraer env_id del comando
ENV_ID=$(extract_env_id "$CMD")
[ -z "$ENV_ID" ] && ENV_ID="unknown_env"

# Verificar si ya tiene debug port activo
EXISTING_PORT=$(extract_debug_port "$CMD")
if [ -n "$EXISTING_PORT" ] && test_cdp_port "$EXISTING_PORT"; then
    WS_URL=$(curl -s "http://127.0.0.1:$EXISTING_PORT/json/version" | python3 -c "import json,sys; print(json.load(sys.stdin).get('webSocketDebuggerUrl',''))" 2>/dev/null)
    CDP_PATH=$(upsert_cdp_info "$EXISTING_PORT" "$WS_URL" "$MAIN_PID" "$ENV_ID")
    echo "DEBUG_PORT=$EXISTING_PORT"
    echo "CDP_JSON_PATH=$CDP_PATH"
    exit 0
fi

# Necesita reiniciar con debug port
TARGET_PORT=$(get_free_port "$PREFERRED_PORT")

# Matar ginsbrowser actual
pkill -f "ginsbrowser" 2>/dev/null
sleep 1

# Reconstruir comando con debug port
if echo "$CMD" | grep -q "\-\-remote-debugging-port"; then
    NEW_CMD=$(echo "$CMD" | sed -E "s/--remote-debugging-port[= ][0-9]+/--remote-debugging-port=$TARGET_PORT/")
else
    NEW_CMD="$CMD --remote-debugging-port=$TARGET_PORT"
fi

# Lanzar el proceso preservando espacios en rutas
NEW_PID=$(python3 - "$NEW_CMD" <<'PY'
import os
import re
import subprocess
import sys

cmd = sys.argv[1]
match = re.match(r"^(.*?/Contents/MacOS/GinsBrowser)(?:\s+(.*))?$", cmd)
if not match:
    print("", end="")
    raise SystemExit(1)

exe_path = match.group(1)
rest = match.group(2) or ""
args = [exe_path]

def is_url(token: str) -> bool:
    return token.startswith("http://") or token.startswith("https://")

if rest:
    raw_parts = rest.split()
    rebuilt = []
    i = 0
    while i < len(raw_parts):
        token = raw_parts[i]
        if is_url(token):
            rebuilt.append(token)
            i += 1
            continue

        current = token
        j = i + 1
        while j < len(raw_parts) and not raw_parts[j].startswith("--") and not is_url(raw_parts[j]):
            current += " " + raw_parts[j]
            j += 1
        rebuilt.append(current)
        i = j

    args.extend(rebuilt)

proc = subprocess.Popen(
    args,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
print(proc.pid)
PY
)
[ -n "$NEW_PID" ] || {
    echo "ERROR=RELAUNCH_FAILED"
    exit 1
}

# Esperar a que CDP responda
DEADLINE=$((SECONDS + TIMEOUT_SEC))
OK=0
while [ $SECONDS -lt $DEADLINE ]; do
    if test_cdp_port "$TARGET_PORT"; then
        OK=1
        break
    fi
    sleep 0.6
done

if [ $OK -eq 0 ]; then
    echo "ERROR=DEBUG_PORT_NOT_READY PORT=$TARGET_PORT"
    exit 1
fi

WS_URL=$(curl -s "http://127.0.0.1:$TARGET_PORT/json/version" | python3 -c "import json,sys; print(json.load(sys.stdin).get('webSocketDebuggerUrl',''))" 2>/dev/null)
CDP_PATH=$(upsert_cdp_info "$TARGET_PORT" "$WS_URL" "$NEW_PID" "$ENV_ID")

echo "DEBUG_PORT=$TARGET_PORT"
echo "DEBUG_WS=$WS_URL"
echo "PID=$NEW_PID"
echo "ENV_ID=$ENV_ID"
echo "CDP_JSON_PATH=$CDP_PATH"

exit 0
