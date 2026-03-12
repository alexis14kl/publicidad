"""
Main orchestrator — cross-platform replacement for iniciar.bat.

10-step flow:
 1. Generate prompt via n8n
 2. Kill DICloak/ginsbrowser directly
 3. Advanced cleanup (services, processes, port)
 4. Start DICloak in debug mode (port 9333)
 5. Wait for CDP on port 9333
 6. Verify Node.js
 7. Open profile via Node.js script
 7.5. Wait for profile to load
 8. Launch post-opening automation (force CDP + prompt + image + publish)
 9. Detect real debug port
 10. Done
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import (
    DEVTOOLS_ACTIVE_PORT_FILE,
    IS_WINDOWS,
    N8N_POST_TEXT_CLIENT_PY,
    N8N_PROMPT_CLIENT_PY,
    POST_TEXT_FILE,
    PROMPT_FILE,
    PROMPT_SEED_FILE,
    RUN_WITH_PROGRESS_PY,
    SCRIPT_PATH,
    find_dicloak_exe,
    get_browser_process_name,
    get_env,
    is_process_running,
    kill_process_by_name,
    launch_detached,
    load_env,
    test_cdp_port,
    wait_for_cdp,
)
from cfg.platform import FORCE_OPEN_JS
from utils.logger import log_info, log_ok, log_warn, log_error, log_step, log_debug


def _minimize_dicloak_window(retries: int = 5, delay: float = 2.0) -> None:
    """Minimiza la ventana de DICloak usando pygetwindow (cross-platform)."""
    try:
        import pygetwindow as gw
    except ImportError:
        log_warn("pygetwindow no instalado. DICloak quedara visible.")
        return
    kw = keyword.lower()
    for _ in range(retries):
        wins = [w for w in gw.getAllWindows() if kw in w.title.lower()]
        for w in wins:
            if not w.isMinimized:
                w.minimize()
        if wins:
            log_ok("Ventana de DICloak minimizada.")
            return
        time.sleep(delay)
    log_warn(f"No se encontro ventana de {keyword} para minimizar.")


def _run_python(script: Path, *args: str, timeout: int = 300) -> int:
    cmd = [sys.executable, str(script)] + list(args)
    try:
        result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), timeout=timeout)
        return result.returncode
    except subprocess.TimeoutExpired:
        log_warn(f"Timeout ejecutando {script.name}")
        return 1
    except Exception as e:
        log_error(f"Error ejecutando {script.name}: {e}")
        return 1


def _run_node(script: Path, *args: str, timeout: int = 300) -> int:
    cmd = ["node", str(script)] + list(args)
    try:
        result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), timeout=timeout)
        return result.returncode
    except subprocess.TimeoutExpired:
        log_warn(f"Timeout ejecutando {script.name}")
        return 1
    except Exception as e:
        log_error(f"Error ejecutando {script.name}: {e}")
        return 1


def _resolve_best_profile(default_profiles: list[str]) -> str:
    """Use profile_memory.py to find best non-expired profile."""
    try:
        from perfil.profile_memory import resolve_best_profile
        return resolve_best_profile(default_profiles, quiet=True)
    except Exception:
        return default_profiles[0] if default_profiles else "#1 Chat Gpt PRO"


def _wait_for_profile_load(timeout_sec: int = 45) -> bool:
    """Wait for ginsbrowser to be running (profile loaded)."""
    browser = get_browser_process_name()
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if is_process_running(browser):
            log_ok("Perfil cargado y listo.")
            return True
        time.sleep(1)
    log_warn("ginsbrowser no encontrado en el timeout.")
    return False


def _generate_prompt() -> bool:
    """Generate prompt and caption via n8n. Returns True on success."""
    if not N8N_PROMPT_CLIENT_PY.exists():
        log_warn(f"No existe cliente n8n: {N8N_PROMPT_CLIENT_PY}. Se conserva el prompt actual.")
        return False
    if not PROMPT_SEED_FILE.exists():
        log_warn(f"No existe brief base: {PROMPT_SEED_FILE}. Se conserva el flujo actual.")
        return False

    rc = _run_python(
        N8N_PROMPT_CLIENT_PY,
        "--idea-file", str(PROMPT_SEED_FILE),
        "--output", str(PROMPT_FILE),
    )
    if rc != 0:
        log_warn(f"No se pudo regenerar el prompt con n8n. Se usara el contenido actual de {PROMPT_FILE}.")
        return False

    log_ok(f"Prompt regenerado en {PROMPT_FILE}.")
    # Also generate caption
    if N8N_POST_TEXT_CLIENT_PY.exists():
        rc2 = _run_python(
            N8N_POST_TEXT_CLIENT_PY,
            "--prompt-file", str(PROMPT_FILE),
            "--output", str(POST_TEXT_FILE),
        )
        if rc2 != 0:
            log_warn("No se pudo regenerar el texto de publicacion con n8n.")
        else:
            log_ok(f"Caption regenerado en {POST_TEXT_FILE}.")
    return True


def _fast_path(cdp_port: int = 9225) -> int:
    """Fast path: CDP ya activo, ir directo a prompt → ChatGPT → imagen → logo → publicar.

    Salta todo el arranque de DICloak, apertura de perfil y forzado de CDP.
    Solo se ejecuta si el puerto CDP ya esta respondiendo.
    Returns 0 on success, 1 on failure.
    """
    log_step("FAST", "Depuracion activa detectada. Ejecutando ruta rapida...")

    # 1. Generar prompt
    log_step("FAST 1/4", "Generando prompt con IA de n8n...")
    _generate_prompt()

    # 2. Pegar prompt + esperar imagen + descargar + logo + publicar
    log_step("FAST 2/2", "Pegando prompt en ChatGPT y ejecutando pipeline completo...")
    from cdp.post_opening import post_opening_automation
    rc = post_opening_automation(cdp_port=cdp_port, skip_force_cdp=True)
    if rc != 0:
        log_error("La ruta rapida fallo en post_opening_automation.")
        return 1

    log_ok("Ruta rapida completada con exito.")
    return 0


def run_orchestrator(
    profile_name: str = "",
    profile_debug_port_hint: str = "",
    run_mode: str = "",
    openapi_port_hint: str = "",
    openapi_secret_hint: str = "",
) -> int:
    """
    Run the full 10-step orchestration.
    Returns 0 on success, 1 on failure.

    FAST PATH: si CDP ya responde en puerto 9225, salta directo a
    generar prompt → pegar en ChatGPT → descargar imagen → logo → publicar.
    """
    env_data = load_env()
    cdp_url = "http://127.0.0.1:9333"

    # -----------------------------------------------------------------------
    # FAST PATH: si CDP del perfil ya esta activo, ir directo
    # -----------------------------------------------------------------------
    fast_port = 9225
    log_step("0/10", f"Verificando si CDP del perfil ya esta activo en puerto {fast_port}...")
    if test_cdp_port(fast_port):
        log_ok(f"CDP respondiendo en {fast_port}. Activando ruta rapida (skip arranque).")
        return _fast_path(cdp_port=fast_port)
    log_info(f"CDP no activo en {fast_port}. Ejecutando flujo completo...")

    # Resolve profile
    initial = env_data.get("INITIAL_PROFILE", "#1 Chat Gpt PRO")
    default_target = env_data.get("DEFAULT_TARGET_PROFILE", "#4 Chat Gpt Plus")
    fallback_raw = env_data.get("FALLBACK_PROFILES", "#4 Chat Gpt Plus,#2 Chat Gpt PRO")
    fallback_list = [p.strip() for p in fallback_raw.split(",") if p.strip()]
    all_profiles = [initial] + fallback_list

    if not profile_name:
        profile_name = _resolve_best_profile(all_profiles)
    log_info(f"Perfil seleccionado: {profile_name}")

    # -----------------------------------------------------------------------
    # Step 1/10: Generate prompt via n8n
    # -----------------------------------------------------------------------
    log_step("1/10", "Generando prompt inicial con IA de n8n...")
    _generate_prompt()

    # -----------------------------------------------------------------------
    # Step 2/10: Check if DICloak is already running with CDP
    # -----------------------------------------------------------------------
    log_step("2/10", "Verificando si DICloak ya esta corriendo con CDP...")
    dicloak_already_running = False
    if wait_for_cdp(9333, timeout_sec=3):
        log_ok("DICloak ya esta corriendo con CDP en puerto 9333. Saltando kill y arranque.")
        dicloak_already_running = True
    else:
        log_info("DICloak no esta corriendo o CDP no responde. Iniciando desde cero...")

    # -----------------------------------------------------------------------
    # Step 3/10: Start DICloak (only if not already running)
    # -----------------------------------------------------------------------
    if not dicloak_already_running:
        log_step("3/10", "Iniciando DICloak en modo debug (9333)...")
        dicloak_exe = find_dicloak_exe()
        if not dicloak_exe or not Path(dicloak_exe).exists():
            log_error(f"No existe DICloak en: {dicloak_exe}")
            return 1

        launch_cmd = f'"{dicloak_exe}" --remote-debugging-port=9333 --remote-allow-origins=*'
        launch_detached(launch_cmd)
        _minimize_dicloak_window()
    else:
        log_step("3/10", "DICloak ya activo, saltando inicio.")

    # -----------------------------------------------------------------------
    # Step 4/10: Wait for CDP on 9333
    # -----------------------------------------------------------------------
    if not dicloak_already_running:
        log_step("4/10", "Esperando CDP en puerto 9333...")
        if not wait_for_cdp(9333, timeout_sec=90):
            log_warn("CDP no respondio en 9333. Buscando DevToolsActivePort...")
            # Fallback: read DevToolsActivePort
            active_port = None
            if DEVTOOLS_ACTIVE_PORT_FILE.exists():
                try:
                    content = DEVTOOLS_ACTIVE_PORT_FILE.read_text().strip().splitlines()
                    if content:
                        active_port = int(content[0].strip())
                except Exception:
                    pass

            if active_port:
                cdp_url = f"http://127.0.0.1:{active_port}"
                log_info(f"Puerto detectado: {active_port}")
                if not wait_for_cdp(active_port, timeout_sec=45):
                    log_error(f"CDP tampoco respondio en {cdp_url}.")
                    return 1
            else:
                log_error("No se encontro DevToolsActivePort para detectar puerto real.")
                return 1
    else:
        log_step("4/10", "CDP ya confirmado en 9333.")

    # -----------------------------------------------------------------------
    # Step 5/10: Verify Node.js
    # -----------------------------------------------------------------------
    log_step("5/10", "Verificando Node.js...")
    if not shutil.which("node"):
        log_error("Node.js no esta disponible en PATH.")
        log_info(f"Instala Node o ejecuta manualmente: node {SCRIPT_PATH} {profile_name} {cdp_url}")
        return 1

    # -----------------------------------------------------------------------
    # Step 7/10: Open profile
    # -----------------------------------------------------------------------
    log_step("6/10", f"Abriendo perfil: {profile_name}")
    profile_maybe_open = False

    rc = _run_node(
        SCRIPT_PATH, profile_name, cdp_url,
        profile_debug_port_hint, openapi_port_hint,
        run_mode, openapi_secret_hint,
    )
    if rc == 0:
        profile_maybe_open = True
    else:
        log_warn("Flujo principal fallo. Intentando apertura forzada por CDP...")
        if FORCE_OPEN_JS.exists():
            rc2 = _run_node(FORCE_OPEN_JS, profile_name, cdp_url)
            if rc2 == 0:
                profile_maybe_open = True

        if not profile_maybe_open:
            browser = get_browser_process_name()
            if is_process_running(browser):
                log_info("Se detecto ginsbrowser activo; se continua con forzado CDP.")
                profile_maybe_open = True

        if not profile_maybe_open:
            log_error("No se pudo abrir el perfil automaticamente.")
            return 1

    # -----------------------------------------------------------------------
    # Step 7.5/10: Wait for profile to load
    # -----------------------------------------------------------------------
    log_step("6.5/10", "Esperando que el perfil cargue completamente...")
    _wait_for_profile_load(timeout_sec=45)
    _minimize_window("ginsbrowser")
    _minimize_window("chatgpt")
    _minimize_window("dicloak")

    # -----------------------------------------------------------------------
    # Step 8/10: Post-opening automation (in background thread)
    # -----------------------------------------------------------------------
    log_step("7/10", "Ejecutando automatizacion clave de depuracion de perfil...")

    def _run_post_opening() -> None:
        try:
            from cdp.post_opening import post_opening_automation
            post_opening_automation(cdp_port=9225)
        except Exception as e:
            log_error(f"Error en post_opening: {e}")

    post_thread = threading.Thread(target=_run_post_opening, daemon=True)
    post_thread.start()

    # Wait for debugPort in cdp_debug_info.json (up to 45s)
    from cfg.platform import read_cdp_debug_info
    log_info("Esperando debugPort en cdp_debug_info.json (hasta 45s)...")
    deadline = time.time() + 45
    found_port = False
    while time.time() < deadline:
        data = read_cdp_debug_info()
        for key, entry in data.items():
            if isinstance(entry, dict) and entry.get("debugPort"):
                found_port = True
                break
        if found_port:
            break
        time.sleep(1)

    if found_port:
        log_ok("debugPort detectado en cdp_debug_info.json.")
    else:
        log_warn("No se detecto debugPort dentro de la espera.")

    # -----------------------------------------------------------------------
    # Step 9/10: Detect real port
    # -----------------------------------------------------------------------
    log_step("8/10", "Detectando puerto real de perfil...")
    try:
        from cdp.detect_port import detect_debug_port
        port = detect_debug_port(timeout_sec=30)
        if port:
            log_debug(f"DEBUG_PORT={port}")
        else:
            log_warn("No se pudo detectar puerto real.")
    except Exception as e:
        log_warn(f"Error en deteccion de puerto: {e}")

    # -----------------------------------------------------------------------
    # Step 10/10: Done — wait for post_opening thread to finish
    # -----------------------------------------------------------------------
    log_step("9/10", f"Perfil abierto: {profile_name}")
    log_info("Esperando a que la automatizacion post-apertura termine...")
    post_thread.join(timeout=7200)  # max 2 hours
    log_ok("Proceso completado.")
    return 0


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Orquestador principal del bot publicitario")
    parser.add_argument("profile_name", nargs="?", default="")
    parser.add_argument("--debug-port-hint", default="")
    parser.add_argument("--run-mode", default="")
    parser.add_argument("--openapi-port", default="")
    parser.add_argument("--openapi-secret", default="")
    args = parser.parse_args()

    return run_orchestrator(
        profile_name=args.profile_name,
        profile_debug_port_hint=args.debug_port_hint,
        run_mode=args.run_mode,
        openapi_port_hint=args.openapi_port,
        openapi_secret_hint=args.openapi_secret,
    )


if __name__ == "__main__":
    raise SystemExit(main())
