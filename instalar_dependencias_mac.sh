#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh"
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "[OK] Node y npm ya estan instalados."
  exit 0
fi

if command -v xcode-select >/dev/null 2>&1 && ! xcode-select -p >/dev/null 2>&1; then
  echo "[INFO] Instalando Command Line Tools..."
  xcode-select --install || true
  echo "[WARN] Completa la instalacion de Xcode CLT y vuelve a ejecutar este script."
  exit 1
fi

# 1) Intento con Homebrew si existe (sin instalar brew para evitar sudo).
if command -v brew >/dev/null 2>&1; then
  echo "[INFO] Instalando Node.js con Homebrew..."
  brew install node || true
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "[OK] Node y npm instalados."
  echo "[NEXT] Ejecuta: ./setup_mac.sh"
  exit 0
fi

# 2) Fallback sin admin: NVM en directorio de usuario.
echo "[INFO] Instalando Node.js via NVM (sin sudo)..."
mkdir -p "${NVM_DIR}"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "${NVM_DIR}/nvm.sh"
else
  echo "[ERROR] No se pudo cargar nvm.sh"
  exit 1
fi

nvm install --lts
nvm alias default 'lts/*'

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "[OK] Node y npm instalados via NVM."
  echo "[INFO] Si cierras terminal, carga nvm con:"
  echo "  export NVM_DIR=\"\$HOME/.nvm\""
  echo "  [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\""
  echo "[NEXT] Ejecuta: ./setup_mac.sh"
else
  echo "[ERROR] No se pudo instalar Node.js automaticamente."
  exit 1
fi
