#!/bin/bash
# =============================================
#  noyecodito_fb - Orquestador principal (macOS)
#  Equivalente de iniciar.bat
# =============================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/cfg/rutas.sh"

PROFILE_NAME="${1:-#1 Chat Gpt PRO}"
CDP_URL="http://127.0.0.1:9333"
PROFILE_WARMUP_SEC=20

# Consultar memoria de perfiles para evitar abrir uno vencido
BEST=$(python3 "$ROOT_DIR/perfil/profile_memory.py" --best-profile "#1 Chat Gpt PRO" "#4 Chat Gpt Plus" "#2 Chat Gpt PRO" "#5 Chat Gpt PRO" "#3 Chat Gpt PRO" 2>/dev/null)
[ -n "$BEST" ] && PROFILE_NAME="$BEST"

# Verificar DiCloak
if [ -z "$DICLOAK_APP" ] || [ ! -d "$DICLOAK_APP" ]; then
    log_error "No se encontro DiCloak. Instale desde dicloak.com"
    exit 1
fi

# --- STEP 1: Generar prompt ---
log_step "1/10 Generando prompt inicial con IA de n8n..."
if command -v python3 &>/dev/null && [ -f "$N8N_PROMPT_CLIENT_PY" ] && [ -f "$PROMPT_SEED_FILE" ]; then
    python3 "$N8N_PROMPT_CLIENT_PY" --idea-file "$PROMPT_SEED_FILE" --output "$PROMPT_FILE" && {
        log_ok "Prompt regenerado en $PROMPT_FILE."
        [ -f "$N8N_POST_TEXT_CLIENT_PY" ] && {
            python3 "$N8N_POST_TEXT_CLIENT_PY" --prompt-file "$PROMPT_FILE" --output "$POST_TEXT_FILE" && \
                log_ok "Caption regenerado en $POST_TEXT_FILE." || \
                log_warn "No se pudo regenerar el caption."
        }
    } || log_warn "No se pudo regenerar el prompt. Se usara el actual."
else
    log_warn "Faltan dependencias para generar prompt. Se conserva el actual."
fi

# --- STEP 2: Matar procesos ---
log_step "2/10 Cerrando procesos DiCloak anteriores..."
pkill -if "DICloak" 2>/dev/null || true
pkill -if "GinsBrowser" 2>/dev/null || true
sleep 1

# --- STEP 3: Limpieza avanzada ---
log_step "3/10 Limpieza avanzada de procesos DiCloak..."
bash "$KILLER_SH" -q 9333 60
if [ $? -ne 0 ]; then
    log_error "No se pudo cerrar completamente DiCloak."
    exit 1
fi

# --- STEP 4: Iniciar DiCloak ---
log_step "4/10 Iniciando DiCloak en modo debug (9333)..."
rm -f "$DICLOAK_DATA_DIR/DevToolsActivePort" "$CDP_DEBUG_INFO" 2>/dev/null || true
open -na "$DICLOAK_APP" --args --remote-debugging-port=9333 --remote-allow-origins=* >/dev/null 2>&1 || true
APP_READY=0
for _ in $(seq 1 15); do
    if ps auxww | grep -iE 'DICloak|GinsBrowser' | grep -v 'grep' >/dev/null 2>&1; then
        APP_READY=1
        break
    fi
    sleep 1
done
if [ "$APP_READY" -ne 1 ]; then
  log_warn "DiCloak no fue visible de inmediato. Se valida por CDP en el siguiente paso."
fi

# --- STEP 5: Esperar CDP ---
log_step "5/10 Esperando CDP en puerto 9333..."
CDP_OK=0
for i in $(seq 1 90); do
    if curl -s --max-time 2 "$CDP_URL/json/version" 2>/dev/null | grep -q "webSocketDebuggerUrl"; then
        CDP_OK=1
        break
    fi
    sleep 1
done

