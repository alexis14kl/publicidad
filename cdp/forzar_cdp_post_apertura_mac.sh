#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT_AUTOMATION_PY="$ROOT_DIR/prompt/page_pronmt.py"
DOWNLOAD_GENERATED_IMAGE_PY="$ROOT_DIR/prompt/download_generated_image.py"
PUBLIC_IMG_PY="$ROOT_DIR/n8n/public_img.py"
DETECT_CDP_MAC_SH="$ROOT_DIR/detectar_cdp_mac.sh"

log_info() { echo "[INFO] $*"; }
log_ok() { echo "[OK] $*"; }
log_warn() { echo "[WARN] $*"; }
log_error() { echo "[ERROR] $*" >&2; }

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

detect_profile_port() {
  local hinted="${1:-}"
  if [[ "$hinted" =~ ^[0-9]+$ ]]; then
    echo "$hinted"
    return 0
  fi

  if [[ -n "${CDP_PROFILE_PORT:-}" && "${CDP_PROFILE_PORT:-}" =~ ^[0-9]+$ ]]; then
    echo "$CDP_PROFILE_PORT"
    return 0
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
  cd "$ROOT_DIR"
  local hinted_port="${1:-}"
  local profile_port
  profile_port="$(detect_profile_port "$hinted_port")"
  export CDP_PROFILE_PORT="$profile_port"

  log_info "Pipeline post-apertura iniciado (macOS)."
  log_info "CDP_PROFILE_PORT=$CDP_PROFILE_PORT"

  if [[ ! -f "$PROMPT_AUTOMATION_PY" ]]; then
    log_error "No existe script de automatizacion: $PROMPT_AUTOMATION_PY"
    return 1
  fi

  log_info "Ejecutando pegado de prompt..."
  if ! run_python "$PROMPT_AUTOMATION_PY"; then
    log_warn "No se pudo ejecutar page_pronmt.py correctamente."
    return 1
  fi
  log_ok "Prompt pegado con exito."

  if [[ ! -f "$DOWNLOAD_GENERATED_IMAGE_PY" ]]; then
    log_warn "No existe script de descarga: $DOWNLOAD_GENERATED_IMAGE_PY"
    return 0
  fi

  log_info "Esperando y descargando imagen generada..."
  if ! run_python "$DOWNLOAD_GENERATED_IMAGE_PY" "$CDP_PROFILE_PORT"; then
    log_warn "No se pudo descargar la imagen generada."
    return 1
  fi
  log_ok "Imagen descargada con exito."

  if [[ ! -f "$PUBLIC_IMG_PY" ]]; then
    log_warn "No existe script de publicacion local a n8n: $PUBLIC_IMG_PY"
    return 0
  fi

  log_info "Enviando imagen local a n8n para publicacion..."
  if ! run_python "$PUBLIC_IMG_PY"; then
    log_warn "No se pudo enviar la imagen local a n8n."
    return 1
  fi
  log_ok "Imagen enviada a n8n con exito."
}

main "$@"
