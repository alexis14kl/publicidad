"""
Video Setup — Abre Google Flow (Veo 3) en el browser via CDP y pega el prompt de video.

Flujo:
1. Conectar via Playwright CDP al puerto del perfil
2. Abrir tab de debug /json
3. Buscar pestaña de Flow o navegar a labs.google/fx/es/tools/flow
4. Click en "Nuevo proyecto"
5. Pegar el prompt en el contenteditable
6. Click en "Crear" para generar el video
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Browser

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error

FLOW_URL = "https://labs.google/fx/es/tools/flow"
PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_CDP_PORT = 9225


def read_prompt() -> str:
    """Lee el prompt desde prontm.txt."""
    if not PROMPT_FILE.exists():
        raise FileNotFoundError(f"No existe {PROMPT_FILE}")
    text = PROMPT_FILE.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("prontm.txt esta vacio")
    return text


def _find_flow_page(browser: Browser) -> Page | None:
    """Busca una pestaña de Flow ya abierta (lista de proyectos)."""
    for context in browser.contexts:
        for page in context.pages:
            url = (page.url or "").lower()
            if "labs.google/fx" in url and "accounts.google" not in url:
                return page
    return None


def _open_flow_page(browser: Browser) -> Page:
    """Abre una nueva pestaña con Flow."""
    context = browser.contexts[0]
    page = context.new_page()
    log_info(f"Navegando a {FLOW_URL} ...")
    page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    return page


def _is_project_view(page: Page) -> bool:
    """Verifica si estamos dentro de un proyecto (no en la lista)."""
    return "/project/" in (page.url or "")


def _poll_page_ready(page: Page, checks: dict, timeout_sec: int = 30, label: str = "pagina") -> bool:
    """
    Polling generico: espera hasta que TODOS los checks del DOM se cumplan.

    checks es un dict con nombre -> selector CSS o funcion JS.
    Ejemplo: {"contenteditable": "[contenteditable='true']", "boton_crear": "button"}
    """
    log_info(f"Polling DOM de {label} (timeout {timeout_sec}s)...")
    deadline = time.time() + timeout_sec
    attempt = 0

    while time.time() < deadline:
        attempt += 1

        # Verificar que no haya crasheado
        has_error = page.evaluate("() => (document.body.innerText || '').includes('Application error')")
        if has_error:
            log_error(f"{label}: Application error detectado. Pagina crasheada.")
            return False

        # Evaluar todos los checks
        status = page.evaluate("""(checks) => {
            const result = {};
            for (const [name, selector] of Object.entries(checks)) {
                const el = document.querySelector(selector);
                result[name] = !!el && el.offsetParent !== null;
            }
            result._totalElements = document.querySelectorAll('*').length;
            result._buttons = document.querySelectorAll('button').length;
            return result;
        }""", checks)

        total = status.get("_totalElements", 0)
        buttons = status.get("_buttons", 0)
        passed = {k: v for k, v in status.items() if not k.startswith("_") and v}
        pending = {k: v for k, v in status.items() if not k.startswith("_") and not v}

        if attempt % 3 == 1:
            log_info(f"  [{attempt}] DOM: {total} elements, {buttons} buttons | OK: {list(passed.keys())} | Pendiente: {list(pending.keys())}")

        if not pending:
            log_ok(f"{label} cargada: todos los checks pasaron ({total} elements, {buttons} buttons).")
            return True

        page.wait_for_timeout(1000)

    log_error(f"Timeout ({timeout_sec}s) esperando {label}. Pendiente: {list(pending.keys())}")
    return False


def _go_to_flow_list(page: Page) -> bool:
    """Si estamos dentro de un proyecto, volver a la lista y esperar carga."""
    if _is_project_view(page):
        log_info("Estamos dentro de un proyecto. Volviendo a la lista...")
        page.goto(FLOW_URL, wait_until="domcontentloaded", timeout=30000)
        # Polling: esperar que la lista de Flow cargue
        return _poll_page_ready(page, {
            "nuevo_proyecto_btn": "button",
        }, timeout_sec=20, label="lista Flow")
    return True


def _click_new_project(page: Page) -> bool:
    """Espera que la lista cargue, luego click en 'Nuevo proyecto'."""

    # 1. Polling: esperar que la lista de Flow tenga el DOM cargado
    if not _poll_page_ready(page, {
        "botones": "button",
    }, timeout_sec=20, label="lista Flow"):
        return False

    log_info("Lista de Flow cargada. Buscando boton 'Nuevo proyecto'...")

    # 2. Click en "Nuevo proyecto" (puede estar hidden, aparece con hover)
    clicked = page.evaluate("""() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => {
            const text = (b.innerText || b.textContent || '').toLowerCase();
            return text.includes('nuevo proyecto') || text.includes('new project');
        });
        if (btn) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.click();
            return true;
        }
        return false;
    }""")

    if not clicked:
        # Fallback: hover en zona FAB inferior derecha
        log_info("Boton no encontrado. Intentando hover en zona FAB...")
        viewport = page.viewport_size
        if viewport:
            page.mouse.move(viewport["width"] - 100, viewport["height"] - 100)
            page.wait_for_timeout(2000)

            clicked = page.evaluate("""() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find(b => {
                    const text = (b.innerText || b.textContent || '').toLowerCase();
                    return text.includes('nuevo proyecto') || text.includes('new project');
                });
                if (btn) { btn.click(); return true; }
                return false;
            }""")

    if not clicked:
        log_error("No se encontro el boton 'Nuevo proyecto'.")
        return False

    log_ok("Click en 'Nuevo proyecto' realizado.")

    # 3. Polling: esperar que la pagina del proyecto cargue completamente
    return _poll_page_ready(page, {
        "contenteditable": "[contenteditable='true']",
        "boton_crear": "button",
    }, timeout_sec=30, label="proyecto nuevo")


def _paste_prompt_in_flow(page: Page, prompt_text: str) -> bool:
    """Pega el prompt en el contenteditable de Flow usando el clipboard (como humano)."""
    log_info("Buscando campo de texto del proyecto...")

    # Buscar el contenteditable del proyecto
    selectors = [
        "div[contenteditable='true']",
        "[contenteditable='true']",
        ".sc-74ba1bc0-5",
    ]

    textarea = None
    for selector in selectors:
        try:
            textarea = page.wait_for_selector(selector, timeout=10000, state="visible")
            if textarea:
                break
        except Exception:
            continue

    if not textarea:
        log_error("No se encontro el campo de texto del proyecto.")
        return False

    log_info("Campo de texto encontrado. Pegando prompt via teclado...")

    # Click para enfocar
    textarea.click()
    page.wait_for_timeout(1000)

    # Seleccionar todo y borrar contenido previo
    modifier = "Meta" if sys.platform == "darwin" else "Control"
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(300)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    # Escribir con keyboard.type() — simula tecleo real, lento pero seguro
    # Para textos largos, usar clipboard (Ctrl+V)
    page.evaluate("(text) => navigator.clipboard.writeText(text)", prompt_text)
    page.wait_for_timeout(300)
    page.keyboard.press(f"{modifier}+v")
    page.wait_for_timeout(2000)

    # Verificar que el texto se pego
    pasted = page.evaluate("""() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (!el) return '';
        return (el.innerText || '').trim().slice(0, 50);
    }""")

    if pasted and len(pasted) > 5:
        log_ok(f"Prompt pegado en Flow ({len(pasted)}+ chars).")
        return True

    # Fallback: si clipboard no funciono, usar keyboard.type (mas lento)
    log_warn("Clipboard no funciono. Usando keyboard.type (puede tardar)...")
    textarea.click()
    page.wait_for_timeout(500)
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)

    # Escribir caracter por caracter (truncar a 500 chars max para velocidad)
    truncated = prompt_text[:500]
    page.keyboard.type(truncated, delay=10)
    page.wait_for_timeout(1000)

    log_ok(f"Prompt escrito via teclado ({len(truncated)} chars).")
    return True


def _click_create(page: Page, max_retries: int = 5) -> bool:
    """Click en el boton 'Crear' (arrow_forward) con click real de Playwright."""
    log_info("Buscando boton 'Crear' (arrow_forward)...")

    for attempt in range(max_retries):
        # Obtener posicion del boton arrow_forward Crear
        btn_info = page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => {
                const text = (b.innerText || '').toLowerCase();
                return text.includes('arrow_forward') && text.includes('crear');
            });
            if (btn && btn.offsetParent !== null) {
                const rect = btn.getBoundingClientRect();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
            }
            return { found: false };
        }""")

        if btn_info.get("found"):
            # Click real con Playwright en el centro del boton
            cx = btn_info["x"] + btn_info["w"] / 2
            cy = btn_info["y"] + btn_info["h"] / 2
            log_info(f"Boton encontrado en ({cx:.0f}, {cy:.0f}). Haciendo click real...")
            page.mouse.click(cx, cy)
            page.wait_for_timeout(2000)
            log_ok("Click en 'Crear' realizado (mouse.click).")
            return True

        if attempt < max_retries - 1:
            log_info(f"Boton 'Crear' no encontrado. Reintento {attempt + 2}/{max_retries} en 3s...")
            page.wait_for_timeout(3000)

    log_error("No se encontro el boton 'Crear' despues de todos los reintentos.")
    return False


