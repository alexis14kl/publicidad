from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import ctypes
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from dotenv import dotenv_values


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"

from core.utils.logger import log_info, log_ok, log_warn, log_error
from core.cfg.sqlite_store import add_artifact, new_run, update_run

START_BAT = PROJECT_ROOT / "scripts" / "windows" / "iniciar.bat"  # legacy, kept as fallback
ORCHESTRATOR_PY = PROJECT_ROOT / "core" / "orchestrator.py"
PUBLIC_IMG_PY = PROJECT_ROOT / "core" / "n8n" / "public_img.py"
CREATE_CAMPAIGN_PY = PROJECT_ROOT / "core" / "n8n" / "create_campaign.py"
LOCK_FILE = PROJECT_ROOT / ".bot_runner.lock"
DEFAULT_STALE_LOCK_SEC = 4 * 60 * 60


class BotRunnerError(RuntimeError):
    pass


@dataclass
class RunResult:
    action: str
    success: bool
    exit_code: int
    started_at: float
    finished_at: float
    stdout: str
    stderr: str
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["duration_sec"] = round(self.finished_at - self.started_at, 2)
        return data


def _read_lock() -> dict[str, Any]:
    if not LOCK_FILE.exists():
        return {}
    try:
        return json.loads(LOCK_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_lock(payload: dict[str, Any]) -> None:
    LOCK_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _get_stale_lock_seconds() -> int:
    raw = str(os.getenv("BOT_RUNNER_STALE_LOCK_SEC", str(DEFAULT_STALE_LOCK_SEC))).strip()
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_STALE_LOCK_SEC


def _get_valid_lock() -> dict[str, Any]:
    lock = _read_lock()
    if not lock:
        LOCK_FILE.unlink(missing_ok=True)
        return {}

    pid = int(lock.get("pid") or 0)
    started_at = int(lock.get("started_at") or 0)
    age_sec = max(0, int(time.time()) - started_at) if started_at else 0
    stale_after_sec = _get_stale_lock_seconds()

    if pid and _process_exists(pid):
        return lock

    if age_sec >= stale_after_sec or not pid:
        log_warn(f"Lock huérfano detectado. Se libera automaticamente (pid={pid}, age={age_sec}s).")
        LOCK_FILE.unlink(missing_ok=True)
        return {}

    # If the process is gone, the lock is already invalid even if it is recent.
    log_warn(f"Lock de proceso inexistente detectado. Se libera automaticamente (pid={pid}).")
    LOCK_FILE.unlink(missing_ok=True)
    return {}


@contextmanager
def bot_execution_lock(action: str) -> Any:
    current = _get_valid_lock()
    if current:
        owner = current.get("host") or "unknown"
        raise BotRunnerError(f"El bot ya esta ejecutandose en {owner}")

    payload = {
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "action": action,
        "started_at": int(time.time()),
    }
    _write_lock(payload)
    try:
        yield payload
    finally:
        LOCK_FILE.unlink(missing_ok=True)


def is_busy() -> bool:
    return bool(_get_valid_lock())


def get_status() -> dict[str, Any]:
    lock = _get_valid_lock()
    if not lock:
        return {"busy": False}
    lock["busy"] = True
    return lock


def _run_full_cycle(payload: dict[str, Any] | None, timeout_sec: int) -> RunResult:
    payload = payload or {}
    profile_name = str(payload.get("profile_name", "")).strip()
    image_prompt = str(payload.get("image_prompt", "")).strip()

    env = os.environ.copy()
    env["NO_PAUSE"] = "1"
    env["PYTHONPATH"] = str(PROJECT_ROOT)
    if image_prompt:
        env["BOT_CUSTOM_IMAGE_PROMPT"] = image_prompt
    # Cargar variables del .env para que lleguen al proceso (DEV_MODE, etc.)
    if ENV_FILE.exists():
        for key, value in dotenv_values(ENV_FILE).items():
            if value is not None:
                env[key] = value

    log_file = PROJECT_ROOT / "logs" / "bot_runner_last.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    run_id = new_run("run_full_cycle", payload, status="running")
    env["PUBLICIDAD_RUN_ID"] = run_id

    # Prefer Python orchestrator (cross-platform) over legacy bat
    if ORCHESTRATOR_PY.exists():
        command = [sys.executable, "-m", "core.orchestrator"]
        if profile_name:
            command.append(profile_name)
        log_info(f"Usando orquestador Python: {ORCHESTRATOR_PY.name}")
    elif START_BAT.exists() and os.name == "nt":
        command = ["cmd", "/c", str(START_BAT)]
        if profile_name:
            command.append(profile_name)
        log_info("Usando orquestador legacy: iniciar.bat")
    else:
        raise BotRunnerError(
            f"No existe orquestador: ni {ORCHESTRATOR_PY} ni {START_BAT}"
        )

    # Force UTF-8 output from Python subprocesses
    env["PYTHONIOENCODING"] = "utf-8"

    started_at = time.time()
    collected_stdout = ""
    collected_stderr = ""
    try:
        if os.name == "nt" and command[0] == "cmd":
            # Legacy bat path: needs its own console for 'start ""'
            result = subprocess.run(
                command,
                cwd=str(PROJECT_ROOT),
                timeout=timeout_sec,
                env=env,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
            )
        else:
            # Stream output line-by-line to both stdout and log file
            proc = subprocess.Popen(
                command,
                cwd=str(PROJECT_ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
            )
            with open(log_file, "w", encoding="utf-8") as lf:
                lines: list[str] = []
                for line in proc.stdout:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    lf.write(line)
                    lf.flush()
                    lines.append(line)
                proc.wait(timeout=timeout_sec)
                collected_stdout = "".join(lines)

            result = proc
    except subprocess.TimeoutExpired:
        if "proc" in dir() and proc.poll() is None:
            proc.kill()
        raise BotRunnerError(f"Timeout ({timeout_sec}s) ejecutando orquestador")

    finished_at = time.time()
    try:
        update_run(
            run_id,
            status="success" if result.returncode == 0 else "error",
            result={
                "exit_code": int(result.returncode),
                "profile_name": profile_name,
            },
            error_text="",
        )
        add_artifact(
            run_id=run_id,
            artifact_type="bot_runner_log",
            content=collected_stdout[-5000:] if collected_stdout else "",
            file_path=str(log_file),
            meta={"exit_code": int(result.returncode)},
        )
    except Exception:
        # Never block the run on SQLite logging issues.
        pass
    return RunResult(
        action="run_full_cycle",
        success=result.returncode == 0,
        exit_code=result.returncode,
        started_at=started_at,
        finished_at=finished_at,
        stdout=collected_stdout[-5000:] if collected_stdout else "",
        stderr=collected_stderr[-5000:] if collected_stderr else "",
        metadata={"profile_name": profile_name, "image_prompt": image_prompt},
    )


def _run_python_simple(
    script: Path,
    script_args: list[str],
    *,
    env: dict[str, str],
    timeout_sec: int,
) -> tuple[int, str, str]:
    cmd = [sys.executable, str(script)] + list(script_args)
    result = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        timeout=timeout_sec,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.returncode, result.stdout or "", result.stderr or ""


def _build_env_with_dotenv(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    if ENV_FILE.exists():
        for key, value in dotenv_values(ENV_FILE).items():
            if value is not None:
                env[key] = value
    if extra:
        env.update({k: str(v) for k, v in extra.items()})
    return env


def execute_action(action: str, payload: dict[str, Any] | None = None, timeout_sec: int = 7200) -> RunResult:
    normalized = (action or "").strip().lower()
    if not normalized:
        raise BotRunnerError("La accion no puede estar vacia")

    if normalized == "status":
        now = time.time()
        status = get_status()
        return RunResult(
            action="status",
            success=True,
            exit_code=0,
            started_at=now,
            finished_at=now,
            stdout="Bot ocupado" if status.get("busy") else "Bot disponible",
            stderr="",
            metadata=status,
        )

    with bot_execution_lock(normalized):
        if normalized == "run_full_cycle":
            return _run_full_cycle(payload, timeout_sec=timeout_sec)

        if normalized in {"publish_facebook", "publish_instagram", "publish_tiktok", "publish_linkedin", "publish_image"}:
            started_at = time.time()
            payload = payload or {}
            platform = str(payload.get("platform") or "").strip().lower()
            if not platform and normalized != "publish_image":
                platform = normalized.replace("publish_", "").strip()
            if not platform:
                platform = "facebook"

            run_id = new_run(normalized, payload, status="running")
            env = _build_env_with_dotenv({"PUBLICIDAD_RUN_ID": run_id})

            args: list[str] = ["--platform", platform]
            if payload.get("webhook_url"):
                args += ["--webhook-url", str(payload["webhook_url"])]
            if payload.get("image_path"):
                args += ["--image-path", str(payload["image_path"])]
            if payload.get("category"):
                args += ["--category", str(payload["category"])]
            if payload.get("post_text"):
                args += ["--post-text", str(payload["post_text"])]
            if payload.get("post_text_file"):
                args += ["--post-text-file", str(payload["post_text_file"])]
            if payload.get("prompt_file"):
                args += ["--prompt-file", str(payload["prompt_file"])]

            rc, out, err = _run_python_simple(PUBLIC_IMG_PY, args, env=env, timeout_sec=min(timeout_sec, 600))
            finished_at = time.time()
            try:
                update_run(
                    run_id,
                    status="success" if rc == 0 else "error",
                    result={"exit_code": rc, "platform": platform},
                    error_text=(err[-1000:] if err else ""),
                )
            except Exception:
                pass
            return RunResult(
                action=normalized,
                success=rc == 0,
                exit_code=rc,
                started_at=started_at,
                finished_at=finished_at,
                stdout=out[-5000:],
                stderr=err[-5000:],
                metadata={"run_id": run_id, "platform": platform},
            )

        if normalized in {
            "create_google_campaign",
            "create_facebook_campaign",
            "create_linkedin_campaign",
            "create_campaign",
        }:
            started_at = time.time()
            payload = payload or {}
            platform = str(payload.get("platform") or "").strip().lower()
            if not platform and normalized != "create_campaign":
                platform = normalized.replace("create_", "").replace("_campaign", "").strip()
            if not platform:
                platform = "facebook"

            run_id = new_run(normalized, payload, status="running")
            env = _build_env_with_dotenv({"PUBLICIDAD_RUN_ID": run_id})

            script_payload = dict(payload)
            script_payload.pop("platform", None)
            script_payload.pop("webhook_url", None)
            args = ["--platform", platform]
            if payload.get("webhook_url"):
                args += ["--webhook-url", str(payload["webhook_url"])]
            if script_payload:
                args += ["--payload-json", json.dumps(script_payload, ensure_ascii=False)]

            rc, out, err = _run_python_simple(CREATE_CAMPAIGN_PY, args, env=env, timeout_sec=min(timeout_sec, 600))
            finished_at = time.time()
            try:
                update_run(
                    run_id,
                    status="success" if rc == 0 else "error",
                    result={"exit_code": rc, "platform": platform},
                    error_text=(err[-1000:] if err else ""),
                )
            except Exception:
                pass
            return RunResult(
                action=normalized,
                success=rc == 0,
                exit_code=rc,
                started_at=started_at,
                finished_at=finished_at,
                stdout=out[-5000:],
                stderr=err[-5000:],
                metadata={"run_id": run_id, "platform": platform},
            )

        raise BotRunnerError(f"Accion no soportada todavia: {normalized}")


def main() -> int:
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    payload: dict[str, Any] = {}
    if len(sys.argv) > 2:
        try:
            payload = json.loads(sys.argv[2])
        except json.JSONDecodeError as exc:
            log_error(f"Payload JSON invalido: {exc}")
            return 1

    # --- Preflight: verificar dependencias antes de cualquier accion ---
    if action != "status":
        try:
            from core.cfg.preflight import run_preflight, format_report
            all_ok, results = run_preflight()
            if not all_ok:
                log_error("Preflight: dependencias faltantes o incompatibles")
                print(format_report(results))
                return 1
            log_ok("Preflight: todas las dependencias OK")
        except Exception as e:
            log_warn(f"No se pudo ejecutar preflight: {e}")

    try:
        log_info(f"Ejecutando accion: {action}")
        result = execute_action(action, payload=payload)
        if result.success:
            log_ok(f"Accion '{action}' completada en {round(result.finished_at - result.started_at, 1)}s")
        else:
            log_warn(f"Accion '{action}' termino con exit_code={result.exit_code}")
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return 0 if result.success else 1
    except Exception as exc:
        log_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
