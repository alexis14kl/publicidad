"""
CDP Bridge — Controla DICloak via Chrome DevTools Protocol.

Se conecta al CDP de DICloak (puerto 9333) para:
- Listar perfiles disponibles
- Abrir/cerrar perfiles
- Detectar puertos CDP dinámicos de ginsbrowser

No usa Playwright ni Node.js — solo WebSocket + HTTP directo.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import urllib.request
from dataclasses import dataclass

from core.utils.logger import log_info, log_ok, log_warn, log_error


DEFAULT_DICLOAK_PORT = 9333


@dataclass
class ProfileInfo:
    id: str
    name: str
    status: str = "stopped"
    debug_port: int = 0
    ws_url: str = ""
    pid: int = 0


def _http_get_json(url: str, timeout: int = 5) -> dict | list:
    """GET request simple, retorna JSON."""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _test_cdp_port(port: int) -> bool:
    """Verifica si un puerto CDP responde."""
    try:
        data = _http_get_json(f"http://127.0.0.1:{port}/json/version", timeout=3)
        return "webSocketDebuggerUrl" in str(data)
    except Exception:
        return False


def is_dicloak_ready(port: int = DEFAULT_DICLOAK_PORT) -> bool:
    """Verifica si DICloak responde en su puerto CDP."""
    return _test_cdp_port(port)


def get_dicloak_targets(port: int = DEFAULT_DICLOAK_PORT) -> list[dict]:
    """Obtiene los targets CDP de DICloak."""
    try:
        return _http_get_json(f"http://127.0.0.1:{port}/json")
    except Exception:
        return []


def _get_ws_url(port: int = DEFAULT_DICLOAK_PORT) -> str:
    """Obtiene la WebSocket URL del target principal de DICloak."""
    targets = get_dicloak_targets(port)
    for t in targets:
        if t.get("type") == "page":
            return t.get("webSocketDebuggerUrl", "")
    return ""


async def _cdp_evaluate(ws_url: str, expression: str, timeout: int = 10) -> str | None:
    """Evalúa JavaScript en DICloak via CDP WebSocket."""
    try:
        import websockets
    except ImportError:
        import subprocess, sys
        subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
        import websockets

    try:
        async with websockets.connect(ws_url, max_size=2**22) as ws:
            msg = json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {"expression": expression, "returnByValue": True}
            })
            await ws.send(msg)
            resp = await asyncio.wait_for(ws.recv(), timeout=timeout)
            data = json.loads(resp)
            result = data.get("result", {}).get("result", {})
            return result.get("value", json.dumps(result))
    except Exception as e:
        log_warn(f"CDP evaluate error: {e}")
        return None


def cdp_evaluate_sync(expression: str, port: int = DEFAULT_DICLOAK_PORT, timeout: int = 10) -> str | None:
    """Versión sync de _cdp_evaluate. Funciona dentro o fuera de un event loop."""
    ws_url = _get_ws_url(port)
    if not ws_url:
        return None
    try:
        loop = asyncio.get_running_loop()
        # Ya hay un loop corriendo (uvicorn/FastAPI) — usar thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(
                asyncio.run, _cdp_evaluate(ws_url, expression, timeout)
            ).result(timeout=timeout + 5)
    except RuntimeError:
        # No hay loop — crear uno
        return asyncio.run(_cdp_evaluate(ws_url, expression, timeout))


# ── Profile Operations via CDP ────────────────────────────────────────────

def list_profiles_via_cdp(port: int = DEFAULT_DICLOAK_PORT) -> list[ProfileInfo]:
    """
    Lista perfiles de DICloak evaluando JS en su renderer.
    Extrae la lista de perfiles de la tabla de la UI.
    """
    js = """(() => {
        try {
            const rows = document.querySelectorAll('.el-table__row');
            const profiles = [];
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td .cell'));
                // Celda 0=checkbox, 1=serial, 2=nombre, 3=grupo, ...
                const serial = (cells[1]?.innerText || '').trim();
                const name = (cells[2]?.innerText || '').trim();
                const group = (cells[3]?.innerText || '').trim();
                if (name && name.length > 1) {
                    profiles.push({ id: serial, name, status: group });
                }
            });
            return JSON.stringify(profiles);
        } catch(e) {
            return JSON.stringify({error: e.message});
        }
    })()"""

    result = cdp_evaluate_sync(js, port)
    if not result:
        return []

    try:
        items = json.loads(result)
        return [ProfileInfo(id=p.get("id", ""), name=p["name"], status=p.get("status", "")) for p in items if p.get("name")]
    except Exception:
        return []


def inject_cdp_hook(port: int = DEFAULT_DICLOAK_PORT) -> bool:
    """Inyecta el hook que fuerza canIuseCdp=true al abrir perfiles."""
    hook_js = r"""(() => {
        if (window.__CDP_HOOK_INSTALLED__) return 'ALREADY_INSTALLED';
        window.__CDP_HOOK_INSTALLED__ = true;

        const { ipcRenderer } = require('electron');

        const _origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
        ipcRenderer.invoke = function(channel, ...args) {
            for (const arg of args) {
                if (arg && typeof arg === 'object') {
                    const force = (o) => {
                        if (!o || typeof o !== 'object') return;
                        if ('canIuseCdp' in o) o.canIuseCdp = true;
                        if (o.openParams && 'canIuseCdp' in o.openParams) o.openParams.canIuseCdp = true;
                        Object.values(o).forEach(v => { if (v && typeof v === 'object' && v !== o) force(v); });
                    };
                    force(arg);
                }
            }
            return _origInvoke(channel, ...args);
        };

        const _origSend = ipcRenderer.send.bind(ipcRenderer);
        ipcRenderer.send = function(channel, ...args) {
            for (const arg of args) {
                if (arg && typeof arg === 'object') {
                    const force = (o) => {
                        if (!o || typeof o !== 'object') return;
                        if ('canIuseCdp' in o) o.canIuseCdp = true;
                        Object.values(o).forEach(v => { if (v && typeof v === 'object' && v !== o) force(v); });
                    };
                    force(arg);
                }
            }
            return _origSend(channel, ...args);
        };

        return 'HOOK_INSTALLED';
    })()"""

    result = cdp_evaluate_sync(hook_js, port)
    return result is not None and "INSTALLED" in str(result).upper()


def open_profile_via_cdp(profile_name: str, port: int = DEFAULT_DICLOAK_PORT) -> bool:
    """
    Abre un perfil en DICloak buscándolo por nombre y haciendo click.
    Primero inyecta el hook CDP para que ginsbrowser abra con debug port.
    """
    # Inyectar hook primero
    hook_ok = inject_cdp_hook(port)
    if hook_ok:
        log_ok("Hook CDP inyectado")
    else:
        log_warn("No se pudo inyectar hook CDP — el perfil puede abrir sin debug port")

    # Buscar perfil y hacer click en "Abrir"
    js = """(profileName) => {
        try {
            // Limpiar búsqueda
            const searchInputs = document.querySelectorAll('input[type="text"], input[placeholder*="search"], input[placeholder*="buscar"], input[placeholder*="Search"]');
            for (const input of searchInputs) {
                const rect = input.getBoundingClientRect();
                if (rect.width > 100 && rect.y < 200) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.value = profileName;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }

            // Esperar un poco y buscar botón abrir
            return 'SEARCH_INJECTED';
        } catch(e) {
            return 'ERROR: ' + e.message;
        }
    }"""

    search_result = cdp_evaluate_sync(f"({js})('{profile_name}')", port, timeout=5)
    if not search_result or "ERROR" in str(search_result):
        log_warn(f"No se pudo buscar perfil: {search_result}")
        return False

    # Esperar que la búsqueda filtre y hacer click en "Abrir"
    time.sleep(1.5)

    click_js = """(() => {
        try {
            const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
            const openBtn = buttons.find(b => {
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                return text === 'abrir' || text === 'open' || text === 'launch';
            });
            if (openBtn) {
                openBtn.click();
                return 'CLICKED';
            }

            // Fallback: buscar en la primera fila de la tabla
            const firstRow = document.querySelector('tr[class*="env"], tr[data-row-key], .env-list-item');
            if (firstRow) {
                const btn = firstRow.querySelector('button, [role="button"]');
                if (btn) {
                    btn.click();
                    return 'CLICKED_ROW_BTN';
                }
            }

            return 'NO_BUTTON_FOUND';
        } catch(e) {
            return 'ERROR: ' + e.message;
        }
    })()"""

    click_result = cdp_evaluate_sync(click_js, port, timeout=5)
    if click_result and "CLICKED" in str(click_result):
        log_ok(f"Perfil '{profile_name}' — botón abrir clickeado")
        return True

    log_warn(f"No se encontró botón para abrir perfil: {click_result}")
    return False


def detect_ginsbrowser_port(timeout_sec: int = 60) -> int:
    """
    Detecta el puerto CDP dinámico de ginsbrowser después de abrir un perfil.
    Busca en la lista de procesos del sistema.
    """
    from core.cfg.platform import get_process_list, get_browser_process_name

    browser_name = get_browser_process_name().lower()
    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        procs = get_process_list()
        for p in procs:
            name = str(p.get("name", "")).lower()
            cmd = str(p.get("cmdline", ""))

            if name != browser_name and "ginsbrowser" not in cmd.lower():
                continue
            if "--type=" in cmd:
                continue

            m = re.search(r"--remote-debugging-port[=\s](\d{2,5})", cmd)
            if m:
                port = int(m.group(1))
                if _test_cdp_port(port):
                    return port

        time.sleep(1)

    return 0
