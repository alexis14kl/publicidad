"""
Cross-platform utilities for the advertising bot.

Replaces Windows-specific paths, process management, and DICloak detection
that were previously hardcoded in .bat and .ps1 scripts.
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Project paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent

CFG_DIR = PROJECT_ROOT / "cfg"
INICIO_DIR = PROJECT_ROOT / "inicio"
PERFIL_DIR = PROJECT_ROOT / "perfil"
CDP_DIR = PROJECT_ROOT / "cdp"
PROMPT_DIR = PROJECT_ROOT / "prompt"
SERVER_DIR = PROJECT_ROOT / "server"
UTILS_DIR = PROJECT_ROOT / "utils"
DEBUG_DIR = PROJECT_ROOT / "debug"
DOCS_DIR = PROJECT_ROOT / "docs"
IMG_PUBLICITARIAS_DIR = PROJECT_ROOT / "img_publicitarias"
LOGS_DIR = PROJECT_ROOT / "logs"

# Scripts
SCRIPT_PATH = PERFIL_DIR / "abrir_perfil_dicloak.js"
FORCE_OPEN_JS = PERFIL_DIR / "force_open_profile_cdp.js"
CHANGE_COUNT_PY = PERFIL_DIR / "change_count.py"
PROMPT_AUTOMATION_PY = PROMPT_DIR / "page_pronmt.py"
DOWNLOAD_GENERATED_IMAGE_PY = PROMPT_DIR / "download_generated_image.py"
N8N_PROMPT_CLIENT_PY = UTILS_DIR / "n8n_prompt_client.py"
N8N_POST_TEXT_CLIENT_PY = UTILS_DIR / "n8n_post_text_client.py"
PUBLIC_IMG_PY = PROJECT_ROOT / "n8n" / "public_img.py"
VERIFY_TOKEN_FB_PY = PROJECT_ROOT / "n8n" / "verify_token_fb.py"
OVERLAY_LOGO_PY = UTILS_DIR / "overlay_logo.py"
RUN_WITH_PROGRESS_PY = UTILS_DIR / "run_with_progress.py"

# Video/Reel pipeline
VIDEO_RPA_DIR = PROJECT_ROOT / "video_rpa"
VIDEO_SETUP_PY = VIDEO_RPA_DIR / "video_setup.py"
DOWNLOAD_VIDEO_PY = VIDEO_RPA_DIR / "download_generated_video.py"
DIRECT_VIDEO_UPLOAD_PY = VIDEO_RPA_DIR / "direct_video_upload.py"
PUBLIC_VIDEO_PY = VIDEO_RPA_DIR / "public_video.py"
VIDEO_DIR = PROJECT_ROOT / "videos_publicitarias"

# Data files
PROMPT_FILE = UTILS_DIR / "prontm.txt"
PROMPT_SEED_FILE = UTILS_DIR / "prompt_seed.txt"
POST_TEXT_FILE = UTILS_DIR / "post_text.txt"

IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")


# ---------------------------------------------------------------------------
# DICloak app data directory
# ---------------------------------------------------------------------------
def get_dicloak_appdata() -> Path:
    """Return the DICloak application data directory for the current OS."""
    if IS_WINDOWS:
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif IS_MAC:
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "DICloak"


CDP_DEBUG_INFO_JSON = get_dicloak_appdata() / "cdp_debug_info.json"
DEVTOOLS_ACTIVE_PORT_FILE = get_dicloak_appdata() / "DevToolsActivePort"


# ---------------------------------------------------------------------------
# DICloak executable detection
# ---------------------------------------------------------------------------
def find_dicloak_exe() -> str | None:
    """Find the DICloak executable on this system."""
    if IS_WINDOWS:
        candidates = [
            Path(r"C:\Program Files\DICloak\DICloak.exe"),
            Path(r"C:\Program Files (x86)\DICloak\DICloak.exe"),
            Path(os.environ.get("LOCALAPPDATA", "") or "") / "Programs" / "dicloak" / "DICloak.exe",
            Path(os.environ.get("ProgramFiles", "") or "") / "DICloak" / "DICloak.exe",
        ]
    elif IS_MAC:
        candidates = [
            Path("/Applications/DICloak.app/Contents/MacOS/DICloak"),
            Path.home() / "Applications" / "DICloak.app" / "Contents" / "MacOS" / "DICloak",
        ]
    else:
        candidates = [
            Path("/opt/DICloak/dicloak"),
            Path.home() / ".local" / "bin" / "dicloak",
        ]

    for p in candidates:
        if p.exists():
            return str(p)

    # Fallback: check PATH
    found = shutil.which("DICloak") or shutil.which("dicloak")
    if found:
        return found

    return None


# ---------------------------------------------------------------------------
# Process management (cross-platform)
# ---------------------------------------------------------------------------
def _get_process_list_windows() -> list[dict[str, Any]]:
    """Get process list via PowerShell on Windows (handles commas in CommandLine)."""
    try:
        # Use PowerShell to get process info as JSON — avoids CSV comma issues
        ps_cmd = (
            "Get-CimInstance Win32_Process | "
            "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | "
            "ConvertTo-Json -Compress"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True, text=True, timeout=30, encoding="utf-8", errors="ignore",
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []

        data = json.loads(result.stdout)
        if isinstance(data, dict):
            data = [data]  # single process edge case

        procs = []
        for item in data:
            try:
                procs.append({
                    "pid": int(item.get("ProcessId", 0)),
                    "ppid": int(item.get("ParentProcessId", 0)),
                    "name": str(item.get("Name", "")),
                    "exe": str(item.get("ExecutablePath") or ""),
                    "cmdline": str(item.get("CommandLine") or ""),
                })
            except (ValueError, TypeError):
                continue
        return procs
    except Exception:
        return []


def _get_process_list_unix() -> list[dict[str, Any]]:
    """Get process list via ps on Mac/Linux."""
    try:
        # On macOS the command line can be very long (Chromium-based profiles).
        # Without wide output, `ps` may truncate args and break CDP/port forcing.
        cmd = ["ps", "-eo", "pid,ppid,comm,args"]
        if IS_MAC:
            cmd.append("-ww")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = result.stdout.strip().splitlines()
        if len(lines) < 2:
            return []
        procs = []
        for line in lines[1:]:
            parts = line.split(None, 3)
            if len(parts) < 4:
                continue
            try:
                procs.append({
                    "pid": int(parts[0]),
                    "ppid": int(parts[1]),
                    "name": Path(parts[2]).name,
                    "exe": parts[2],
                    "cmdline": parts[3],
                })
            except (ValueError, TypeError):
                continue
        return procs
    except Exception:
        return []


def get_process_list() -> list[dict[str, Any]]:
    """Get list of running processes (cross-platform)."""
    if IS_WINDOWS:
        return _get_process_list_windows()
    return _get_process_list_unix()


def kill_process_by_pid(pid: int, force: bool = True) -> bool:
    """Kill a process by PID. Returns True if attempted."""
    if pid <= 0:
        return False
    try:
        if IS_WINDOWS:
            args = ["taskkill", "/F", "/T", "/PID", str(pid)] if force else ["taskkill", "/PID", str(pid)]
            subprocess.run(args, capture_output=True, timeout=10)
        else:
            sig = signal.SIGKILL if force else signal.SIGTERM
            os.kill(pid, sig)
        return True
    except Exception:
        return False


def kill_process_by_name(name: str, force: bool = True) -> bool:
    """Kill all processes matching a name (cross-platform)."""
    try:
        if IS_WINDOWS:
            args = ["taskkill", "/F", "/IM", name] if force else ["taskkill", "/IM", name]
            subprocess.run(args, capture_output=True, timeout=10)
        else:
            args = ["pkill", "-9", "-f", name] if force else ["pkill", "-f", name]
            subprocess.run(args, capture_output=True, timeout=10)
        return True
    except Exception:
        return False


def is_process_running(name: str) -> bool:
    """Check if a process with given name is running."""
    try:
        if IS_WINDOWS:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {name}"],
                capture_output=True, text=True, timeout=10,
            )
            return name.lower() in result.stdout.lower()
        else:
            result = subprocess.run(
                ["pgrep", "-f", name],
                capture_output=True, text=True, timeout=10,
            )
            return result.returncode == 0
    except Exception:
        return False


def get_browser_process_name() -> str:
    """Get the DICloak browser process name for this platform."""
    if IS_WINDOWS:
        return "ginsbrowser.exe"
    elif IS_MAC:
        return "ginsbrowser"
    return "ginsbrowser"


def launch_detached(cmd: list[str] | str, **kwargs: Any) -> subprocess.Popen | None:
    """Launch a process detached from the current terminal."""
    try:
        if IS_WINDOWS:
            flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            if isinstance(cmd, str):
                # Use CIM Win32_Process Create via PowerShell — handles very
                # long command lines like ginsbrowser's (4000+ chars).
                escaped = cmd.replace("'", "''")
                ps_script = (
                    "$r = Invoke-CimMethod -ClassName Win32_Process "
                    f"-MethodName Create -Arguments @{{ CommandLine = '{escaped}' }}; "
                    "$r.ProcessId"
                )
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command", ps_script],
                    capture_output=True, text=True, timeout=15,
                )
                return None
            return subprocess.Popen(
                cmd,
                creationflags=flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs,
            )
        else:
            if isinstance(cmd, str):
                cmd = ["sh", "-c", cmd]
            return subprocess.Popen(
                cmd,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs,
            )
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Port utilities
# ---------------------------------------------------------------------------
def get_port_listeners(port: int) -> list[int]:
    """Get PIDs listening on a given port."""
    pids: list[int] = []
    try:
        if IS_WINDOWS:
            result = subprocess.run(
                ["netstat", "-ano", "-p", "tcp"],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.splitlines():
                tokens = line.split()
                if len(tokens) < 5:
                    continue
                if tokens[0] != "TCP":
                    continue
                if "LISTENING" not in tokens[3]:
                    continue
                if not tokens[1].endswith(f":{port}"):
                    continue
                local = tokens[1]
                if not re.match(r'^(127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])', local):
                    continue
                try:
                    pid = int(tokens[4])
                    if pid > 0:
                        pids.append(pid)
                except ValueError:
                    pass
        else:
            result = subprocess.run(
                ["lsof", "-iTCP:" + str(port), "-sTCP:LISTEN", "-t"],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.strip().splitlines():
                try:
                    pids.append(int(line.strip()))
                except ValueError:
                    pass
    except Exception:
        pass
    return list(set(pids))


def is_port_in_use(port: int) -> bool:
    """Check if a port is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_free_port(start: int = 9225, span: int = 200) -> int:
    """Find a free port starting from start."""
    for p in range(start, start + span):
        if not is_port_in_use(p):
            return p
    return start


