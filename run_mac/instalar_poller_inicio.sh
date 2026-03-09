#!/bin/bash
# =============================================
#  Registrar worker en inicio de sesion (macOS)
#  Usa LaunchAgent (equivalente a schtasks ONLOGON)
# =============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.noyecode.botpoller"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
POLLER_SCRIPT="$SCRIPT_DIR/iniciar_poller.sh"

if [ ! -f "$POLLER_SCRIPT" ]; then
    echo "[ERROR] No existe: $POLLER_SCRIPT"
    exit 1
fi

# Crear directorio si no existe
mkdir -p "$HOME/Library/LaunchAgents"

# Descargar si ya existe
launchctl unload "$PLIST_PATH" 2>/dev/null

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$POLLER_SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/../logs/job_poller_launchd.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/../logs/job_poller_launchd_err.log</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"

echo "[OK] Worker registrado en inicio de sesion: $PLIST_NAME"
echo "[INFO] El worker arrancara automaticamente al iniciar sesion."
echo "[INFO] Para desinstalar: launchctl unload $PLIST_PATH && rm $PLIST_PATH"