if [ $CDP_OK -eq 0 ]; then
    # Intentar DevToolsActivePort
    ACTIVE_PORT_FILE="$DICLOAK_DATA_DIR/DevToolsActivePort"
    if [ -f "$ACTIVE_PORT_FILE" ]; then
        ACTIVE_PORT=$(head -1 "$ACTIVE_PORT_FILE")
        if [ -n "$ACTIVE_PORT" ]; then
            CDP_URL="http://127.0.0.1:$ACTIVE_PORT"
            log_info "Puerto detectado por DevToolsActivePort: $ACTIVE_PORT"
            CDP_OK=0
            for i in $(seq 1 45); do
                if curl -s --max-time 2 "$CDP_URL/json/version" 2>/dev/null | grep -q "webSocketDebuggerUrl"; then
                    CDP_OK=1
                    break
                fi
                sleep 1
            done
        fi
    fi
    if [ $CDP_OK -eq 0 ]; then
        log_error "CDP no respondio en $CDP_URL."
        exit 1
    fi
fi

# --- STEP 6: Verificar Node.js ---
log_step "6/10 Verificando Node.js..."
if ! command -v node &>/dev/null; then
    log_error "Node.js no esta disponible. Instale con: brew install node"
    exit 1
fi

# --- STEP 7: Abrir perfil ---
log_step "7/10 Abriendo perfil: $PROFILE_NAME"
PROFILE_OPEN=0
if node "$SCRIPT_PATH" "$PROFILE_NAME" "$CDP_URL"; then
    PROFILE_OPEN=1
else
    log_warn "Flujo principal fallo. Intentando apertura forzada..."
    if [ -f "$FORCE_OPEN_JS" ]; then
        node "$FORCE_OPEN_JS" "$PROFILE_NAME" "$CDP_URL" && PROFILE_OPEN=1
    fi
    if [ $PROFILE_OPEN -eq 0 ] && pgrep -if "GinsBrowser" >/dev/null 2>&1; then
        log_info "Se detecto ginsbrowser activo; se continua."
        PROFILE_OPEN=1
    fi
fi

if [ $PROFILE_OPEN -eq 0 ]; then
    log_error "No se pudo abrir el perfil automaticamente."
    exit 1
fi

# --- STEP 7.5: Warmup ---
log_step "7.5/10 Esperando hidratacion de sesion del perfil..."
sleep "$PROFILE_WARMUP_SEC"

# --- STEP 8: Forzar CDP del perfil ---
if [ -f "$FORCE_CDP_SH" ]; then
    log_step "8/10 Ejecutando forzado CDP del perfil..."
    # Lanzar post-apertura en background
    bash "$FORCE_CDP_LAUNCHER_SH" &
    FORCE_PID=$!

    # Esperar debugPort
    log_info "Esperando debugPort en cdp_debug_info.json (hasta 45s)..."
    CDP_INFO="$DICLOAK_DATA_DIR/cdp_debug_info.json"
    DB_OK=0
    for i in $(seq 1 45); do
        if [ -f "$CDP_INFO" ]; then
            python3 -c "
import json
data = json.load(open('$CDP_INFO'))
for k,v in data.items():
    if isinstance(v,dict) and v.get('debugPort'):
        exit(0)
exit(1)
" 2>/dev/null && { DB_OK=1; break; }
        fi
        sleep 1
    done
    [ $DB_OK -eq 1 ] && log_ok "debugPort detectado." || log_warn "No se detecto debugPort."
else
    log_warn "No existe $FORCE_CDP_SH. Omitiendo forzado CDP."
fi

# --- STEP 9: Detectar puerto real ---
if [ -f "$GET_DEBUG_PORT_SH" ]; then
    log_step "9/10 Detectando puerto real del perfil..."
    bash "$GET_DEBUG_PORT_SH" 120
fi

# --- STEP 10: Listo ---
log_step "10/10 Perfil abierto: $PROFILE_NAME"
echo ""
log_ok "Bot listo. El worker se encargara del resto."
