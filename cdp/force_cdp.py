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
import subprocess
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
    is_port_in_use,
    kill_process_by_name,
    get_browser_process_name,
    launch_detached,
    test_cdp_port,
    upsert_cdp_debug_info,
)
from utils.logger import log_info, log_ok, log_warn, log_error


def _find_main_gins_process(procs: list[dict]) -> dict | None:
    """Find the main profile browser process.

    On Windows the process name is stable (`ginsbrowser.exe`), but on macOS the
    actual `comm` name exposed by `ps` can vary even when the full command line
    still contains the embedded ginsbrowser path and the profile arguments.
    """
    browser_name = get_browser_process_name().lower()
    candidates = []
    for p in procs:
        name = str(p.get("name", "")).lower()
        cmd = str(p.get("cmdline", ""))
        cmd_lower = cmd.lower()

        matches_windows_name = name == browser_name
        matches_mac_cmd = (
            not IS_WINDOWS
            and (
                "ginsbrowser" in cmd_lower
                or "--user-data-dir" in cmd_lower
                or ".dicloakcache" in cmd_lower
            )
        )

        if not (matches_windows_name or matches_mac_cmd):
            continue
        if "--type=" in cmd:
            continue
        candidates.append(p)

    if not candidates:
        return None

    # Prefer processes with --user-data-dir and longer command lines
    def _score(p: dict) -> tuple[int, int, int, int]:
        cmd = str(p.get("cmdline", ""))
        cmd_lower = cmd.lower()
        name = str(p.get("name", "")).lower()
        has_udd = 1 if "--user-data-dir" in cmd_lower else 0
        has_cache = 1 if ".dicloakcache" in cmd_lower else 0
        has_gins = 1 if ("ginsbrowser" in cmd_lower or "ginsbrowser" in name) else 0
        return (has_udd, has_cache, has_gins, len(cmd))

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


def _extract_mac_exe_path(cmdline: str) -> str:
    cmd = str(cmdline or "").strip()
    if not cmd:
        return ""
    if " --" in cmd:
        return cmd.split(" --", 1)[0].strip()
    return cmd


def _extract_mac_flag_value(cmdline: str, flag_name: str) -> str:
    cmd = str(cmdline or "")
    pattern = rf"--{re.escape(flag_name)}=(.*?)(?=\s+--[A-Za-z]|\s+https?://|$)"
    m = re.search(pattern, cmd, re.IGNORECASE)
    return (m.group(1) if m else "").strip()


def _extract_mac_urls(cmdline: str) -> list[str]:
    return re.findall(r"https?://\S+", str(cmdline or ""))


def _build_mac_launch_command(cmdline: str, debug_port: int) -> list[str]:
    exe_path = _extract_mac_exe_path(cmdline)
    if not exe_path:
        return []

    args: list[str] = []
    for raw_flag in ("no-first-run", "devtools-flags", "no-sandbox"):
        if re.search(rf"--{re.escape(raw_flag)}(?:\s|$)", cmdline, re.IGNORECASE):
            args.append(f"--{raw_flag}")

    for key in ("load-extension", "launch-key", "user-data-dir", "user-agent", "lang", "proxy-server"):
        value = _extract_mac_flag_value(cmdline, key)
        if value:
            args.append(f"--{key}={value}")

    args.extend(_extract_mac_urls(cmdline))
    args.append(f"--remote-debugging-port={debug_port}")
    return [exe_path, *args]


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
            if existing_port != preferred_port:
                log_info(
                    f"Puerto CDP existente detectado en {existing_port}, "
                    f"pero se normalizara a {preferred_port}."
                )
            else:
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
    target_port = preferred_port
    if is_port_in_use(preferred_port) and not test_cdp_port(preferred_port):
        fallback_port = find_free_port(start=preferred_port + 1, span=119)
        log_warn(
            f"El puerto preferido {preferred_port} esta ocupado por otro proceso. "
            f"Se usara temporalmente {fallback_port}."
        )
        target_port = fallback_port

    log_info(f"Reiniciando ginsbrowser con --remote-debugging-port={target_port}")

    # Kill current ginsbrowser
    kill_process_by_name(get_browser_process_name(), force=True)
    # Wait for process to fully die and release profile locks
    time.sleep(3)

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

    # Launch detached. macOS needs a list-form command because the raw command
    # line coming from `ps` contains paths with spaces and unquoted values.
    if IS_WINDOWS:
        launch_detached(base_cmd)
    else:
        mac_cmd = _build_mac_launch_command(cmd, target_port)
        if not mac_cmd:
            raise RuntimeError("MAC_LAUNCH_COMMAND_NOT_RESOLVED")
        try:
            subprocess.Popen(
                mac_cmd,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            raise RuntimeError(f"MAC_LAUNCH_FAILED {e}") from e

    # Verify ginsbrowser actually started (wait up to 8s)
    browser_up = False
    for _ in range(16):
        time.sleep(0.5)
        new_procs = get_process_list()
        new_main = _find_main_gins_process(new_procs)
        if new_main:
            browser_up = True
            break

    if not browser_up:
        # Fallback: try launching with list-form command to avoid CIM issues
        log_warn("CIM no lanzo ginsbrowser. Intentando con Popen directo...")
        try:
            if IS_WINDOWS:
                exe_path_parsed = _parse_exe_path(base_cmd)
                if exe_path_parsed:
                    args_str = base_cmd
                    if args_str.startswith('"'):
                        close_idx = args_str.index('"', 1)
                        args_str = args_str[close_idx + 1:].strip()
                    elif exe_path_parsed in args_str:
                        args_str = args_str[len(exe_path_parsed):].strip()
                    flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                    subprocess.Popen(
                        f'"{exe_path_parsed}" {args_str}',
                        shell=True,
                        creationflags=flags,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
            else:
                mac_cmd = _build_mac_launch_command(cmd, target_port)
                if mac_cmd:
                    subprocess.Popen(
                        mac_cmd,
                        start_new_session=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
            time.sleep(3)
        except Exception as e:
            log_warn(f"Fallback Popen tambien fallo: {e}")

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
    new_procs = get_process_list()
    new_main = _find_main_gins_process(new_procs)
    new_pid = new_main["pid"] if new_main else 0

    path_out = upsert_cdp_debug_info(
        env_id=env_id, port=target_port,
        ws_url=ws_url, pid=new_pid, serial=serial_number,
    )

    # Minimizar ginsbrowser despues del relanzamiento con depuracion
    time.sleep(3)
    try:
        import pygetwindow as gw
        import psutil
        # Obtener PIDs de ginsbrowser para identificar sus ventanas
        gins_pids = set()
        for proc in psutil.process_iter(["name", "pid"]):
            name = (proc.info["name"] or "").lower()
            if "ginsbrowser" in name or "dicloak" in name:
                gins_pids.add(proc.info["pid"])
        for w in gw.getAllWindows():
            title = w.title.lower()
            if ("ginsbrowser" in title or "dicloak" in title
                    or "chatgpt" in title or "127.0.0.1" in title):
                if not w.isMinimized:
                    w.minimize()
    except Exception:
        pass

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
