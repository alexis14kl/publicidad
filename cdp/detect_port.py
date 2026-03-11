"""
Detect the real debug port of the DICloak browser profile.

Cross-platform replacement for obtener_puerto_perfil_cdp.ps1.

Strategy:
1. Read cdp_debug_info.json and test each port.
2. Fallback: scan ginsbrowser listening ports and test for CDP.
3. Poll until found or timeout.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import (
    IS_WINDOWS,
    get_browser_process_name,
    get_process_list,
    read_cdp_debug_info,
    test_cdp_port,
)
from utils.logger import log_info, log_warn


def _get_port_from_json(env_id: str = "") -> int | None:
    """Try to get a working debug port from cdp_debug_info.json."""
    data = read_cdp_debug_info()
    if not data:
        return None

    # Try specific env_id first
    if env_id and env_id in data:
        entry = data[env_id]
        port = int(entry.get("debugPort", 0))
        if port and test_cdp_port(port):
            return port

    # Try all entries
    for key, entry in data.items():
        if not isinstance(entry, dict):
            continue
        port = int(entry.get("debugPort", 0))
        if port and test_cdp_port(port):
            return port

    return None


def _get_port_from_gins_fallback() -> int | None:
    """Scan ginsbrowser processes for listening ports with CDP."""
    browser_name = get_browser_process_name()
    procs = get_process_list()
    gins_pids = set()
    for p in procs:
        if p.get("name", "").lower() == browser_name.lower():
            gins_pids.add(p["pid"])

    if not gins_pids:
        return None

    if IS_WINDOWS:
        return _scan_ports_windows(gins_pids)
    else:
        return _scan_ports_unix(gins_pids)


def _scan_ports_windows(pids: set[int]) -> int | None:
    """Use netstat to find listening ports owned by given PIDs."""
    import subprocess
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True, text=True, timeout=10,
        )
        for line in result.stdout.splitlines():
            tokens = line.split()
            if len(tokens) < 5 or tokens[0] != "TCP" or "LISTENING" not in tokens[3]:
                continue
            try:
                pid = int(tokens[4])
            except ValueError:
                continue
            if pid not in pids:
                continue
            # Extract port
            local = tokens[1]
            if ":" in local:
                port_str = local.rsplit(":", 1)[1]
                try:
                    port = int(port_str)
                    if test_cdp_port(port):
                        return port
                except ValueError:
                    pass
    except Exception:
        pass
    return None


def _scan_ports_unix(pids: set[int]) -> int | None:
    """Use lsof to find listening ports owned by given PIDs."""
    import subprocess
    for pid in pids:
        try:
            result = subprocess.run(
                ["lsof", "-i", "-P", "-n", "-p", str(pid)],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.splitlines():
                if "LISTEN" not in line:
                    continue
                # Extract port from something like *:9225
                parts = line.split()
                for part in parts:
                    if ":" in part:
                        port_str = part.rsplit(":", 1)[1]
                        try:
                            port = int(port_str)
                            if test_cdp_port(port):
                                return port
                        except ValueError:
                            pass
        except Exception:
            pass
    return None


def detect_debug_port(
    env_id: str = "",
    timeout_sec: int = 120,
) -> int | None:
    """
    Detect the real debug port of the profile.
    Polls until found or timeout. Returns port number or None.
    """
    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        # Try JSON first
        port = _get_port_from_json(env_id)
        if port:
            log_info(f"Puerto detectado desde JSON: {port}")
            return port

        # Fallback: process scan
        port = _get_port_from_gins_fallback()
        if port:
            log_info(f"Puerto detectado desde proceso: {port}")
            return port

        time.sleep(0.8)

    log_warn("No se detecto puerto de debug dentro del timeout.")
    return None


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Detectar puerto CDP de perfil DICloak")
    parser.add_argument("--env-id", default="")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    port = detect_debug_port(env_id=args.env_id, timeout_sec=args.timeout)
    if port:
        print(f"DEBUG_PORT={port}")
        return 0
    else:
        print("ERROR=NO_DEBUG_PORT_DETECTED")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
