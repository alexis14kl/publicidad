#!/bin/bash
# =============================================
#  Job Poller - Worker background (macOS)
#  Equivalente de iniciar_poller_background.bat
# =============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/cfg/rutas.sh"

[ ! -f "$JOB_POLLER_PY" ] && { echo "[ERROR] No existe $JOB_POLLER_PY"; exit 1; }
command -v python3 &>/dev/null || { echo "[ERROR] Python3 no disponible"; exit 1; }

mkdir -p "$LOGS_DIR"

export N8N_BASE_URL="${N8N_BASE_URL:-https://n8n-dev.noyecode.com}"
export N8N_LOGIN_EMAIL="${N8N_LOGIN_EMAIL:-andersonbarbosadev@outlook.com}"
export N8N_LOGIN_PASSWORD="${N8N_LOGIN_PASSWORD:-t5x]oIs{7=ISZ}sS}"
export N8N_BOT_QUEUE_MODE="${N8N_BOT_QUEUE_MODE:-datatable}"
export N8N_BOT_EXECUTION_WORKFLOW_ID="${N8N_BOT_EXECUTION_WORKFLOW_ID:-eW5SRNY5r4zfRjIqTw9eP}"
export N8N_BOT_POLL_INTERVAL="${N8N_BOT_POLL_INTERVAL:-15}"
export N8N_BOT_TIMEOUT="${N8N_BOT_TIMEOUT:-60}"
export N8N_BOT_RUN_TIMEOUT="${N8N_BOT_RUN_TIMEOUT:-7200}"
export N8N_BOT_WORKER_ID="${N8N_BOT_WORKER_ID:-$(hostname)}"
export PYTHONUTF8=1
export NO_PAUSE=1

echo "[$(date)] starting job_poller" >> "$JOB_POLLER_LOG"
python3 "$JOB_POLLER_PY" >> "$JOB_POLLER_LOG" 2>&1
echo "[$(date)] job_poller exited with code $?" >> "$JOB_POLLER_LOG"
