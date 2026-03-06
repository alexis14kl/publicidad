#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no esta instalado."
  echo "Instala con Homebrew: brew install node"
  exit 1
fi

if [ ! -f package.json ]; then
  cat > package.json <<'JSON'
{
  "name": "publicidad-dicloak",
  "private": true,
  "version": "1.0.0",
  "description": "Automatizacion de apertura de perfil DiCloak por CDP",
  "scripts": {
    "open:profile": "node force_open_profile_cdp.js"
  },
  "dependencies": {
    "playwright": "^1.53.0"
  }
}
JSON
  echo "[OK] package.json creado."
fi

echo "[INFO] Instalando dependencias npm..."
npm install

echo "[OK] Configuracion macOS completa."
echo "Siguiente paso:"
echo "  ./abrir_dicloak_y_chatgpt_mac.sh \"#1 Chat Gpt PRO\" \"http://127.0.0.1:9333\""
