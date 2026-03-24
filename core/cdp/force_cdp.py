"""
Force CDP debug port on the DICloak browser profile.

Strategy (v2 — IPC hook injection):
1. Connect to DiCloak's CDP on port 9333.
2. Inject a JS hook that intercepts ipcRenderer.invoke('run-env', ...)
   and forces canIuseCdp=true in the openParams payload.
3. DiCloak then launches ginsbrowser WITH --remote-debugging-port automatically.
4. Detect the dynamic debug port from ginsbrowser's command line.
5. Save debug info to cdp_debug_info.json.

This replaces the old kill-and-relaunch approach which broke in DiCloak v2.8.13+
due to single-use --launch-key validation.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.cfg.platform import (
    IS_WINDOWS,
    get_cdp_version,
    get_process_list,
    get_browser_process_name,
    test_cdp_port,
    upsert_cdp_debug_info,
)
from core.utils.logger import log_info, log_ok, log_warn, log_error


# ---------------------------------------------------------------------------
# JS hook that gets injected into DiCloak's renderer process
# ---------------------------------------------------------------------------
CDP_HOOK_JS = r"""
(() => {
  if (window.__CDP_HOOK_INSTALLED__) return 'ALREADY_INSTALLED';
  window.__CDP_HOOK_INSTALLED__ = true;

  const { ipcRenderer } = require('electron');

  const _origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.invoke = function(channel, ...args) {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        _forceCdp(arg);
      }
    }
    return _origInvoke(channel, ...args);
  };

  const _origSend = ipcRenderer.send.bind(ipcRenderer);
  ipcRenderer.send = function(channel, ...args) {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        _forceCdp(arg);
      }
    }
    return _origSend(channel, ...args);
  };

  function _forceCdp(obj) {
    if (!obj || typeof obj !== 'object') return;
    if ('canIuseCdp' in obj) {
      obj.canIuseCdp = true;
    }
    if (obj.openParams && 'canIuseCdp' in obj.openParams) {
      obj.openParams.canIuseCdp = true;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && v !== obj) {
        _forceCdp(v);
      }
    }
  }

  return 'HOOK_INSTALLED';
})()
"""


def _cdp_evaluate(port: int, expression: str, timeout: int = 10) -> str | None:
    """Evaluate JS in DiCloak's renderer page via CDP HTTP endpoint."""
    try:
        # Get the first page target
        url = f"http://127.0.0.1:{port}/json"
        with urllib.request.urlopen(url, timeout=5) as resp:
            targets = json.loads(resp.read())

        page_target = None
        for t in targets:
            if t.get("type") == "page":
                page_target = t
                break

        if not page_target:
            log_warn("No se encontro pagina en DiCloak CDP.")
            return None

        ws_url = page_target.get("webSocketDebuggerUrl", "")
        if not ws_url:
            log_warn("No se encontro webSocketDebuggerUrl en target.")
            return None

        # Use CDP HTTP endpoint for evaluation (simpler than WebSocket)
        target_id = page_target.get("id", "")
        eval_url = f"http://127.0.0.1:{port}/json/evaluate/{target_id}"

        # Fallback: use the /json/protocol endpoint is not available,
        # so we use websocket-based evaluation via subprocess
        return _cdp_evaluate_via_python(port, ws_url, expression, timeout)

    except Exception as e:
        log_warn(f"Error en CDP evaluate: {e}")
        return None


def _cdp_evaluate_via_python(
    port: int, ws_url: str, expression: str, timeout: int = 10,
) -> str | None:
    """Evaluate JS via CDP WebSocket using a small inline Python script."""
    script = f"""
import json, asyncio
try:
    import websockets
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets

async def run():
    async with websockets.connect("{ws_url}", max_size=2**22) as ws:
        msg = json.dumps({{"id": 1, "method": "Runtime.evaluate", "params": {{"expression": {json.dumps(expression)}, "returnByValue": True}}}})
        await ws.send(msg)
        resp = await asyncio.wait_for(ws.recv(), timeout={timeout})
        data = json.loads(resp)
        result = data.get("result", {{}}).get("result", {{}})
        print(json.dumps(result))

asyncio.run(run())
"""
    try:
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=timeout + 5,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip())
            return data.get("value", str(data))
        if result.stderr:
            log_warn(f"CDP eval stderr: {result.stderr[:200]}")
        return None
    except Exception as e:
        log_warn(f"CDP eval via python fallo: {e}")
        return None


# ---------------------------------------------------------------------------
# Hook injection
# ---------------------------------------------------------------------------
def inject_cdp_hook(dicloak_port: int = 9333) -> bool:
    """Inject the canIuseCdp hook into DiCloak's renderer process.

    Must be called BEFORE opening a profile so the hook intercepts the
    IPC call that launches ginsbrowser.

    Returns True if the hook was installed successfully.
    """
    if not test_cdp_port(dicloak_port):
        log_error(f"DiCloak CDP no responde en puerto {dicloak_port}.")
        return False

    log_info("Inyectando hook CDP en DiCloak...")
    result = _cdp_evaluate(dicloak_port, CDP_HOOK_JS)

    if result and "INSTALLED" in str(result).upper():
        log_ok(f"Hook CDP inyectado: {result}")
        return True

    log_warn(f"Resultado inesperado del hook: {result}")
    return False


