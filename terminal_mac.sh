#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Uso:
  ./terminal_mac.sh setup
  ./terminal_mac.sh detect
  ./terminal_mac.sh debug [PUERTO]
  ./terminal_mac.sh open [NOMBRE_PERFIL] [CDP_URL]
  ./terminal_mac.sh full [NOMBRE_PERFIL] [PROFILE_DEBUG_PORT_HINT]

Comandos:
  setup   Instala dependencias del entorno macOS.
  detect  Detecta el debugPort del perfil desde cdp_debug_info.json.
  debug   Verifica y abre http://127.0.0.1:PUERTO/json (default 9333).
  open    Abre perfil en DiCloak via CDP principal.
  full    Ejecuta el flujo completo equivalente a iniciar.bat.
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  setup)
    ./setup_mac.sh
    ;;
  detect)
    ./detectar_cdp_mac.sh
    ;;
  debug)
    port="${1:-9333}"
    url="http://127.0.0.1:${port}/json"
    if curl -s --max-time 3 "http://127.0.0.1:${port}/json/version" | grep -q "webSocketDebuggerUrl"; then
      echo "[OK] CDP activo en puerto ${port}"
      echo "[INFO] Abriendo ${url}"
      open "$url" >/dev/null 2>&1 || true
    else
      echo "[ERROR] CDP no esta disponible en puerto ${port}" >&2
      exit 1
    fi
    ;;
  open)
    profile_name="${1:-#1 Chat Gpt PRO}"
    cdp_url="${2:-http://127.0.0.1:9333}"
    node perfil/force_open_profile_cdp.js "$profile_name" "$cdp_url"
    ;;
  full)
    profile_name="${1:-#1 Chat Gpt PRO}"
    profile_port_hint="${2:-}"
    ./iniciar_mac.sh "$profile_name" "$profile_port_hint"
    ;;
  *)
    usage
    exit 1
    ;;
esac
