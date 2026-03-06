#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PROFILE_NAME="${1:-#1 Chat Gpt PRO}"
CDP_URL="${2:-http://127.0.0.1:9333}"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no esta instalado. Ejecuta primero: ./setup_mac.sh"
  exit 1
fi

if [ ! -d node_modules/playwright ]; then
  echo "[WARN] Dependencias no detectadas. Ejecutando setup..."
  ./setup_mac.sh
fi

echo "[INFO] Perfil: $PROFILE_NAME"
echo "[INFO] CDP URL: $CDP_URL"
echo "[INFO] Ejecutando apertura de perfil..."
node force_open_profile_cdp.js "$PROFILE_NAME" "$CDP_URL"
