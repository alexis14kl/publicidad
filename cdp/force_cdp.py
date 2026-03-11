"""
Force CDP debug port on the DICloak browser profile.

Cross-platform replacement for forzar_cdp_perfil_dicloak.ps1.

Logic:
1. Find main ginsbrowser process (not a --type= subprocess).
2. Extract env_id, exe path, user-data-dir from its command line.
3. If it already has a working debug port, save info and exit.
4. Otherwise kill ginsbrowser, restart with --remote-debugging-port, poll until ready.
5. Save debug info to cdp_debug_info.json.
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
    find_free_port,
    get_cdp_version,
    get_process_list,
    kill_process_by_name,
    get_browser_process_name,
    launch_detached,
    test_cdp_port,
    upsert_cdp_debug_info,
)
from utils.logger import log_info, log_ok, log_warn, log_error


def _find_main_gins_process(procs: list[dict]) -> dict | None:
    """Find the main ginsbrowser process (not a --type= child)."""
    browser_name = get_browser_process_name()
    candidates = []
    for p in procs:
        name = p.get("name", "")
        cmd = p.get("cmdline", "")
        if name.lower() != browser_name.lower():
            continue
        if "--type=" in cmd:
            continue
        candidates.append(p)

    if not candidates:
        return None

    # Prefer processes with --user-data-dir and longer command lines
    def _score(p: dict) -> tuple[int, int]:
        cmd = p.get("cmdline", "")
        has_udd = 1 if "--user-data-dir" in cmd.lower() else 0
        return (has_udd, len(cmd))

    candidates.sort(key=_score, reverse=True)
    return candidates[0]


def _parse_env_id(cmdline: str) -> str:
    m = re.search(r"\.DICloakCache[/\\](\d{10,})[/\\]ud_\1", cmdline, re.IGNORECASE)
    return m.group(1) if m else ""


def _parse_exe_path(cmdline: str) -> str:
    m = re.match(r'^"([^"]+\.exe)"', cmdline, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.match(r'^([^\s"]+\.exe)\b', cmdline, re.IGNORECASE)
    if m:
        return m.group(1)
    # Mac/Linux: first token
    m = re.match(r'^"?([^\s"]+)', cmdline)
    if m:
        return m.group(1)
    return ""


def _parse_user_data_dir(cmdline: str) -> str:
    m = re.search(
        r"""--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))""",
        cmdline, re.IGNORECASE,
    )
    if not m:
        return ""
    return m.group(1) or m.group(2) or m.group(3) or ""


def force_cdp(
    env_id: str = "",
    preferred_port: int = 9225,
    timeout_sec: int = 60,
    serial_number: str = "41",
) -> dict[str, str]:
    """
    Force CDP debug port. Returns a dict with keys like DEBUG_PORT, DEBUG_WS, etc.
    Raises RuntimeError on failure.
    """
    procs = get_process_list()
    main = _find_main_gins_process(procs)
    if not main:
        raise RuntimeError("NO_MAIN_GINS_PROCESS")

    cmd = main.get("cmdline", "")
    env_from_cmd = _parse_env_id(cmd)
    if not env_id:
        env_id = env_from_cmd
    exe_path = _parse_exe_path(cmd)
    user_data_dir = _parse_user_data_dir(cmd)

    # Check if it already has a working debug port
    debug_match = re.search(r"--remote-debugging-port(?:=|\s+)(\d{2,5})", cmd, re.IGNORECASE)
    if debug_match:
        existing_port = int(debug_match.group(1))
        if test_cdp_port(existing_port):
            ver = get_cdp_version(existing_port)
            ws_url = ver.get("webSocketDebuggerUrl", "") if ver else ""
            path_out = upsert_cdp_debug_info(
                env_id=env_id, port=existing_port,
                ws_url=ws_url, pid=main["pid"], serial=serial_number,
            )
            log_ok(f"Puerto existente detectado: {existing_port}")
            return {
                "DEBUG_PORT": str(existing_port),
                "CDP_JSON_PATH": str(path_out),
            }

    # Need to restart with debug port
    target_port = find_free_port(start=preferred_port, span=120)
    log_info(f"Reiniciando ginsbrowser con --remote-debugging-port={target_port}")

    # Kill current ginsbrowser
    kill_process_by_name(get_browser_process_name(), force=True)
    time.sleep(1)

    # Build new command
    base_cmd = cmd
    if re.search(r"--remote-debugging-port(?:=|\s+)\d+", base_cmd, re.IGNORECASE):
        base_cmd = re.sub(
            r"--remote-debugging-port(?:=|\s+)\d+",
            f"--remote-debugging-port={target_port}",
            base_cmd, flags=re.IGNORECASE,
        )
    else:
        base_cmd = f"{base_cmd} --remote-debugging-port={target_port}"

    # Launch detached
    proc = launch_detached(base_cmd)

    # Poll for CDP
    deadline = time.time() + timeout_sec
    ok = False
    while time.time() < deadline:
        if test_cdp_port(target_port):
            ok = True
            break
        time.sleep(0.6)

    if not ok:
        raise RuntimeError(f"DEBUG_PORT_NOT_READY PORT={target_port}")

    ver = get_cdp_version(target_port)
    ws_url = ver.get("webSocketDebuggerUrl", "") if ver else ""

    # Get new PID
    new_pid = 0
    if proc and hasattr(proc, "pid"):
        new_pid = proc.pid
    else:
        # Try to find it from process list
        new_procs = get_process_list()
        new_main = _find_main_gins_process(new_procs)
        if new_main:
            new_pid = new_main["pid"]

    path_out = upsert_cdp_debug_info(
        env_id=env_id, port=target_port,
        ws_url=ws_url, pid=new_pid, serial=serial_number,
    )

    log_ok(f"CDP forzado en puerto {target_port}")
    return {
        "DEBUG_PORT": str(target_port),
        "DEBUG_WS": ws_url,
        "PID": str(new_pid),
        "ENV_ID": env_id,
        "CDP_JSON_PATH": str(path_out),
    }


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Forzar CDP en perfil DICloak")
    parser.add_argument("--env-id", default="")
    parser.add_argument("--preferred-port", type=int, default=9225)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--serial", default="41")
    args = parser.parse_args()

    try:
        result = force_cdp(
            env_id=args.env_id,
            preferred_port=args.preferred_port,
            timeout_sec=args.timeout,
            serial_number=args.serial,
        )
        for k, v in result.items():
            print(f"{k}={v}")
        return 0
    except RuntimeError as e:
        log_error(f"ERROR={e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