def _wait_for_session_ready(page: Page, timeout_sec: int = 30) -> bool:
    """Espera a que Flow este listo (no login wall)."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        url = (page.url or "").lower()
        if "accounts.google.com" in url:
            log_error("Flow requiere login. El perfil DiCloak debe tener sesion activa de Google.")
            return False
        if "labs.google/fx" in url:
            # Cerrar dialogo de bienvenida si existe
            try:
                dismiss = page.query_selector("button:has-text('Got it'), button:has-text('Entendido'), button:has-text('Aceptar')")
                if dismiss:
                    dismiss.click()
                    page.wait_for_timeout(1000)
            except Exception:
                pass
            return True
        page.wait_for_timeout(1000)
    log_error("Timeout esperando que Flow cargue.")
    return False


def _open_debug_tab(browser: Browser, cdp_port: int) -> None:
    """Abre un tab con http://127.0.0.1:{port}/json para inspeccionar el debug."""
    debug_url = f"http://127.0.0.1:{cdp_port}/json"
    try:
        context = browser.contexts[0]
        for page in context.pages:
            if f"127.0.0.1:{cdp_port}/json" in (page.url or ""):
                log_info(f"Tab de debug ya abierto: {debug_url}")
                return

        debug_page = context.new_page()
        debug_page.goto(debug_url, wait_until="domcontentloaded", timeout=10000)
        log_ok(f"Tab de debug abierto: {debug_url}")
    except Exception as e:
        log_warn(f"No se pudo abrir tab de debug: {e}")


