from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error  # noqa: E402

START_BAT = PROJECT_ROOT / "iniciar.bat"
LOCK_FILE = PROJECT_ROOT / ".bot_runner.lock"


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


@contextmanager
def bot_execution_lock(action: str) -> Any:
    if LOCK_FILE.exists():
        current = _read_lock()
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
    return LOCK_FILE.exists()


def get_status() -> dict[str, Any]:
    if not LOCK_FILE.exists():
        return {"busy": False}
    lock = _read_lock()
    lock["busy"] = True
    return lock


def _run_full_cycle(payload: dict[str, Any] | None, timeout_sec: int) -> RunResult:
    if not START_BAT.exists():
        raise BotRunnerError(f"No existe iniciar.bat en {START_BAT}")

    payload = payload or {}
    profile_name = str(payload.get("profile_name", "")).strip()

    command = ["cmd", "/c", str(START_BAT)]
    if profile_name:
        command.append(profile_name)

    env = os.environ.copy()
    env["NO_PAUSE"] = "1"

    started_at = time.time()
    result = subprocess.run(
        command,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=timeout_sec,
        env=env,
    )
    finished_at = time.time()
    return RunResult(
        action="run_full_cycle",
        success=result.returncode == 0,
        exit_code=result.returncode,
        started_at=started_at,
        finished_at=finished_at,
        stdout=result.stdout.strip(),
        stderr=result.stderr.strip(),
        metadata={"profile_name": profile_name},
    )


def execute_action(action: str, payload: dict[str, Any] | None = None, timeout_sec: int = 7200) -> RunResult:
    normalized = (action or "").strip().lower()
    if not normalized:
        raise BotRunnerError("La accion no puede estar vacia")

    with bot_execution_lock(normalized):
        if normalized == "status":
            now = time.time()
            return RunResult(
                action="status",
                success=True,
                exit_code=0,
                started_at=now,
                finished_at=now,
                stdout="Bot disponible",
                stderr="",
                metadata={"busy": False},
            )

        if normalized == "run_full_cycle":
            return _run_full_cycle(payload, timeout_sec=timeout_sec)

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
