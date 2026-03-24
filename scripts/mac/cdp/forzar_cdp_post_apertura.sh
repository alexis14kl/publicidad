#!/bin/bash
# =============================================
#  Forzar CDP Post Apertura (macOS)
#  Equivalente de forzar_cdp_post_apertura.bat
# =============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../cfg/rutas.sh"

CDP_INFO="$DICLOAK_DATA_DIR/cdp_debug_info.json"

log_info "Launcher post-apertura iniciado."
echo "Esperando 10s antes de forzar CDP del perfil..."
sleep 10

if [ ! -f "$FORCE_CDP_SH" ]; then
    log_error "No existe script: $FORCE_CDP_SH"
    exit 1
fi

log_info "Ejecutando forzado CDP..."
bash "$FORCE_CDP_SH" 9225 30

if [ $? -ne 0 ]; then
    log_warn "El forzado CDP devolvio error."
else
    log_ok "Forzado CDP ejecutado."
fi

# Verificar debugPort
HAS_DEBUG=0
if [ -f "$CDP_INFO" ]; then
    python3 -c "
import json
data = json.load(open('$CDP_INFO'))
for k,v in data.items():
    if isinstance(v,dict) and v.get('debugPort'):
        exit(0)
exit(1)
" 2>/dev/null && HAS_DEBUG=1
fi

if [ $HAS_DEBUG -eq 0 ]; then
    log_warn "No se detecto debugPort tras primer intento. Reforce en 10s..."
    sleep 10
    bash "$FORCE_CDP_SH" 9225 30
    [ $? -eq 0 ] && log_ok "Reforce ejecutado." || log_warn "Reforce devolvio error."
fi

# Pegar prompt en ChatGPT
if [ -f "$PROMPT_AUTOMATION_PY" ]; then
    log_info "Ejecutando automatizacion de pegado de prompt por CDP..."
    python3 "$PROMPT_AUTOMATION_PY"
    if [ $? -ne 0 ]; then
        log_warn "No se pudo ejecutar page_pronmt.py correctamente."
    else
        log_ok "Prompt pegado con exito"

        if [ -f "$DOWNLOAD_GENERATED_IMAGE_PY" ]; then
            echo "Esperando y descargando imagen generada..."
            python3 "$DOWNLOAD_GENERATED_IMAGE_PY" 9225
            if [ $? -ne 0 ]; then
                log_warn "No se pudo descargar la imagen generada."
            else
                log_ok "Imagen descargada con exito"

                if [ -f "$PUBLIC_IMG_PY" ]; then
                    echo "Enviando imagen a n8n para publicacion..."
                    python3 "$PUBLIC_IMG_PY"
                    if [ $? -ne 0 ]; then
                        log_warn "No se pudo enviar la imagen a n8n."
                    else
                        log_ok "Imagen enviada a n8n con exito"
                        # Cleanup: cerrar DiCloak para liberar memoria
                        log_info "Cerrando DiCloak para liberar memoria..."
                        pkill -f "ginsbrowser" 2>/dev/null
                        pkill -f "DICloak" 2>/dev/null
                        bash "$KILLER_SH" -q 2>/dev/null
                        log_ok "DiCloak cerrado. Worker sigue en background."
                        log_ok "Proceso completado."
                        exit 0
                    fi
                else
                    log_warn "No existe script de publicacion: $PUBLIC_IMG_PY"
                fi
            fi
        else
            log_warn "No existe script de descarga: $DOWNLOAD_GENERATED_IMAGE_PY"
        fi
    fi
else
    log_warn "No existe script de automatizacion: $PROMPT_AUTOMATION_PY"
fi

log_ok "Proceso completado."
exit 0
