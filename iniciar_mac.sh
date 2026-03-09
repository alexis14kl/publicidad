#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PROFILE_NAME="${1:-#1 Chat Gpt PRO}"
PROFILE_DEBUG_PORT_HINT="${2:-}"
RUN_MODE="${3:-}"
OPENAPI_PORT_HINT="${4:-}"
OPENAPI_SECRET_HINT="${5:-}"

DICLOAK_APP_PATH="${DICLOAK_APP_PATH:-/Applications/DICloak.app}"
DICLOAK_MAIN_CDP_URL="${DICLOAK_MAIN_CDP_URL:-http://127.0.0.1:9333}"
NO_PAUSE="${NO_PAUSE:-0}"

N8N_PROMPT_CLIENT_PY="$ROOT_DIR/utils/n8n_prompt_client.py"
N8N_POST_TEXT_CLIENT_PY="$ROOT_DIR/utils/n8n_post_text_client.py"
PROMPT_SEED_FILE="$ROOT_DIR/utils/prompt_seed.txt"
PROMPT_FILE="$ROOT_DIR/utils/prontm.txt"
POST_TEXT_FILE="$ROOT_DIR/utils/post_text.txt"
FORCE_OPEN_JS="$ROOT_DIR/perfil/force_open_profile_cdp.js"
DETECT_CDP_MAC_SH="$ROOT_DIR/detectar_cdp_mac.sh"
POST_OPEN_PIPELINE_SH="$ROOT_DIR/cdp/forzar_cdp_post_apertura_mac.sh"

log_info() { echo "[INFO] $*"; }
log_ok() { echo "[OK] $*"; }
log_warn() { echo "[WARN] $*"; }
log_error() { echo "[ERROR] $*" >&2; }

pause_if_needed() {
  if [[ "$NO_PAUSE" != "1" ]]; then
    echo
    read -r -p "Pulsa Enter para cerrar..." _ || true
  fi
}

run_python() {
  if command -v python >/dev/null 2>&1; then
    python "$@"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 "$@"
    return $?
  fi
  log_error "No se encontro Python (python/python3)."
  return 1
}

wait_for_cdp() {
  local base_url="$1"
  local timeout_sec="${2:-90}"
  local started
  started="$(date +%s)"
  while true; do
    if curl -s --max-time 2 "${base_url}/json/version" | grep -q "webSocketDebuggerUrl"; then
      return 0
    fi
    local now
    now="$(date +%s)"
    if (( now - started >= timeout_sec )); then
      return 1
    fi
    sleep 1
  done
}