# ---------------------------------------------------------------------------
# CDP utilities
# ---------------------------------------------------------------------------
def test_cdp_port(port: int, timeout: int = 2) -> bool:
    """Test if a CDP endpoint is responding on a port."""
    if port < 1 or port > 65535:
        return False
    for host in ("127.0.0.1", "localhost"):
        try:
            url = f"http://{host}:{port}/json/version"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                if b"webSocketDebuggerUrl" in data:
                    return True
        except Exception:
            continue
    return False


def wait_for_cdp(port: int, timeout_sec: int = 90, poll_interval: float = 1.0) -> bool:
    """Wait until CDP responds on the given port."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if test_cdp_port(port):
            return True
        time.sleep(poll_interval)
    return False


def get_cdp_version(port: int, timeout: int = 3) -> dict | None:
    """Get CDP /json/version response."""
    for host in ("127.0.0.1", "localhost"):
        try:
            url = f"http://{host}:{port}/json/version"
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception:
            continue
    return None


def read_cdp_debug_info() -> dict:
    """Read the cdp_debug_info.json file."""
    if not CDP_DEBUG_INFO_JSON.exists():
        return {}
    try:
        return json.loads(CDP_DEBUG_INFO_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_cdp_debug_info(data: dict) -> Path:
    """Write the cdp_debug_info.json file with retry."""
    CDP_DEBUG_INFO_JSON.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(30):
        try:
            CDP_DEBUG_INFO_JSON.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            return CDP_DEBUG_INFO_JSON
        except OSError:
            time.sleep(0.15)
    return CDP_DEBUG_INFO_JSON


def upsert_cdp_debug_info(
    env_id: str,
    port: int,
    ws_url: str = "",
    pid: int = 0,
    serial: str = "41",
) -> Path:
    """Add or update an entry in cdp_debug_info.json."""
    data = read_cdp_debug_info()
    if not env_id:
        env_id = "unknown_env"
    data[env_id] = {
        "debugPort": port,
        "webSocketUrl": ws_url,
        "pid": pid,
        "serialNumber": serial,
        "envId": env_id,
    }
    return write_cdp_debug_info(data)


# ---------------------------------------------------------------------------
# Windows service management (no-op on other platforms)
# ---------------------------------------------------------------------------
def stop_dicloak_services() -> None:
    """Stop DICloak-related Windows services. No-op on Mac/Linux."""
    if not IS_WINDOWS:
        return
    try:
        result = subprocess.run(
            ["wmic", "service", "where", "Name like '%dicloak%' or PathName like '%DICloak%'",
             "get", "Name", "/FORMAT:CSV"],
            capture_output=True, text=True, timeout=15, encoding="utf-8", errors="ignore",
        )
        for line in result.stdout.strip().splitlines()[1:]:
            parts = line.strip().split(",")
            if len(parts) >= 2 and parts[1].strip():
                svc_name = parts[1].strip()
                subprocess.run(["sc", "stop", svc_name], capture_output=True, timeout=10)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------
def load_env(env_file: Path | None = None) -> dict[str, str]:
    """Load .env file into a dict. Does NOT modify os.environ."""
    if env_file is None:
        env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return {}
    result: dict[str, str] = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key:
            result[key] = value
    return result


def get_env(key: str, default: str = "") -> str:
    """Get a config value: os.environ first, then .env file, then default."""
    val = os.environ.get(key)
    if val is not None:
        return val
    env_data = load_env()
    return env_data.get(key, default)
