#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no esta instalado."
  echo "Instala con Homebrew: brew install node"
  exit 1
fi

echo "[INFO] Instalando dependencias npm..."
npm install
if command -v npx >/dev/null 2>&1; then
  echo "[INFO] Instalando browser Chromium de Playwright..."
  npx playwright install chromium || true
fi

PY_BIN=""
if command -v python >/dev/null 2>&1; then
  PY_BIN="python"
elif command -v python3 >/dev/null 2>&1; then
  PY_BIN="python3"
fi

if [ -z "$PY_BIN" ]; then
  echo "[WARN] Python no esta disponible (python/python3)."
  echo "[WARN] Instala Python 3.10+ para ejecutar el pipeline completo."
else
  if [ -f requirements.txt ]; then
    echo "[INFO] Instalando dependencias Python..."
    "$PY_BIN" -m pip install -r requirements.txt || true
  fi
fi

echo "[OK] Configuracion macOS completa."
echo "Siguiente paso:"
echo "  ./iniciar_mac.sh \"#1 Chat Gpt PRO\""
