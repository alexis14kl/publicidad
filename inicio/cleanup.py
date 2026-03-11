"""
Advanced DICloak cleanup — cross-platform replacement for cerrar_dicloak_avanzado.ps1.

Stops DICloak services (Windows), finds all DICloak-related processes (and their
descendants), kills them, and clears port listeners. Loops until clean or timeout.
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import (
    IS_WINDOWS,
    get_browser_process_name,
    get_port_listeners,
    get_process_list,
    kill_process_by_pid,
    stop_dicloak_services,
)
from utils.logger import log_info, log_ok, log_error


# ---------------------------------------------------------------------------
# Seed detection: find DICloak-related PIDs
# ---------------------------------------------------------------------------
_PATH_REGEX = re.compile(
    r"([/\\])DICloak([/\\])|\.DICloakCache|[/\\]AppData[/\\]Roaming[/\\]DICloak[/\\]"
    r"|/Library/Application Support/DICloak/",
    re.IGNORECASE,
)
_NAME_REGEX = re.compile(r"^(DICloak|gost|ginsbrowser|chrome)(\.exe)?$", re.IGNORECASE)
_CMD_HINT = re.compile(r"\bDICloak\b", re.IGNORECASE)


def _get_seed_pids(procs: list[dict]) -> set[int]:
    seeds: set[int] = set()
    for p in procs:
        name = p.get("name", "")
        exe = p.get("exe", "")
        cmd = p.get("cmdline", "")
        by_name = bool(_NAME_REGEX.match(name))
        by_path = bool(_PATH_REGEX.search(exe) or _PATH_REGEX.search(cmd))
        by_hint = bool(_CMD_HINT.search(cmd))
        if by_name or by_path or by_hint:
            seeds.add(p["pid"])
    return seeds


def _expand_descendants(procs: list[dict], seeds: set[int]) -> set[int]:
    children: dict[int, list[int]] = {}
    for p in procs:
        ppid = p.get("ppid", 0)
        children.setdefault(ppid, []).append(p["pid"])

    result: set[int] = set()
    queue = list(seeds)
    while queue:
        pid = queue.pop()
        if pid in result:
            continue
        result.add(pid)
        for child in children.get(pid, []):
            if child not in result:
                queue.append(child)
    return result


# ---------------------------------------------------------------------------
# Main cleanup loop
# ---------------------------------------------------------------------------
def cleanup_dicloak(port: int = 9333, timeout_sec: int = 45, quiet: bool = False) -> bool:
    """
    Kill all DICloak-related processes and clear port listeners.
    Returns True if cleanup succeeded (no survivors).
    """
    def _log(msg: str) -> None:
        if not quiet:
            log_info(msg)

    _log(f"Limpieza avanzada de DICloak iniciada (timeout: {timeout_sec}s, puerto: {port})")
    deadline = time.time() + max(timeout_sec, 8)
    pass_num = 0

    while time.time() < deadline:
        pass_num += 1
        _log(f"Pass {pass_num}")

        # Step 1: Stop Windows services
        stop_dicloak_services()

        # Step 2: Find and kill process tree
        procs = get_process_list()
        seeds = _get_seed_pids(procs)
        targets = _expand_descendants(procs, seeds)

        if targets:
            _log(f"Targets detectados: {', '.join(str(t) for t in sorted(targets))}")
            for pid in targets:
                kill_process_by_pid(pid, force=True)

        # Step 3: Kill port listeners
        port_pids = get_port_listeners(port)
        for pid in port_pids:
            kill_process_by_pid(pid, force=True)

        time.sleep(0.7)

        # Step 4: Check survivors
        procs = get_process_list()
        seeds = _get_seed_pids(procs)
        survivors = _expand_descendants(procs, seeds)
        port_owners = get_port_listeners(port)

        if not survivors and not port_owners:
            if not quiet:
                log_ok("Limpieza completa: sin procesos residuales y sin listener en el puerto.")
            return True

    # Timeout reached
    procs = get_process_list()
    seeds = _get_seed_pids(procs)
    survivors = _expand_descendants(procs, seeds)
    port_owners = get_port_listeners(port)

    log_error("No se pudo limpiar por completo DICloak.")
    if survivors:
        log_error(f"Procesos residuales: {sorted(survivors)}")
    if port_owners:
        log_error(f"PID(s) escuchando puerto {port}: {port_owners}")
    return False


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Limpieza avanzada de DICloak")
    parser.add_argument("--port", type=int, default=9333)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    ok = cleanup_dicloak(port=args.port, timeout_sec=args.timeout, quiet=args.quiet)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
