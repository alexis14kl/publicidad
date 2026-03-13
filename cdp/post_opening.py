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
import os
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
    """Check if cdp_debug_info.json has at least one live debugPort."""
    data = read_cdp_debug_info()
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        try:
            port = int(entry.get("debugPort", 0) or 0)
        except (TypeError, ValueError):
            port = 0
        if port and test_cdp_port(port):
            return True
    return False


def _get_live_debug_port(preferred_port: int = 0) -> int:
    if preferred_port and test_cdp_port(preferred_port):
        return preferred_port

    data = read_cdp_debug_info()
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        try:
            port = int(entry.get("debugPort", 0) or 0)
        except (TypeError, ValueError):
            port = 0
        if port and test_cdp_port(port):
            return port
    return 0


def _detect_profile_debug_port(preferred_port: int = 0, timeout_sec: int = 10) -> int:
    live_port = _get_live_debug_port(preferred_port)
    if live_port:
        return live_port

    try:
        from cdp.detect_port import detect_debug_port
        port = detect_debug_port(timeout_sec=timeout_sec)
        return int(port or 0)
    except Exception:
        return 0


def _run_python(
    script: Path,
    *args: str,
    timeout: int = 300,
    env_extra: dict[str, str] | None = None,
) -> int:
    """Run a Python script and return its exit code."""
    cmd = [sys.executable, str(script)] + list(args)
    log_info(f"Ejecutando: {' '.join(cmd)}")
    try:
        env = os.environ.copy()
        if env_extra:
            env.update({k: str(v) for k, v in env_extra.items()})
        result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), timeout=timeout, env=env)
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
    # Minimizar ventanas despues de la automatizacion (bringToFront las restaura)
    try:
        import pygetwindow as gw
        for w in gw.getAllWindows():
            title = w.title.lower()
            if ("chatgpt" in title or "ginsbrowser" in title
                    or "dicloak" in title or "127.0.0.1" in title):
                if not w.isMinimized:
                    w.minimize()
    except Exception:
        pass
    from utils.notify import notify_published
    notify_published()
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
        passive_wait_sec = 25 if not IS_WINDOWS else 8
        log_info(
            f"Esperando hasta {passive_wait_sec}s para detectar un CDP vivo del perfil antes de forzar..."
        )
        live_port = _detect_profile_debug_port(preferred_port=cdp_port, timeout_sec=passive_wait_sec)
        if live_port:
            cdp_port = live_port
            log_ok(f"CDP del perfil detectado sin relanzar en puerto {cdp_port}.")
        else:
            log_info("No se detecto CDP existente del perfil. Se intentara forzar...")

            # Step 1: Force CDP (longer timeout to let ginsbrowser fully start)
            try:
                from cdp.force_cdp import force_cdp
                result = force_cdp(preferred_port=cdp_port, timeout_sec=60)
                try:
                    cdp_port = int(result.get("DEBUG_PORT", cdp_port) or cdp_port)
                except (TypeError, ValueError):
                    pass
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
                    try:
                        cdp_port = int(result.get("DEBUG_PORT", cdp_port) or cdp_port)
                    except (TypeError, ValueError):
                        pass
                    log_ok("Reforce ejecutado.")
                except RuntimeError as e:
                    log_warn(f"Reforce devolvio error: {e}")

        live_port = _detect_profile_debug_port(preferred_port=cdp_port, timeout_sec=10)
        if live_port:
            cdp_port = live_port

    # Verify CDP is ready
    log_info("Verificando que CDP responda antes de pegar prompt...")
    if not wait_for_cdp(cdp_port, timeout_sec=30):
        live_port = _detect_profile_debug_port(preferred_port=cdp_port, timeout_sec=12)
        if live_port:
            cdp_port = live_port

    if not wait_for_cdp(cdp_port, timeout_sec=12):
        log_error(f"No se detecto ningun puerto CDP vivo del perfil. Ultimo puerto probado: {cdp_port}")
        return 1
    else:
        log_ok(f"CDP listo en puerto {cdp_port}.")

    # Step 4: Paste prompt
    if not PROMPT_AUTOMATION_PY.exists():
        log_warn(f"No existe script de automatizacion: {PROMPT_AUTOMATION_PY}")
        return 1

    log_info("Ejecutando automatizacion de pegado de prompt por CDP...")
    rc = _run_python(
        PROMPT_AUTOMATION_PY,
        timeout=300,
        env_extra={"CDP_PROFILE_PORT": str(cdp_port)},
    )
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
