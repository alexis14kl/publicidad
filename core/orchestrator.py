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

PROJECT_ROOT = Path(__file__).resolve().parent.parent

from core.cfg.platform import (
    DEVTOOLS_ACTIVE_PORT_FILE,
    IS_MAC,
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
from core.cfg.platform import FORCE_OPEN_JS
from core.utils.logger import log_info, log_ok, log_warn, log_error, log_step, log_debug


def _minimize_window(keyword: str, retries: int = 5, delay: float = 2.0) -> None:
    """Minimiza ventanas cuyo titulo contenga *keyword* (cross-platform)."""
    try:
        import pygetwindow as gw
    except ImportError:
        log_warn(f"pygetwindow no instalado. {keyword} quedara visible.")
        return
    kw = keyword.lower()
    for _ in range(retries):
        wins = [w for w in gw.getAllWindows() if kw in w.title.lower()]
        for w in wins:
            if not w.isMinimized:
                w.minimize()
        if wins:
            log_ok(f"Ventana de {keyword} minimizada.")
            return
        time.sleep(delay)
    log_warn(f"No se encontro ventana de {keyword} para minimizar.")


def _run_python(script: Path, *args: str, timeout: int = 300) -> int:
    cmd = [sys.executable, str(script)] + list(args)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PROJECT_ROOT)
    try:
        result = subprocess.run(cmd, cwd=str(PROJECT_ROOT), timeout=timeout, env=env)
        return result.returncode
    except subprocess.TimeoutExpired:
        log_warn(f"Timeout ejecutando {script.name}")
        return 1
    except Exception as e:
        log_error(f"Error ejecutando {script.name}: {e}")
        return 1


def _find_node_bin() -> str | None:
    """Find Node.js binary.

    When launched from GUI apps on macOS, PATH can be truncated and `node`
    might not be discoverable via shutil.which().
    """
    candidates: list[str | None] = [shutil.which("node")]
    if IS_MAC:
        candidates.extend([
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
        ])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            if Path(candidate).exists():
                return candidate
        except Exception:
            continue
    return None


def _run_node(script: Path, *args: str, timeout: int = 300) -> int:
    node_bin = _find_node_bin()
    if not node_bin:
        log_error("Node.js no esta disponible (ni en PATH ni en rutas comunes de macOS).")
        return 1
    cmd = [node_bin, str(script)] + list(args)
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
        from core.perfil.profile_memory import resolve_best_profile
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


def _resolve_existing_profile_cdp_port(timeout_sec: int = 3) -> int:
    if test_cdp_port(9225):
        return 9225

    try:
        from core.cdp.detect_port import detect_debug_port
        return int(detect_debug_port(timeout_sec=timeout_sec) or 0)
    except Exception:
        return 0