detect_profile_port() {
  local hinted="${1:-}"
  if [[ "$hinted" =~ ^[0-9]+$ ]]; then
    echo "$hinted"
    return 0
  fi

  if [[ "$hinted" =~ ^https?:// ]]; then
    local p
    p="$(echo "$hinted" | sed -nE 's#.*:([0-9]{2,5}).*#\1#p' | head -n1)"
    if [[ "$p" =~ ^[0-9]+$ ]]; then
      echo "$p"
      return 0
    fi
  fi

  if [[ -x "$DETECT_CDP_MAC_SH" ]]; then
    local out
    out="$("$DETECT_CDP_MAC_SH" 2>/dev/null || true)"
    local p
    p="$(echo "$out" | sed -nE 's/.*CDP_URL=http:\/\/127\.0\.0\.1:([0-9]{2,5}).*/\1/p' | tail -n1)"
    if [[ "$p" =~ ^[0-9]+$ ]]; then
      echo "$p"
      return 0
    fi
  fi

  echo "9225"
}

main() {
  log_info "[1/10] Generando prompt inicial con IA de n8n..."
  if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    log_warn "Python no esta disponible en PATH. Se conserva el prompt actual."
  elif [[ ! -f "$N8N_PROMPT_CLIENT_PY" ]]; then
    log_warn "No existe cliente n8n: $N8N_PROMPT_CLIENT_PY"
  elif [[ ! -f "$PROMPT_SEED_FILE" ]]; then
    log_warn "No existe brief base: $PROMPT_SEED_FILE"
  else
    if run_python "$N8N_PROMPT_CLIENT_PY" --idea-file "$PROMPT_SEED_FILE" --output "$PROMPT_FILE"; then
      log_ok "Prompt regenerado en $PROMPT_FILE"
      if [[ -f "$N8N_POST_TEXT_CLIENT_PY" ]]; then
        if run_python "$N8N_POST_TEXT_CLIENT_PY" --prompt-file "$PROMPT_FILE" --output "$POST_TEXT_FILE"; then
          log_ok "Caption regenerado en $POST_TEXT_FILE"
        else
          log_warn "No se pudo regenerar el caption con n8n. Se conserva el actual."
        fi
      fi
    else
      log_warn "No se pudo regenerar el prompt con n8n. Se usa el contenido actual."
    fi
  fi

  log_info "[2/10] Cerrando procesos (DICloak, ginsbrowser, Chrome)..."
  pkill -f "DICloak" >/dev/null 2>&1 || true
  pkill -f "ginsbrowser" >/dev/null 2>&1 || true
  pkill -f "Google Chrome" >/dev/null 2>&1 || true
  sleep 1

  log_info "[3/10] Limpieza adicional completada."
  log_info "[4/10] Iniciando DICloak en modo debug (9333)..."
  if [[ -d "$DICLOAK_APP_PATH" ]]; then
    open -na "$DICLOAK_APP_PATH" --args --remote-debugging-port=9333 --remote-allow-origins=* >/dev/null 2>&1 || true
  else
    log_warn "No se encontro app en $DICLOAK_APP_PATH. Intentando por nombre de bundle..."
    open -na "DICloak" --args --remote-debugging-port=9333 --remote-allow-origins=* >/dev/null 2>&1 || true
  fi

  log_info "[5/10] Esperando CDP en $DICLOAK_MAIN_CDP_URL..."
  if ! wait_for_cdp "$DICLOAK_MAIN_CDP_URL" 90; then
    log_error "CDP no respondio en $DICLOAK_MAIN_CDP_URL"
    pause_if_needed
    return 1
  fi

  log_info "[6/10] Verificando Node.js..."
  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js no esta disponible en PATH."
    pause_if_needed
    return 1
  fi

  log_info "[7/10] Abriendo perfil: $PROFILE_NAME"
  if [[ ! -f "$FORCE_OPEN_JS" ]]; then
    log_error "No existe script de apertura por CDP: $FORCE_OPEN_JS"
    pause_if_needed
    return 1
  fi
  if ! node "$FORCE_OPEN_JS" "$PROFILE_NAME" "$DICLOAK_MAIN_CDP_URL"; then
    log_error "No se pudo abrir el perfil automaticamente."
    pause_if_needed
    return 1
  fi

  log_info "[8/10] Resolviendo puerto CDP real del perfil..."
  local profile_port
  profile_port="$(detect_profile_port "$PROFILE_DEBUG_PORT_HINT")"
  export CDP_PROFILE_PORT="$profile_port"
  log_ok "Puerto CDP de perfil: $CDP_PROFILE_PORT"

  log_info "[9/10] Ejecutando pipeline post-apertura..."
  if [[ ! -x "$POST_OPEN_PIPELINE_SH" ]]; then
    log_error "No existe pipeline post-apertura: $POST_OPEN_PIPELINE_SH"
    pause_if_needed
    return 1
  fi
  "$POST_OPEN_PIPELINE_SH" "$CDP_PROFILE_PORT"

  log_ok "[10/10] Flujo macOS finalizado."
  log_info "RUN_MODE=$RUN_MODE OPENAPI_PORT_HINT=$OPENAPI_PORT_HINT OPENAPI_SECRET_HINT=${OPENAPI_SECRET_HINT:+***}"
  pause_if_needed
}

main "$@"