# ---------------------------------------------------------------------------
# Process helpers (kept from v1 for compatibility)
# ---------------------------------------------------------------------------
def _find_main_gins_process(procs: list[dict]) -> dict | None:
    """Find the main profile browser process (no --type= subprocess)."""
    browser_name = get_browser_process_name().lower()
    candidates = []
    for p in procs:
        name = str(p.get("name", "")).lower()
        cmd = str(p.get("cmdline", ""))
        cmd_lower = cmd.lower()

        matches_name = name == browser_name
        matches_cmd = (
            not IS_WINDOWS
            and (
                "ginsbrowser" in cmd_lower
                or "--user-data-dir" in cmd_lower
                or ".dicloakcache" in cmd_lower
            )
        )

        if not (matches_name or matches_cmd):
            continue
        if "--type=" in cmd:
            continue
        candidates.append(p)

    if not candidates:
        return None

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


def _parse_debug_port(cmdline: str) -> int:
    """Extract --remote-debugging-port=XXXXX from a command line."""
    m = re.search(r"--remote-debugging-port[=\s](\d{2,5})", cmdline, re.IGNORECASE)
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------------------
# Main: detect dynamic debug port after profile is opened
# ---------------------------------------------------------------------------
def detect_gins_debug_port(timeout_sec: int = 60) -> int:
    """Wait for ginsbrowser to appear and extract its dynamic debug port.

    After the hook forces canIuseCdp=true, DiCloak launches ginsbrowser
    with --remote-debugging-port=XXXXX (dynamic port). This function
    polls the process list until it finds it.
    """
    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        procs = get_process_list()
        main = _find_main_gins_process(procs)
        if main:
            cmd = main.get("cmdline", "")
            port = _parse_debug_port(cmd)
            if port and test_cdp_port(port):
                return port
            # Port found in cmdline but not yet responding
            if port:
                log_info(f"Puerto {port} encontrado en cmdline, esperando CDP...")
        time.sleep(1)

    return 0


def force_cdp(
    env_id: str = "",
    preferred_port: int = 9225,
    timeout_sec: int = 60,
    serial_number: str = "41",
    dicloak_port: int = 9333,
) -> dict[str, str]:
    """
    Force CDP debug port on the ginsbrowser profile.

    New strategy (v2):
    1. If ginsbrowser already has a working debug port, use it.
    2. Otherwise, inject hook + wait for dynamic port.

    Returns a dict with DEBUG_PORT, DEBUG_WS, etc.
    Raises RuntimeError on failure.
    """
    # --- Check if ginsbrowser is already running with CDP ---
    procs = get_process_list()
    main = _find_main_gins_process(procs)

    if main:
        cmd = main.get("cmdline", "")
        existing_port = _parse_debug_port(cmd)
        if existing_port and test_cdp_port(existing_port):
            env_from_cmd = _parse_env_id(cmd)
            if not env_id:
                env_id = env_from_cmd
            ver = get_cdp_version(existing_port)
            ws_url = ver.get("webSocketDebuggerUrl", "") if ver else ""
            path_out = upsert_cdp_debug_info(
                env_id=env_id, port=existing_port,
                ws_url=ws_url, pid=main["pid"], serial=serial_number,
            )
            log_ok(f"CDP ya activo en ginsbrowser: puerto {existing_port}")
            return {
                "DEBUG_PORT": str(existing_port),
                "DEBUG_WS": ws_url,
                "PID": str(main["pid"]),
                "ENV_ID": env_id or "unknown",
                "CDP_JSON_PATH": str(path_out),
            }

    # --- ginsbrowser no tiene CDP. Esperar a que aparezca con puerto dinamico ---
    log_info("Esperando que ginsbrowser inicie con puerto CDP dinamico...")
    port = detect_gins_debug_port(timeout_sec=timeout_sec)

    if not port:
        raise RuntimeError(
            "NO_DEBUG_PORT_DETECTED: ginsbrowser no inicio con "
            "--remote-debugging-port. Verifica que el hook CDP este inyectado."
        )

    # Get process info
    procs = get_process_list()
    main = _find_main_gins_process(procs)
    pid = main["pid"] if main else 0
    cmd = main.get("cmdline", "") if main else ""
    if not env_id:
        env_id = _parse_env_id(cmd)

    ver = get_cdp_version(port)
    ws_url = ver.get("webSocketDebuggerUrl", "") if ver else ""

    path_out = upsert_cdp_debug_info(
        env_id=env_id, port=port,
        ws_url=ws_url, pid=pid, serial=serial_number,
    )

    log_ok(f"CDP forzado via hook en puerto {port}")
    return {
        "DEBUG_PORT": str(port),
        "DEBUG_WS": ws_url,
        "PID": str(pid),
        "ENV_ID": env_id or "unknown",
        "CDP_JSON_PATH": str(path_out),
    }


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Forzar CDP en perfil DICloak")
    parser.add_argument("--env-id", default="")
    parser.add_argument("--preferred-port", type=int, default=9225)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--serial", default="41")
    parser.add_argument("--dicloak-port", type=int, default=9333)
    parser.add_argument("--inject-only", action="store_true",
                        help="Solo inyectar hook sin esperar ginsbrowser")
    args = parser.parse_args()

    if args.inject_only:
        ok = inject_cdp_hook(dicloak_port=args.dicloak_port)
        return 0 if ok else 1

    try:
        result = force_cdp(
            env_id=args.env_id,
            preferred_port=args.preferred_port,
            timeout_sec=args.timeout,
            serial_number=args.serial,
            dicloak_port=args.dicloak_port,
        )
        for k, v in result.items():
            print(f"{k}={v}")
        return 0
    except RuntimeError as e:
        log_error(f"ERROR={e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