def _generate_prompt() -> bool:
    """Generate prompt and caption via Anthropic Claude. Returns True on success."""
    custom_prompt = str(os.getenv("BOT_CUSTOM_IMAGE_PROMPT", "")).strip()
    if custom_prompt:
        PROMPT_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROMPT_FILE.write_text(custom_prompt, encoding="utf-8")
        log_ok(f"Prompt manual guardado en {PROMPT_FILE}.")
        if N8N_POST_TEXT_CLIENT_PY.exists():
            rc2 = _run_python(
                N8N_POST_TEXT_CLIENT_PY,
                "--prompt-file", str(PROMPT_FILE),
                "--output", str(POST_TEXT_FILE),
            )
            if rc2 != 0:
                log_warn("No se pudo regenerar el texto de publicacion a partir del prompt manual.")
            else:
                log_ok(f"Caption regenerado en {POST_TEXT_FILE}.")
        return True

    if not N8N_PROMPT_CLIENT_PY.exists():
        log_warn(f"No existe cliente de prompts: {N8N_PROMPT_CLIENT_PY}. Se conserva el prompt actual.")
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
        log_warn(f"No se pudo regenerar el prompt con Claude. Se usara el contenido actual de {PROMPT_FILE}.")
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
            log_warn("No se pudo regenerar el texto de publicacion con Claude.")
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
    log_step("FAST 1/4", "Generando prompt con Anthropic Claude...")
    _generate_prompt()

    # 2. Pegar prompt + esperar imagen + descargar + logo + publicar
    log_step("FAST 2/2", "Pegando prompt en ChatGPT y ejecutando pipeline completo...")
    from core.cdp.post_opening import post_opening_automation
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
    fast_port = _resolve_existing_profile_cdp_port(timeout_sec=3)
    log_step("0/10", "Verificando si el CDP del perfil ya esta activo...")
    if fast_port:
        log_ok(f"CDP respondiendo en {fast_port}. Activando ruta rapida (skip arranque).")
        return _fast_path(cdp_port=fast_port)
    log_info("CDP del perfil no activo. Ejecutando flujo completo...")

    # Resolve profile based on content type
    content_type = os.getenv("BOT_CONTENT_TYPE", "image").strip().lower()
    log_info(f"Tipo de contenido: {content_type}")

    if content_type == "reel":
        # Perfiles de video (Veo 3 / Gemini)
        initial = env_data.get("VIDEO_INITIAL_PROFILE", "Flow Veo 3")
        fallback_raw = env_data.get("VIDEO_FALLBACK_PROFILES", "Flow Veo 3")
    elif content_type == "brochure":
        # Perfiles de brochure (ChatGPT - mismo que imagen)
        initial = env_data.get("INITIAL_PROFILE", "#1 Chat Gpt PRO")
        fallback_raw = env_data.get("FALLBACK_PROFILES", "#4 Chat Gpt Plus,#2 Chat Gpt PRO")
    else:
        # Perfiles de imagen (ChatGPT)
        initial = env_data.get("INITIAL_PROFILE", "#1 Chat Gpt PRO")
        fallback_raw = env_data.get("FALLBACK_PROFILES", "#4 Chat Gpt Plus,#2 Chat Gpt PRO")

    fallback_list = [p.strip() for p in fallback_raw.split(",") if p.strip()]
    all_profiles = [initial] + fallback_list

    if not profile_name:
        profile_name = _resolve_best_profile(all_profiles)
    log_info(f"Perfil seleccionado: {profile_name}")

    # -----------------------------------------------------------------------
    # Step 1/10: Generate prompt via n8n
    # -----------------------------------------------------------------------
    log_step("1/10", "Generando prompt inicial con Anthropic Claude...")
    _generate_prompt()

    # -----------------------------------------------------------------------
    # Steps 2-4: Abrir DICloak via API REST (python -m core.dicloak_api.server)
    # -----------------------------------------------------------------------
    log_step("2/10", "Abriendo DICloak via API...")
    api_port = int(os.environ.get("DICLOAK_API_PORT", "0") or "0") or 8585
    api_url = f"http://127.0.0.1:{api_port}"

    try:
        import urllib.request
        import json as _json
        with urllib.request.urlopen(f"{api_url}/health", timeout=5) as resp:
            health = _json.loads(resp.read().decode("utf-8"))
            if health.get("data", {}).get("dicloak_ready"):
                log_ok("DICloak abierto via API (CDP en 9333).")
            else:
                log_warn("API responde pero DICloak no listo. Esperando...")
                if not wait_for_cdp(9333, timeout_sec=30):
                    log_error("DICloak no respondio. Verifica el servidor API.")
                    return 1
                log_ok("DICloak listo.")
    except Exception as e:
        log_error(f"DICloak API no responde en {api_url}: {e}")
        log_error("Ejecuta primero: python -m core.dicloak_api.server")
        return 1

    # -----------------------------------------------------------------------
    # Step 5/10: Inject CDP hook into DiCloak
    # -----------------------------------------------------------------------
    log_step("5/10", "Inyectando hook CDP en DiCloak (canIuseCdp=true)...")
    try:
        from core.cdp.force_cdp import inject_cdp_hook
        if inject_cdp_hook(dicloak_port=9333):
            log_ok("Hook CDP inyectado. ginsbrowser se abrira con debug port.")
        else:
            log_warn("No se pudo inyectar hook CDP. Se continuara sin el.")
    except Exception as e:
        log_warn(f"Error inyectando hook CDP: {e}. Se continuara sin el.")

    # -----------------------------------------------------------------------
    # Step 5.5/10: Verify Node.js
    # -----------------------------------------------------------------------
    log_step("5.5/10", "Verificando Node.js...")
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
            from core.cdp.post_opening import post_opening_automation
            post_opening_automation(cdp_port=9225)
        except Exception as e:
            log_error(f"Error en post_opening: {e}")

    post_thread = threading.Thread(target=_run_post_opening, daemon=True)
    post_thread.start()

    # Wait for debugPort in cdp_debug_info.json (up to 45s)
    from core.cfg.platform import read_cdp_debug_info
    log_info("Esperando debugPort en cdp_debug_info.json (hasta 45s)...")
    deadline = time.time() + 45
    found_port = False
    while time.time() < deadline:
        data = read_cdp_debug_info()
        for key, entry in data.items():
            if not isinstance(entry, dict):
                continue
            try:
                port = int(entry.get("debugPort", 0) or 0)
            except (TypeError, ValueError):
                port = 0
            if port and test_cdp_port(port):
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
        from core.cdp.detect_port import detect_debug_port
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
