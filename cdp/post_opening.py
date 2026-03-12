"""
Post-opening automation — cross-platform replacement for forzar_cdp_post_apertura.bat.

After the profile is opened:
1. Wait 10s, then force CDP on the profile.
2. If first attempt fails, retry after 10s.
3. Wait for CDP to be ready.
4. Paste prompt into ChatGPT via CDP automation.
5. Download generated image.
6. Overlay NoyeCode logo.
7. Send image to n8n for publishing.
8. Cleanup: close ChatGPT tabs, kill browser + DICloak (unless DEV_MODE).
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import (
    IS_WINDOWS,
    CDP_DEBUG_INFO_JSON,
    IMG_PUBLICITARIAS_DIR,
    PROMPT_AUTOMATION_PY,
    DOWNLOAD_GENERATED_IMAGE_PY,
    OVERLAY_LOGO_PY,
    PUBLIC_IMG_PY,
    get_env,
    read_cdp_debug_info,
    test_cdp_port,
    wait_for_cdp,
)
from utils.logger import log_info, log_ok, log_warn, log_error, log_step


def _has_debug_port() -> bool:
    """Check if cdp_debug_info.json has at least one entry with a debugPort."""
    data = read_cdp_debug_info()
    for key, entry in data.items():
        if isinstance(entry, dict) and entry.get("debugPort"):
            return True
    return False


def _run_python(script: Path, *args: str, timeout: int = 300) -> int:
    """Run a Python script and return its exit code."""
    cmd = [sys.executable, str(script)] + list(args)
    log_info(f"Ejecutando: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), timeout=timeout)
        return result.returncode
    except subprocess.TimeoutExpired:
        log_warn(f"Timeout ejecutando {script.name}")
        return 1
    except Exception as e:
        log_error(f"Error ejecutando {script.name}: {e}")
        return 1


def _close_chatgpt_tabs(port: int) -> None:
    """Close ChatGPT tabs via CDP to prevent session restore."""
    try:
        url = f"http://127.0.0.1:{port}/json/list"
        with urllib.request.urlopen(url, timeout=3) as resp:
            tabs = json.loads(resp.read())

        for tab in tabs:
            if tab.get("type") == "page" and "chatgpt" in tab.get("url", "").lower():
                tab_id = tab.get("id", "")
                if tab_id:
                    close_url = f"http://127.0.0.1:{port}/json/close/{tab_id}"
                    try:
                        urllib.request.urlopen(close_url, timeout=2)
                    except Exception:
                        pass
    except Exception:
        pass


def _cleanup_and_exit(dev_mode: bool, cdp_port: int) -> int:
    """Post-publish cleanup: NO cerrar tabs para evitar crear nuevas sesiones."""
    log_ok("Proceso completado. Tabs y navegador siguen abiertos para el proximo ciclo.")
    return 0


def post_opening_automation(cdp_port: int = 9225, skip_force_cdp: bool = False) -> int:
    """
    Run the full post-opening pipeline.
    Returns 0 on success, 1 on failure.

    skip_force_cdp: si True, salta la espera de 10s y el forzado de CDP
                    (usado por fast path cuando CDP ya esta activo).
    """
    dev_mode = get_env("DEV_MODE", "0") == "1"

    if skip_force_cdp:
        log_info("Fast path: CDP ya activo, saltando forzado.")
    else:
        log_info("Launcher post-apertura iniciado.")
        log_info("Esperando 10s antes de forzar CDP del perfil...")
        time.sleep(10)

        # Step 1: Force CDP (longer timeout to let ginsbrowser fully start)
        try:
            from cdp.force_cdp import force_cdp
            result = force_cdp(preferred_port=cdp_port, timeout_sec=60)
            log_ok("Forzado CDP ejecutado.")
        except RuntimeError as e:
            log_warn(f"El forzado CDP devolvio error: {e}")
            result = {}

        # Step 2: Retry if no debug port detected
        if not _has_debug_port():
            log_warn("No se detecto debugPort tras primer intento. Reforce en 15 segundos...")
            time.sleep(15)
            try:
                result = force_cdp(preferred_port=cdp_port, timeout_sec=60)
                log_ok("Reforce ejecutado.")
            except RuntimeError as e:
                log_warn(f"Reforce devolvio error: {e}")

    # Verify CDP is ready
    log_info("Verificando que CDP responda antes de pegar prompt...")
    if not wait_for_cdp(cdp_port, timeout_sec=30):
        log_warn(f"CDP no responde en puerto {cdp_port}. El prompt puede fallar.")
    else:
        log_ok(f"CDP listo en puerto {cdp_port}.")

    # Step 4: Paste prompt
    if not PROMPT_AUTOMATION_PY.exists():
        log_warn(f"No existe script de automatizacion: {PROMPT_AUTOMATION_PY}")
        return 1

    log_info("Ejecutando automatizacion de pegado de prompt por CDP...")
    rc = _run_python(PROMPT_AUTOMATION_PY)
    if rc != 0:
        log_warn("No se pudo ejecutar page_pronmt.py correctamente.")
        return 1

    log_ok("Prompt pegado con exito")

    # Step 5: Download generated image
    if not DOWNLOAD_GENERATED_IMAGE_PY.exists():
        log_warn(f"No existe script de descarga: {DOWNLOAD_GENERATED_IMAGE_PY}")
        return 1

    rc = _run_python(DOWNLOAD_GENERATED_IMAGE_PY, str(cdp_port))
    if rc != 0:
        log_warn("No se pudo descargar la imagen generada.")
        return 1

    log_ok("Imagen descargada con exito")

    # Step 6: Overlay logo
    if OVERLAY_LOGO_PY.exists():
        log_info("Superponiendo logo real de NoyeCode sobre la imagen...")
        rc = _run_python(OVERLAY_LOGO_PY, str(IMG_PUBLICITARIAS_DIR))
        if rc != 0:
            log_warn("No se pudo superponer el logo. Se enviara la imagen sin logo.")
        else:
            log_ok("Logo superpuesto con exito")

    # Step 7: Send to n8n
    if not PUBLIC_IMG_PY.exists():
        log_warn(f"No existe script de publicacion local a n8n: {PUBLIC_IMG_PY}")
        return 1

    rc = _run_python(PUBLIC_IMG_PY)
    if rc != 0:
        log_warn("No se pudo enviar la imagen local a n8n.")
        return 1

    log_ok("Imagen enviada a n8n con exito")

    # Step 8: Cleanup
    return _cleanup_and_exit(dev_mode, cdp_port)


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Post-opening automation")
    parser.add_argument("--port", type=int, default=9225)
    args = parser.parse_args()
    return post_opening_automation(cdp_port=args.port)


if __name__ == "__main__":
    raise SystemExit(main())
