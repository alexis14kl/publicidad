import argparse
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from perfil.profile_memory import (  # noqa: E402
    get_active_profiles,
    mark_profile_expired,
)
from utils.logger import log_info, log_warn  # noqa: E402


INITIAL_PROFILE = "#1 Chat Gpt PRO"
DEFAULT_TARGET_PROFILE = "#4 Chat Gpt Plus"
FALLBACK_PROFILES = ["#4 Chat Gpt Plus", "#2 Chat Gpt PRO"]
DEFAULT_MAIN_CDP_URL = "http://127.0.0.1:9333"
DEFAULT_PROFILE_CDP_PORT = 9225
DEFAULT_PROFILE_WARMUP_SEC = 20
OPEN_PROFILE_JS = PROJECT_ROOT / "perfil" / "abrir_perfil_dicloak.js"
FORCE_CDP_PS1 = PROJECT_ROOT / "cdp" / "forzar_cdp_perfil_dicloak.ps1"
PS_EXE = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cambia al perfil fallback cuando el perfil actual pierde sesion o deja de ser viable."
    )
    parser.add_argument(
        "--reason",
        default="manual",
        help="Motivo del cambio de cuenta. Ejemplo: session_expired",
    )
    parser.add_argument(
        "--target-profile",
        default=DEFAULT_TARGET_PROFILE,
        help="Nombre exacto del perfil fallback en DiCloak.",
    )
    parser.add_argument(
        "--preferred-port",
        type=int,
        default=DEFAULT_PROFILE_CDP_PORT,
        help="Puerto CDP preferido para el perfil fallback.",
    )
    parser.add_argument(
        "--warmup-sec",
        type=int,
        default=DEFAULT_PROFILE_WARMUP_SEC,
        help="Segundos de espera para estabilizar la sesion del perfil fallback.",
    )
    parser.add_argument(
        "--close-only",
        action="store_true",
        help="Solo cierra el perfil actual para validar el primer paso del cambio de sesion.",
    )
    return parser.parse_args()


def _wait_for_cdp(port: int, timeout_sec: int = 45) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                if "webSocketDebuggerUrl" in body:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def _run_subprocess(command: list[str], step_name: str) -> None:
    log_info(f"step={step_name}")
    process = subprocess.Popen(
        command,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    if process.stdout is not None:
        for line in process.stdout:
            text = line.rstrip()
            if text:
                print(text)
    result_code = process.wait()
    if result_code != 0:
        raise RuntimeError(f"{step_name} fallo con codigo {result_code}")


def close_current_profile() -> None:
    log_info("closing_current_profile=1")
    subprocess.run(
        ["taskkill", "/F", "/IM", "ginsbrowser.exe"],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    time.sleep(2)


def switch_to_fallback_profile(target_profile: str, preferred_port: int, warmup_sec: int) -> None:
    if not OPEN_PROFILE_JS.exists():
        raise FileNotFoundError(f"No existe script de apertura de perfil: {OPEN_PROFILE_JS}")
    if not FORCE_CDP_PS1.exists():
        raise FileNotFoundError(f"No existe script de forzado CDP: {FORCE_CDP_PS1}")
    if not PS_EXE.exists():
        raise FileNotFoundError(f"No existe PowerShell esperado en: {PS_EXE}")

    close_current_profile()

    log_info("opening_target_profile=1")
    _run_subprocess(
        ["node", str(OPEN_PROFILE_JS), target_profile, DEFAULT_MAIN_CDP_URL],
        "Apertura de perfil fallback",
    )

    log_info(f"Esperando {warmup_sec}s para hidratar sesion del perfil fallback...")
    time.sleep(max(5, warmup_sec))

    log_info("forcing_fallback_cdp=1")
    _run_subprocess(
        [
            str(PS_EXE),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(FORCE_CDP_PS1),
            "-PreferredPort",
            str(preferred_port),
            "-TimeoutSec",
            "45",
        ],
        "Forzado CDP del perfil fallback",
    )

    if not _wait_for_cdp(preferred_port, timeout_sec=45):
        raise RuntimeError(f"El perfil fallback no expuso CDP util en el puerto {preferred_port}")
    log_info("fallback_cdp_ready=1")


def switch_to_any_fallback(
    profiles: list[str] | None = None,
    preferred_port: int = DEFAULT_PROFILE_CDP_PORT,
    warmup_sec: int = DEFAULT_PROFILE_WARMUP_SEC,
    current_profile: str = "",
) -> str:
    if current_profile:
        mark_profile_expired(current_profile, reason="session_expired")
        log_warn(f"Perfil actual marcado como vencido en memoria: '{current_profile}'")

    all_candidates = profiles or FALLBACK_PROFILES
    candidates = get_active_profiles(all_candidates)

    if not candidates:
        raise RuntimeError(
            f"Todos los perfiles estan vencidos. No se intentara abrir ninguno. "
            f"Perfiles registrados: {all_candidates}. "
            f"Limpia la memoria con: python perfil/profile_memory.py --clear-all"
        )

    last_error = None
    for profile in candidates:
        log_info(f"Intentando perfil fallback: {profile}")
        try:
            switch_to_fallback_profile(profile, preferred_port, warmup_sec)
            log_info(f"Perfil fallback activo: {profile}")
            return profile
        except Exception as exc:
            log_warn(f"Perfil '{profile}' fallo: {exc}")
            mark_profile_expired(profile, reason="session_expired")
            last_error = exc

    raise RuntimeError(
        f"Ningun perfil fallback disponible. Intentados: {candidates}. Ultimo error: {last_error}"
    )


def main() -> int:
    args = parse_args()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_warn(f"[{timestamp}] cambiando de cuenta")
    log_info(f"reason={args.reason}")
    log_info(f"target_profile={args.target_profile}")
    if args.close_only:
        close_current_profile()
        log_info("close_only=1")
        log_info("current_profile_closed=1")
        return 0
    try:
        switch_to_fallback_profile(args.target_profile, args.preferred_port, args.warmup_sec)
    except Exception as exc:
        log_warn(f"No se pudo cambiar al perfil fallback: {exc}")
        return 1
    log_info("fallback_profile_switched=1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