def run_video_setup(cdp_port: int = DEFAULT_CDP_PORT) -> int:
    """
    Conecta al browser via CDP, abre Flow, crea nuevo proyecto y pega el prompt.
    Returns 0 on success, 1 on failure.
    """
    prompt_text = read_prompt()
    log_info(f"Prompt leido ({len(prompt_text)} chars). Conectando a CDP en puerto {cdp_port}...")

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        except Exception as e:
            log_error(f"No se pudo conectar a CDP en puerto {cdp_port}: {e}")
            return 1

        try:
            # Abrir tab de debug /json
            _open_debug_tab(browser, cdp_port)

            # Buscar pestaña de Flow existente o abrir nueva
            page = _find_flow_page(browser)
            if page:
                log_info(f"Pestaña de Flow encontrada: {page.url}")
                page.bring_to_front()
            else:
                log_info("No hay pestaña de Flow. Abriendo nueva...")
                page = _open_flow_page(browser)

            # Esperar a que la sesion este lista
            if not _wait_for_session_ready(page):
                return 1

            # Si estamos dentro de un proyecto viejo, volver a la lista
            if not _go_to_flow_list(page):
                return 1

            # Click en "Nuevo proyecto" + polling hasta que cargue
            if not _click_new_project(page):
                return 1

            # Refrescar referencia: buscar la pestaña que tiene /project/ en la URL
            # (puede ser la misma page si navigó, o una nueva)
            project_page = page
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    url = pg.url or ""
                    if "/project/" in url and "/edit/" not in url:
                        # Verificar que tiene botones (no crasheada)
                        btn_count = pg.evaluate("() => document.querySelectorAll('button').length")
                        if btn_count > 5:
                            project_page = pg
                            break

            project_page.bring_to_front()
            page.wait_for_timeout(1000)
            log_ok(f"Proyecto nuevo listo: {project_page.url}")

            # Pegar prompt
            if not _paste_prompt_in_flow(project_page, prompt_text):
                return 1

            # Esperar a que Flow procese el prompt y active el boton Crear
            project_page.wait_for_timeout(3000)

            # Click en "Crear" para generar el video
            if not _click_create(project_page):
                return 1

            print("PROMPT_SENT=OK")
            log_ok("Video en proceso de generacion en Flow (Veo 3).")
            return 0

        except Exception as e:
            log_error(f"Error en video_setup: {e}")
            return 1
        finally:
            browser.close()


def main() -> int:
    cdp_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CDP_PORT
    env_port = os.environ.get("CDP_PROFILE_PORT")
    if env_port:
        cdp_port = int(env_port)
    return run_video_setup(cdp_port=cdp_port)


if __name__ == "__main__":
    raise SystemExit(main())
