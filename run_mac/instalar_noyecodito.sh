#!/bin/bash
# =============================================
#  Instalador noyecodito_fb para macOS
#  Ejecutar: bash instalar_noyecodito.sh
# =============================================

set -e

APP_NAME="noyecodito_fb"
INSTALL_DIR="${1:-$HOME/$APP_NAME}"

echo "============================================"
echo "  Instalador de $APP_NAME para macOS"
echo "============================================"
echo ""

# --- Terminos y condiciones ---
echo "TERMINOS Y CONDICIONES DE USO"
echo "------------------------------"
echo "Al instalar $APP_NAME, usted acepta que:"
echo "  - El software es propiedad de NoyeCode"
echo "  - Se otorga licencia no exclusiva para 1 equipo"
echo "  - El usuario es responsable de cumplir politicas de Facebook/ChatGPT"
echo "  - El software se proporciona 'tal cual'"
echo ""
read -p "Acepta los terminos? (s/n): " ACCEPT
if [ "$ACCEPT" != "s" ] && [ "$ACCEPT" != "S" ]; then
    echo "Instalacion cancelada."
    exit 0
fi
echo ""

# --- Verificar prerequisitos ---
echo "[1/7] Verificando prerequisitos..."

# Python
if ! command -v python3 &>/dev/null; then
    echo "[WARN] Python3 no encontrado. Instalando via Homebrew..."
    if ! command -v brew &>/dev/null; then
        echo "Instalando Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install python@3.12
fi
echo "  [OK] Python3: $(python3 --version)"

# Node.js
if ! command -v node &>/dev/null; then
    echo "[WARN] Node.js no encontrado. Instalando via Homebrew..."
    if ! command -v brew &>/dev/null; then
        echo "Instalando Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node@20
fi
echo "  [OK] Node.js: $(node --version)"

# DiCloak
if [ ! -d "/Applications/DICloak.app" ] && [ ! -d "$HOME/Applications/DICloak.app" ]; then
    echo ""
    echo "[AVISO] DiCloak no encontrado en /Applications/"
    echo "  Descargue desde: https://www.dicloak.com/"
    echo "  Instale DiCloak antes de ejecutar el bot."
    echo ""
fi

# --- Copiar archivos ---
echo ""
echo "[2/7] Copiando archivos a $INSTALL_DIR..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$INSTALL_DIR"

# Copiar estructura del proyecto
for DIR in perfil cdp prompt server utils cfg inicio n8n; do
    if [ -d "$SOURCE_DIR/$DIR" ]; then
        mkdir -p "$INSTALL_DIR/$DIR"
        cp -r "$SOURCE_DIR/$DIR/"* "$INSTALL_DIR/$DIR/" 2>/dev/null || true
    fi
done

# Copiar run_mac
mkdir -p "$INSTALL_DIR/run_mac"
cp -r "$SOURCE_DIR/run_mac/"* "$INSTALL_DIR/run_mac/"

# Copiar archivos raiz
for FILE in package.json requirements.txt; do
    [ -f "$SOURCE_DIR/$FILE" ] && cp "$SOURCE_DIR/$FILE" "$INSTALL_DIR/"
done

# Crear directorios necesarios
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/img_publicitarias"
mkdir -p "$INSTALL_DIR/debug"
mkdir -p "$INSTALL_DIR/memory/profile"

echo "  [OK] Archivos copiados"

# --- Permisos de ejecucion ---
echo ""
echo "[3/7] Configurando permisos..."
chmod +x "$INSTALL_DIR/run_mac/"*.sh
chmod +x "$INSTALL_DIR/run_mac/cdp/"*.sh
chmod +x "$INSTALL_DIR/run_mac/inicio/"*.sh
chmod +x "$INSTALL_DIR/run_mac/cfg/"*.sh
echo "  [OK] Permisos configurados"

# --- Dependencias Python ---
echo ""
echo "[4/7] Instalando dependencias Python..."
python3 -m pip install --upgrade pip --quiet
python3 -m pip install -r "$INSTALL_DIR/requirements.txt" --quiet
echo "  [OK] Dependencias Python instaladas"

# --- Dependencias Node ---
echo ""
echo "[5/7] Instalando dependencias Node.js..."
cd "$INSTALL_DIR"
npm install --silent 2>/dev/null
echo "  [OK] Dependencias Node.js instaladas"

# --- Playwright ---
echo ""
echo "[6/7] Instalando Playwright (Chromium)..."
python3 -m playwright install chromium
echo "  [OK] Playwright instalado"

# --- Registrar worker ---
echo ""
echo "[7/7] Registrando worker en inicio de sesion..."
bash "$INSTALL_DIR/run_mac/instalar_poller_inicio.sh"

# Iniciar worker ahora
bash "$INSTALL_DIR/run_mac/iniciar_poller_bg.sh"

# --- Crear alias ---
echo ""
echo "============================================"
echo "  INSTALACION COMPLETADA"
echo "============================================"
echo ""
echo "  Ubicacion: $INSTALL_DIR"
echo ""
echo "  Comandos:"
echo "    Iniciar bot:    bash $INSTALL_DIR/run_mac/iniciar.sh"
echo "    Worker status:  pgrep -f job_poller"
echo "    Ver logs:       tail -f $INSTALL_DIR/logs/job_poller.log"
echo ""
echo "  El worker ya esta corriendo en background."
echo ""

# Preguntar si crear alias en .zshrc
read -p "Crear alias 'noyecodito' en terminal? (s/n): " CREATE_ALIAS
if [ "$CREATE_ALIAS" = "s" ] || [ "$CREATE_ALIAS" = "S" ]; then
    SHELL_RC="$HOME/.zshrc"
    [ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.bashrc"
    echo "" >> "$SHELL_RC"
    echo "# noyecodito_fb bot" >> "$SHELL_RC"
    echo "alias noyecodito='bash $INSTALL_DIR/run_mac/iniciar.sh'" >> "$SHELL_RC"
    echo "  [OK] Alias creado. Ejecuta 'noyecodito' en una nueva terminal."
fi

echo ""
echo "Listo! El bot esta instalado y el worker activo."
