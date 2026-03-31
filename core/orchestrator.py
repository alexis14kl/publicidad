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
    IS_MAC,
    IS_WINDOWS,
    N8N_POST_TEXT_CLIENT_PY,
    N8N_PROMPT_CLIENT_PY,
    POST_TEXT_FILE,
    PROMPT_FILE,
    PROMPT_SEED_FILE,
    RUN_WITH_PROGRESS_PY,
    get_env,
    load_env,
    test_cdp_port,
    wait_for_cdp,
)
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


def _resolve_best_profile(default_profiles: list[str]) -> str:
    """Use profile_memory.py to find best non-expired profile."""
    try:
        from core.perfil.profile_memory import resolve_best_profile
        return resolve_best_profile(default_profiles, quiet=True)
    except Exception:
        return default_profiles[0] if default_profiles else "#1 Chat Gpt PRO"



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
    # Step 5/10: Abrir perfil via API (hook + click + detectar puerto CDP)
    # -----------------------------------------------------------------------
    log_step("5/10", f"Abriendo perfil '{profile_name}' via API...")
    profile_cdp_port = 0

    try:
        import urllib.request
        import json as _json

        req_data = _json.dumps({"name": profile_name, "timeout": 60}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url}/profiles/open",
            data=req_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            result = _json.loads(resp.read().decode("utf-8"))

        if result.get("success") and result.get("data", {}).get("profile", {}).get("cdp_active"):
            profile_cdp_port = result["data"]["profile"]["debug_port"]
            log_ok(f"Perfil abierto via API. CDP en puerto {profile_cdp_port}")
        else:
            error_msg = result.get("error", "Respuesta inesperada de la API")
            log_error(f"API no pudo abrir perfil: {error_msg}")
            return 1

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:300]
        log_error(f"API error HTTP {e.code}: {body}")
        return 1
    except Exception as e:
        log_error(f"Error abriendo perfil via API: {e}")
        return 1

    _minimize_window("ginsbrowser")
    _minimize_window("chatgpt")
    _minimize_window("dicloak")

    # -----------------------------------------------------------------------
    # Step 6/10: Post-opening automation con el puerto CDP de la API
    # -----------------------------------------------------------------------
    log_step("6/10", f"Ejecutando pipeline en puerto {profile_cdp_port}...")
    from core.cdp.post_opening import post_opening_automation
    rc = post_opening_automation(cdp_port=profile_cdp_port)
    if rc != 0:
        log_error("Post-opening automation fallo.")
        return 1

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
