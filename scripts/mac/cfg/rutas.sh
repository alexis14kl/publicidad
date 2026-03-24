#!/bin/bash
# =============================================
#  Rutas centralizadas del proyecto (macOS)
#  Todas relativas a ROOT_DIR (raiz del proyecto)
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CFG_DIR="$ROOT_DIR/cfg"
export INICIO_DIR="$ROOT_DIR/inicio"
export PERFIL_DIR="$ROOT_DIR/perfil"
export CDP_DIR="$ROOT_DIR/cdp"
export PROMPT_DIR="$ROOT_DIR/prompt"
export SERVER_DIR="$ROOT_DIR/server"
export UTILS_DIR="$ROOT_DIR/utils"
export DEBUG_DIR="$ROOT_DIR/debug"
export DOCS_DIR="$ROOT_DIR/docs"
export IMG_PUBLICITARIAS_DIR="$ROOT_DIR/img_publicitarias"
export LOGS_DIR="$ROOT_DIR/logs"

# --- Scripts ---
export KILLER_SH="$ROOT_DIR/run_mac/inicio/cerrar_dicloak.sh"
export SCRIPT_PATH="$PERFIL_DIR/abrir_perfil_dicloak.js"
export FORCE_OPEN_JS="$PERFIL_DIR/force_open_profile_cdp.js"
export FORCE_CDP_SH="$ROOT_DIR/run_mac/cdp/forzar_cdp_perfil.sh"
export FORCE_CDP_LAUNCHER_SH="$ROOT_DIR/run_mac/cdp/forzar_cdp_post_apertura.sh"
export GET_DEBUG_PORT_SH="$ROOT_DIR/run_mac/cdp/obtener_puerto_cdp.sh"
export CHANGE_COUNT_PY="$PERFIL_DIR/change_count.py"
export PROMPT_AUTOMATION_PY="$PROMPT_DIR/page_pronmt.py"
export DOWNLOAD_GENERATED_IMAGE_PY="$PROMPT_DIR/download_generated_image.py"
export N8N_PROMPT_CLIENT_PY="$UTILS_DIR/n8n_prompt_client.py"
export PUBLIC_IMG_PY="$ROOT_DIR/n8n/public_img.py"
export N8N_POST_TEXT_CLIENT_PY="$UTILS_DIR/n8n_post_text_client.py"
export BOT_RUNNER_PY="$SERVER_DIR/bot_runner.py"
export JOB_POLLER_PY="$SERVER_DIR/job_poller.py"
export RUN_WITH_PROGRESS_PY="$UTILS_DIR/run_with_progress.py"

# --- Logger (funcion bash) ---
log_step()  { echo "[STEP] $1"; }
log_info()  { echo "[INFO] $1"; }
log_ok()    { echo "[OK] $1"; }
log_warn()  { echo "[WARN] $1"; }
log_error() { echo "[ERROR] $1"; }
log_debug() { echo "[DEBUG] $1"; }

# --- Datos ---
export PROMPT_FILE="$UTILS_DIR/prontm.txt"
export PROMPT_SEED_FILE="$UTILS_DIR/prompt_seed.txt"
export POST_TEXT_FILE="$UTILS_DIR/post_text.txt"
export JOB_POLLER_LOG="$LOGS_DIR/job_poller.log"

# --- DiCloak (buscar dinamicamente) ---
export DICLOAK_APP=""
if [ -d "/Applications/DICloak.app" ]; then
    DICLOAK_APP="/Applications/DICloak.app"
elif [ -d "$HOME/Applications/DICloak.app" ]; then
    DICLOAK_APP="$HOME/Applications/DICloak.app"
fi

# --- DiCloak data dir ---
export DICLOAK_DATA_DIR="$HOME/Library/Application Support/DICloak"
export CDP_DEBUG_INFO="$DICLOAK_DATA_DIR/cdp_debug_info.json"
