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

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.cfg.platform import PROMPT_FILE
from core.utils.logger import log_info, log_ok, log_warn, log_error

FLOW_URL = "https://labs.google/fx/tools/flow"
DEFAULT_CDP_PORT = 9225


def read_prompt() -> str:
    """Lee el prompt activo desde env o prontm.txt."""
    env_prompt = str(os.environ.get("BOT_VIDEO_ACTIVE_SCENE_PROMPT", "") or "").strip()
    if env_prompt:
        return env_prompt
    if not PROMPT_FILE.exists():
        raise FileNotFoundError(f"No existe {PROMPT_FILE}")
    text = PROMPT_FILE.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("prontm.txt esta vacio")
    return text


def _normalize_prompt_text(value: str) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split()).strip()


def _find_flow_page(browser: Browser) -> Page | None:
    """Busca una pestaña de Flow ya abierta (lista de proyectos)."""
    for context in browser.contexts:
        for page in context.pages:
            url = (page.url or "").lower()
            if "labs.google/fx" in url and "accounts.google" not in url:
                return page
    return None


def _find_project_page(browser: Browser) -> Page | None:
    """Busca la pestaña activa del proyecto en Flow."""
    best_page = None
    best_buttons = 0
    for context in browser.contexts:
        for page in context.pages:
            url = page.url or ""
            if "/project/" not in url or "accounts.google" in url:
                continue
            try:
                btn_count = page.evaluate("() => document.querySelectorAll('button').length")
            except Exception:
                continue
            if btn_count > best_buttons:
                best_buttons = btn_count
                best_page = page
    return best_page


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
    """
    Flow UI 2026: la galería muestra proyectos anteriores.
    El campo de prompt puede estar oculto (textarea con width=0).
    Necesitamos: 1) buscar campo visible, 2) si no, click en "+ New project",
    3) si no, click en el textarea oculto para expandirlo, 4) navegar directo.
    """

    if not _poll_page_ready(page, {"botones": "button"}, timeout_sec=20, label="Flow"):
        return False

    log_info("Flow cargada. Buscando campo de prompt...")

    # Scroll al fondo — el prompt box puede estar debajo de la galería
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(2000)

    found = page.evaluate("""() => {
        // Strategy 1: Find visible editable field by placeholder text
        const allInputs = document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
        for (const el of allInputs) {
            if (el.offsetParent === null) continue;
            const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
            if (ph.includes('create') || ph.includes('want') || ph.includes('generar') || ph.includes('quieres') || ph.includes('describe') || ph.includes('prompt')) {
                el.scrollIntoView({block: 'center'});
                el.click();
                el.focus();
                return {found: true, method: 'placeholder', tag: el.tagName, ph: ph.slice(0, 50)};
            }
        }

        // Strategy 2: Find any visible editable field in bottom half of page
        for (const el of allInputs) {
            if (el.offsetParent === null) continue;
            const rect = el.getBoundingClientRect();
            if (rect.bottom > window.innerHeight * 0.5 && rect.width > 100) {
                el.scrollIntoView({block: 'center'});
                el.click();
                el.focus();
                return {found: true, method: 'position', tag: el.tagName, y: rect.y};
            }
        }

        // Strategy 3: Find by role=textbox
        const textboxes = document.querySelectorAll('[role="textbox"], [role="combobox"]');
        for (const el of textboxes) {
            if (el.offsetParent !== null) {
                el.scrollIntoView({block: 'center'});
                el.click();
                el.focus();
                return {found: true, method: 'role', tag: el.tagName};
            }
        }

        // Strategy 4: Click "New project" button — matches text content, not just "+"
        const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
        const newProjectBtn = btns.find(b => {
            const text = (b.innerText || b.textContent || '').trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return text === '+' ||
                   text.includes('new project') || text.includes('nuevo proyecto') ||
                   text.includes('new') && text.length < 20 ||
                   aria.includes('new') || aria.includes('add') || aria.includes('create') ||
                   aria.includes('nuevo') || aria.includes('crear');
        });
        if (newProjectBtn) {
            newProjectBtn.scrollIntoView({block: 'center'});
            newProjectBtn.click();
            return {found: true, method: 'new-project-button', text: (newProjectBtn.innerText || '').slice(0, 30)};
        }

        // Strategy 5: Force-click hidden textarea/input to expand it
        for (const el of allInputs) {
            const rect = el.getBoundingClientRect();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                // Even if hidden (offsetParent null), try to make it visible
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.width = '100%';
                el.style.height = 'auto';
                el.style.opacity = '1';
                el.scrollIntoView({block: 'center'});
                el.click();
                el.focus();
                // Check if it became visible after our intervention
                const newRect = el.getBoundingClientRect();
                if (newRect.width > 50) {
                    return {found: true, method: 'force-expand', tag: el.tagName, w: newRect.width};
                }
            }
        }

        // Debug: list all inputs/editables and buttons found
        const debug = [];
        document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]').forEach(el => {
            debug.push({
                tag: el.tagName,
                type: el.getAttribute('type') || '',
                ph: (el.getAttribute('placeholder') || '').slice(0, 40),
                ce: el.getAttribute('contenteditable') || '',
                role: el.getAttribute('role') || '',
                visible: el.offsetParent !== null,
                w: el.getBoundingClientRect().width,
            });
        });
        const btnDebug = [];
        document.querySelectorAll('button, [role="button"], a').forEach(b => {
            const text = (b.innerText || '').trim();
            if (text && text.length < 40) btnDebug.push(text);
        });
        return {found: false, debug: debug, buttons: btnDebug.slice(0, 15)};
    }""")

    if found and found.get("found"):
        method = found.get("method")
        log_ok(f"Campo de prompt encontrado ({method}, {found.get('tag', found.get('text', '?'))}). Listo para pegar.")
        if method in ("new-project-button", "plus-button"):
            log_info("Esperando que se abra el editor de nuevo proyecto...")
            page.wait_for_timeout(4000)
            # After clicking new project, wait for the prompt field to appear
            _wait_for_visible_prompt_field(page, timeout_sec=15)
        elif method == "force-expand":
            page.wait_for_timeout(2000)
        return True

    # Strategy 6 (last resort): navigate directly to new project URL
    log_warn("No se encontro campo de prompt en la galeria. Intentando navegar directamente...")
    debug = found.get("debug", []) if found else []
    buttons = found.get("buttons", []) if found else []
    log_info(f"  Inputs detectados: {debug}")
    log_info(f"  Botones detectados: {buttons}")

    try:
        page.goto("https://labs.google/fx/tools/video-fx", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)
        if _wait_for_visible_prompt_field(page, timeout_sec=20):
            log_ok("Campo de prompt encontrado tras navegar a video-fx.")
            return True
    except Exception as exc:
        log_warn(f"Navegacion a video-fx fallo: {exc}")

    log_error(f"No se encontro campo de prompt en ninguna ruta.")
    return False


def _wait_for_visible_prompt_field(page: Page, timeout_sec: int = 15) -> bool:
    """Espera a que aparezca un campo de texto visible para el prompt."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        visible = page.evaluate("""() => {
            const fields = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
            for (const el of fields) {
                if (el.offsetParent !== null && el.getBoundingClientRect().width > 50) {
                    el.scrollIntoView({block: 'center'});
                    el.click();
                    el.focus();
                    return true;
                }
            }
            return false;
        }""")
        if visible:
            return True
        page.wait_for_timeout(1000)
    return False


def _paste_prompt_in_flow(page: Page, prompt_text: str) -> bool:
    """Pega el prompt en el contenteditable de Flow usando el clipboard (como humano)."""
    log_info("Buscando campo de texto del proyecto...")

    # Flow UI 2026: campo de texto "What do you want to create?"
    # Es un DIV contenteditable con role=textbox (w~564px)
    # IMPORTANTE: priorizar contenteditable/role=textbox sobre input/textarea
    # porque input[type=text] puede ser el campo de fecha (w~151px)
    selectors_priority = [
        "[role='textbox']",
        "[contenteditable='true']",
        "[contenteditable='plaintext-only']",
        "[placeholder*='create']",
        "[placeholder*='want']",
        "[data-placeholder]",
        "textarea",
        "[role='combobox']",
    ]

    textarea = None
    for selector in selectors_priority:
        try:
            textarea = page.wait_for_selector(selector, timeout=8000, state="visible")
            if textarea:
                # Verify this is a wide enough field to be the prompt (not a date/title field)
                box = textarea.bounding_box()
                if box and box.get("width", 0) > 200:
                    break
                # If too narrow, keep looking
                log_info(f"  Campo {selector} demasiado estrecho ({box.get('width', 0) if box else 0}px), buscando otro...")
                textarea = None
                continue
        except Exception:
            continue

    if not textarea:
        # Fallback: try any wide visible editable field via JS
        textarea_js = page.evaluate("""() => {
            const candidates = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea'));
            for (const el of candidates) {
                if (el.offsetParent !== null && el.getBoundingClientRect().width > 200) {
                    el.scrollIntoView({block: 'center'});
                    el.click();
                    el.focus();
                    return true;
                }
            }
            return false;
        }""")
        if textarea_js:
            # Re-acquire the element
            for sel in ["[role='textbox']", "[contenteditable='true']"]:
                try:
                    textarea = page.wait_for_selector(sel, timeout=3000, state="visible")
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

    # Verificar que el texto se pego de verdad
    pasted = page.evaluate("""() => {
        // Check textarea/input first (new UI)
        const textarea = document.querySelector('textarea, input[type="text"]');
        if (textarea && textarea.value) return textarea.value.trim();
        // Check contenteditable (old UI)
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const el = candidates.find((item) => item.offsetParent !== null) || candidates[0];
        if (!el) return '';
        return (el.innerText || el.textContent || '').trim();
    }""")
    normalized_expected = _normalize_prompt_text(prompt_text)
    normalized_pasted = _normalize_prompt_text(pasted)

    if normalized_pasted == normalized_expected:
        log_ok(f"Prompt pegado en Flow ({len(normalized_pasted)} chars verificados).")
        return True

    # Fallback: si clipboard no funciono, usar insercion de texto sin generar Enter.
    log_warn("Clipboard no pego el prompt esperado. Usando insercion asistida sin teclas de envio...")
    textarea.click()
    page.wait_for_timeout(500)
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)

    page.keyboard.insert_text(prompt_text)
    page.wait_for_timeout(1000)

    typed = page.evaluate("""() => {
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const el = candidates.find((item) => item.offsetParent !== null) || candidates[0];
        if (!el) return '';
        return (el.innerText || el.textContent || '').trim();
    }""")
    normalized_typed = _normalize_prompt_text(typed)

    if normalized_typed == normalized_expected:
        log_ok(f"Prompt escrito y verificado en Flow ({len(normalized_typed)} chars).")
        return True

    # Ultimo recurso: forzar contenido por DOM y disparar eventos de input.
    log_warn("La insercion asistida no dejo el prompt exacto. Forzando contenido por DOM...")
    dom_written = page.evaluate("""(text) => {
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const el = candidates.find((item) => item.offsetParent !== null) || candidates[0];
        if (!el) return '';
        el.focus();
        el.innerHTML = '';
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return (el.innerText || el.textContent || '').trim();
    }""", prompt_text)
    normalized_dom_written = _normalize_prompt_text(dom_written)

    if normalized_dom_written == normalized_expected:
        log_ok(f"Prompt forzado y verificado en Flow ({len(normalized_dom_written)} chars).")
        return True

    log_error("No pude confirmar que Flow tenga pegado exactamente el prompt esperado.")
    return False


def _focus_followup_prompt(page: Page) -> bool:
    """Enfoca la casilla de continuacion '¿Que pasa despues?'."""
    return bool(page.evaluate("""() => {
        const normalize = (value) => String(value || '').toLowerCase();
        const promptNeedle = 'que pasa despues';
        const editableSelector = '[contenteditable="true"], textarea, [role="textbox"]';
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 120 && rect.height > 24;
        };
        const isPotentialFollowupEditable = (el) => {
            if (!isVisible(el)) return false;
            const rect = el.getBoundingClientRect();
            return (
                rect.top > window.innerHeight * 0.38 &&
                rect.width > window.innerWidth * 0.18 &&
                rect.left < window.innerWidth * 0.92
            );
        };
        const normalizeSpanish = (value) => normalize(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
        const getNearbyText = (el) => {
            const parts = [];
            let node = el;
            let depth = 0;
            while (node && depth < 4) {
                parts.push(node.innerText || node.textContent || '');
                node = node.parentElement;
                depth += 1;
            }
            return normalizeSpanish(parts.join(' '));
        };
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter(isVisible);
        const controls = visibleButtons.filter((btn) => {
            const text = normalizeSpanish(btn.innerText || btn.textContent || '');
            return (
                text.includes('ampliar') ||
                text.includes('insertar') ||
                text.includes('eliminar') ||
                text.includes('camara') ||
                text.includes('camara')
            );
        });
        const controlTop = controls.length
            ? Math.min(...controls.map((btn) => btn.getBoundingClientRect().top))
            : null;
        const modelButtons = visibleButtons.filter((btn) => {
            const text = normalizeSpanish(btn.innerText || btn.textContent || '');
            return text.includes('veo');
        });

        const focusAndTag = (node) => {
            if (!node || !isPotentialFollowupEditable(node)) return false;
            node.focus?.();
            if (typeof node.click === 'function') node.click();
            node.setAttribute('data-codex-followup', '1');
            return true;
        };
        const findEditableNearLabel = (labelNode) => {
            if (!labelNode) return null;
            const visited = new Set();
            const containers = [];
            let node = labelNode;
            let depth = 0;
            while (node && depth < 6) {
                if (!visited.has(node)) {
                    visited.add(node);
                    containers.push(node);
                }
                node = node.parentElement;
                depth += 1;
            }
            for (const container of containers) {
                const direct = container.matches?.(editableSelector) ? container : null;
                if (direct && isPotentialFollowupEditable(direct)) return direct;
                const nested = Array.from(container.querySelectorAll?.(editableSelector) || []).find(isPotentialFollowupEditable);
                if (nested) return nested;
            }
            const siblingEditable = Array.from(
                labelNode.parentElement?.querySelectorAll?.(editableSelector) || []
            ).find(isPotentialFollowupEditable);
            return siblingEditable || null;
        };
        const labelCandidates = Array.from(document.querySelectorAll('div, section, form, label, span, p, h1, h2, h3, h4'))
            .filter(isVisible)
            .map((el) => {
                const text = normalizeSpanish(el.innerText || el.textContent || '');
                if (!text.includes(promptNeedle)) return null;
                const rect = el.getBoundingClientRect();
                const area = rect.width * rect.height;
                return { el, area, top: rect.top };
            })
            .filter(Boolean)
            .sort((a, b) => a.area - b.area || a.top - b.top);

        const existingTagged = document.querySelector('[data-codex-followup="1"]');
        if (existingTagged) {
            if (focusAndTag(existingTagged)) return true;
            const existingNested = existingTagged.matches?.(editableSelector)
                ? existingTagged
                : existingTagged.querySelector?.(editableSelector);
            if (focusAndTag(existingNested)) return true;
        }

        const active = document.activeElement;
        if (active && active.matches?.(editableSelector) && focusAndTag(active)) {
            return true;
        }

        for (const label of labelCandidates) {
            const editable = findEditableNearLabel(label.el);
            if (focusAndTag(editable)) return true;
            label.el.click?.();
            label.el.focus?.();
            const afterClickActive = document.activeElement;
            if (afterClickActive && afterClickActive.matches?.(editableSelector) && focusAndTag(afterClickActive)) {
                return true;
            }
            const afterClickEditable = findEditableNearLabel(label.el);
            if (focusAndTag(afterClickEditable)) return true;
        }

        document.querySelectorAll('[data-codex-followup="1"]').forEach((el) => el.removeAttribute('data-codex-followup'));
        const candidates = Array.from(document.querySelectorAll(editableSelector)).filter(isPotentialFollowupEditable);
        const scored = candidates.map((el) => {
            const rect = el.getBoundingClientRect();
            const nearby = getNearbyText(el);
            const attrs = normalizeSpanish(
                el.getAttribute('placeholder') ||
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-placeholder') ||
                ''
            );
            let score = rect.width * rect.height;
            if (rect.top > window.innerHeight * 0.45) score += 100000;
            if (rect.width > window.innerWidth * 0.35) score += 30000;
            if (nearby.includes(promptNeedle)) score += 500000;
            if (attrs.includes(promptNeedle)) score += 500000;
            if (nearby.includes('ampliar')) score += 20000;
            if (nearby.includes('insertar')) score += 20000;
            if (nearby.includes('eliminar')) score += 20000;
            if (nearby.includes('camara')) score += 20000;
            if (nearby.includes('veo 3.1')) score += 30000;
            if (nearby.includes('fast')) score += 15000;
            if (controlTop !== null) {
                const distance = controlTop - rect.bottom;
                if (distance >= -20 && distance <= 220) score += 120000 - Math.max(0, distance) * 400;
            }
            const hasModelOnRight = modelButtons.some((btn) => {
                const b = btn.getBoundingClientRect();
                return b.left >= rect.right - 40 && Math.abs((b.top + b.height / 2) - (rect.top + rect.height / 2)) < 90;
            });
            if (hasModelOnRight) score += 90000;
            return { el, score };
        }).sort((a, b) => b.score - a.score);
        const target = scored[0]?.el;
        if (target) {
            target.focus();
            if (typeof target.click === 'function') target.click();
            const focusedTarget = document.activeElement;
            const finalTarget = (focusedTarget && (
                focusedTarget.matches?.(editableSelector) && isPotentialFollowupEditable(focusedTarget)
            )) ? focusedTarget : target;
            finalTarget.setAttribute('data-codex-followup', '1');
            return true;
        }

        const shellNodes = Array.from(document.querySelectorAll('div, section, form, label, span, p')).filter((el) => {
            if (!isVisible(el)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.top <= window.innerHeight * 0.45) return false;
            const ownText = normalizeSpanish(el.innerText || el.textContent || '');
            const attrs = normalizeSpanish(
                el.getAttribute('placeholder') ||
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-placeholder') ||
                ''
            );
            return ownText.includes(promptNeedle) || attrs.includes(promptNeedle);
        });
        const shell = shellNodes.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        })[0];
        if (!shell) return false;
        const shellRect = shell.getBoundingClientRect();
        const clickX = shellRect.left + Math.min(shellRect.width * 0.6, 140);
        const clickY = shellRect.top + shellRect.height / 2;
        const hit = document.elementFromPoint(clickX, clickY) || shell;
        if (typeof hit.click === 'function') hit.click();
        hit.focus?.();
        const active = document.activeElement;
        if (active && active.matches?.(editableSelector) && isPotentialFollowupEditable(active)) {
            active.setAttribute('data-codex-followup', '1');
            return true;
        }
        const nested = hit.querySelector?.(editableSelector)
            || shell.parentElement?.querySelector?.(editableSelector);
        if (nested && isPotentialFollowupEditable(nested)) {
            nested.focus?.();
            nested.setAttribute('data-codex-followup', '1');
            return true;
        }
        return false;
    }"""))


def _read_followup_prompt_text(page: Page) -> str:
    return page.evaluate("""() => {
        const target = document.querySelector('[data-codex-followup="1"]');
        if (!target) return '';
        if ('value' in target) return (target.value || '').trim();
        return (target.innerText || target.textContent || '').trim();
    }""")


def _activate_followup_prompt_shell(page: Page, scene_index: int) -> bool:
    """Hace click en la superficie inferior de '¿Que pasa despues?' para forzar que aparezca el campo editable."""
    box = page.evaluate("""() => {
        const normalize = (value) => String(value || '').toLowerCase();
        const normalizeSpanish = (value) => normalize(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
        const promptNeedle = 'que pasa despues';
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 160 && rect.height > 36;
        };
        const getNearbyText = (el) => {
            const parts = [];
            let node = el;
            let depth = 0;
            while (node && depth < 4) {
                parts.push(node.innerText || node.textContent || '');
                node = node.parentElement;
                depth += 1;
            }
            return normalizeSpanish(parts.join(' '));
        };
        const visibleButtons = Array.from(document.querySelectorAll('button')).filter(isVisible);
        const controls = visibleButtons.filter((btn) => {
            const text = normalizeSpanish(btn.innerText || btn.textContent || '');
            return (
                text.includes('ampliar') ||
                text.includes('insertar') ||
                text.includes('eliminar') ||
                text.includes('camara') ||
                text.includes('camara')
            );
        });
        const controlTop = controls.length
            ? Math.min(...controls.map((btn) => btn.getBoundingClientRect().top))
            : null;
        const modelButtons = visibleButtons.filter((btn) => {
            const text = normalizeSpanish(btn.innerText || btn.textContent || '');
            return text.includes('veo');
        });
        const placeholderCandidates = Array.from(document.querySelectorAll('div, section, form, label, span, p')).filter((el) => {
            if (!isVisible(el)) return false;
            const rect = el.getBoundingClientRect();
            if (rect.top <= window.innerHeight * 0.45) return false;
            const ownText = normalizeSpanish(el.innerText || el.textContent || '');
            const attrs = normalizeSpanish(
                el.getAttribute('placeholder') ||
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-placeholder') ||
                ''
            );
            return ownText.includes(promptNeedle) || attrs.includes(promptNeedle);
        });
        const anchor = placeholderCandidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        })[0];
        if (anchor) {
            const anchorRect = anchor.getBoundingClientRect();
            return {
                x: anchorRect.x,
                y: anchorRect.y,
                w: anchorRect.width,
                h: anchorRect.height,
                clickX: anchorRect.left + Math.min(anchorRect.width * 0.65, 180),
                clickY: anchorRect.top + anchorRect.height / 2,
                score: 999999,
            };
        }
        const candidates = Array.from(document.querySelectorAll('div, section, form, label')).filter(isVisible);
        const best = candidates.map((el) => {
            const rect = el.getBoundingClientRect();
            const nearby = getNearbyText(el);
            let score = rect.width * rect.height;
            if (rect.top > window.innerHeight * 0.45) score += 80000;
            if (rect.width > window.innerWidth * 0.35) score += 60000;
            if (nearby.includes(promptNeedle)) score += 500000;
            if (nearby.includes('ampliar')) score += 15000;
            if (nearby.includes('insertar')) score += 15000;
            if (nearby.includes('eliminar')) score += 15000;
            if (nearby.includes('camara')) score += 15000;
            if (nearby.includes('veo')) score += 20000;
            if (anchorRect) {
                const containsAnchor = (
                    rect.left <= anchorRect.left + 8 &&
                    rect.right >= anchorRect.right - 8 &&
                    rect.top <= anchorRect.top + 8 &&
                    rect.bottom >= anchorRect.bottom - 8
                );
                if (containsAnchor) score += 350000;
                score -= Math.abs(rect.left - anchorRect.left) * 5;
                score -= Math.abs(rect.top - anchorRect.top) * 5;
            }
            if (controlTop !== null) {
                const distance = controlTop - rect.bottom;
                if (distance >= -10 && distance <= 220) score += 100000 - Math.max(0, distance) * 350;
            }
            const hasModelOnRight = modelButtons.some((btn) => {
                const b = btn.getBoundingClientRect();
                return b.left >= rect.right - 60 && Math.abs((b.top + b.height / 2) - (rect.top + rect.height / 2)) < 110;
            });
            if (hasModelOnRight) score += 90000;
            return {
                x: rect.x,
                y: rect.y,
                w: rect.width,
                h: rect.height,
                clickX: rect.x + Math.min(rect.width * 0.22, 140),
                clickY: rect.y + rect.height / 2,
                score,
            };
        }).sort((a, b) => b.score - a.score)[0];
        if (!best || best.score < 120000) return null;
        return best;
    }""")
    if not box:
        return False
    cx = box.get("clickX") or (box["x"] + box["w"] / 2)
    cy = box.get("clickY") or (box["y"] + box["h"] / 2)
    log_info(f"Activando la superficie de continuacion en ({cx:.0f}, {cy:.0f}) para la escena {scene_index}...")
    page.mouse.click(cx, cy)
    page.wait_for_timeout(800)
    tagged = page.evaluate("""({ clickX, clickY }) => {
        const selector = '[contenteditable="true"], textarea, [role="textbox"]';
        const isPotentialFollowupEditable = (el) => {
            if (!el || !el.offsetParent) return false;
            const rect = el.getBoundingClientRect();
            return (
                rect.width > window.innerWidth * 0.25 &&
                rect.height > 24 &&
                rect.top > window.innerHeight * 0.45 &&
                rect.left < window.innerWidth * 0.82
            );
        };
        document.querySelectorAll('[data-codex-followup="1"]').forEach((el) => el.removeAttribute('data-codex-followup'));
        const active = document.activeElement;
        if (active && active.matches?.(selector) && isPotentialFollowupEditable(active)) {
            active.setAttribute('data-codex-followup', '1');
            return true;
        }
        const hit = document.elementFromPoint(clickX, clickY);
        const seen = new Set();
        const queue = [];
        if (hit) {
            queue.push(hit);
            let parent = hit.parentElement;
            let depth = 0;
            while (parent && depth < 5) {
                queue.push(parent);
                parent = parent.parentElement;
                depth += 1;
            }
        }
        while (queue.length) {
            const node = queue.shift();
            if (!node || seen.has(node)) continue;
            seen.add(node);
            if (node.matches?.(selector) && isPotentialFollowupEditable(node)) {
                node.focus?.();
                node.setAttribute('data-codex-followup', '1');
                return true;
            }
            const nested = node.querySelector?.(selector);
            if (nested && isPotentialFollowupEditable(nested)) {
                nested.focus?.();
                nested.setAttribute('data-codex-followup', '1');
                return true;
            }
        }
        return false;
    }""", {"clickX": cx, "clickY": cy})
    page.wait_for_timeout(700)
    return bool(tagged)


def _paste_followup_prompt_in_flow(page: Page, prompt_text: str, scene_index: int) -> bool:
    """Pega el prompt de continuacion en la casilla '¿Que pasa despues?'."""
    focused = False
    for attempt in range(3):
        if _focus_followup_prompt(page):
            focused = True
            break
        if not _activate_followup_prompt_shell(page, scene_index):
            page.wait_for_timeout(1000)
            continue
        if _ensure_followup_ready(page, scene_index, timeout_sec=5, log_wait=False) and _focus_followup_prompt(page):
            focused = True
            break
    if not focused:
        log_error(f"No se encontro la casilla 'Que pasa despues?' para la escena {scene_index}.")
        return False

    log_info(f"Casilla de continuacion encontrada para la escena {scene_index}. Pegando prompt...")
    modifier = "Meta" if sys.platform == "darwin" else "Control"
    page.wait_for_timeout(500)
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(300)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    page.evaluate("(text) => navigator.clipboard.writeText(text)", prompt_text)
    page.wait_for_timeout(300)
    page.keyboard.press(f"{modifier}+v")
    page.wait_for_timeout(2000)

    normalized_expected = _normalize_prompt_text(prompt_text)
    normalized_pasted = _normalize_prompt_text(_read_followup_prompt_text(page))
    if normalized_pasted == normalized_expected:
        log_ok(f"Prompt de continuacion de la escena {scene_index} pegado y verificado ({len(normalized_pasted)} chars).")
        return True

    log_warn("Clipboard no dejo el prompt esperado en la casilla de continuacion. Usando insercion asistida...")
    if not _focus_followup_prompt(page):
        return False
    page.wait_for_timeout(400)
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)
    page.keyboard.insert_text(prompt_text)
    page.wait_for_timeout(1000)

    normalized_inserted = _normalize_prompt_text(_read_followup_prompt_text(page))
    if normalized_inserted == normalized_expected:
        log_ok(f"Prompt de continuacion de la escena {scene_index} insertado y verificado ({len(normalized_inserted)} chars).")
        return True

    log_warn("La insercion asistida no dejo el prompt exacto en la continuacion. Forzando contenido por DOM...")
    dom_written = page.evaluate("""(text) => {
        const target = document.querySelector('[data-codex-followup="1"]');
        if (!target) return '';
        target.focus();
        if ('value' in target) {
            target.value = text;
        } else {
            target.innerHTML = '';
            target.textContent = text;
        }
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        if ('value' in target) return (target.value || '').trim();
        return (target.innerText || target.textContent || '').trim();
    }""", prompt_text)
    normalized_dom_written = _normalize_prompt_text(dom_written)
    if normalized_dom_written == normalized_expected:
        log_ok(f"Prompt de continuacion de la escena {scene_index} forzado y verificado ({len(normalized_dom_written)} chars).")
        return True

    log_error(f"No pude confirmar que Flow tenga pegado el prompt de continuacion de la escena {scene_index}.")
    return False


def _ensure_project_editor_ready(page: Page, scene_index: int) -> bool:
    return _poll_page_ready(page, {
        "contenteditable": "[contenteditable='true']",
        "botones": "button",
    }, timeout_sec=30, label=f"editor de la escena {scene_index}")


def _ensure_followup_ready(page: Page, scene_index: int, timeout_sec: int = 45, log_wait: bool = True) -> bool:
    deadline = time.time() + timeout_sec
    if log_wait:
        log_info(f"Esperando la casilla 'Que pasa despues?' para la escena {scene_index}...")
    while time.time() < deadline:
        ready = page.evaluate("""() => {
            const normalize = (value) => String(value || '').toLowerCase();
            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 120 && rect.height > 24;
            };
            const getNearbyText = (el) => {
                const parts = [];
                let node = el;
                let depth = 0;
                while (node && depth < 4) {
                    parts.push(node.innerText || node.textContent || '');
                    node = node.parentElement;
                    depth += 1;
                }
                return normalize(parts.join(' '));
            };
            const visibleButtons = Array.from(document.querySelectorAll('button')).filter(isVisible);
            const controls = visibleButtons.filter((btn) => {
                const text = normalize(btn.innerText || btn.textContent || '');
                return (
                    text.includes('ampliar') ||
                    text.includes('insertar') ||
                    text.includes('eliminar') ||
                    text.includes('camara') ||
                    text.includes('cámara')
                );
            });
            const controlTop = controls.length
                ? Math.min(...controls.map((btn) => btn.getBoundingClientRect().top))
                : null;
            const modelButtons = visibleButtons.filter((btn) => {
                const text = normalize(btn.innerText || btn.textContent || '');
                return text.includes('veo');
            });
            const candidates = Array.from(document.querySelectorAll(
                '[contenteditable="true"], textarea, [role="textbox"]'
            )).filter((el) => {
                if (!isVisible(el)) return false;
                const rect = el.getBoundingClientRect();
                return (
                    rect.top > window.innerHeight * 0.45 &&
                    rect.width > window.innerWidth * 0.25 &&
                    rect.left < window.innerWidth * 0.82
                );
            });
            const best = candidates.map((el) => {
                const rect = el.getBoundingClientRect();
                const nearby = getNearbyText(el);
                const attrs = normalize(
                    el.getAttribute('placeholder') ||
                    el.getAttribute('aria-label') ||
                    el.getAttribute('aria-placeholder') ||
                    ''
                );
                let score = rect.width * rect.height;
                if (rect.top > window.innerHeight * 0.45) score += 100000;
                if (rect.width > window.innerWidth * 0.35) score += 30000;
                if (nearby.includes('que pasa despues') || nearby.includes('qué pasa después')) score += 500000;
                if (attrs.includes('que pasa despues') || attrs.includes('qué pasa después')) score += 500000;
                if (nearby.includes('ampliar')) score += 20000;
                if (nearby.includes('insertar')) score += 20000;
                if (nearby.includes('eliminar')) score += 20000;
                if (nearby.includes('camara') || nearby.includes('cámara')) score += 20000;
                if (nearby.includes('veo 3.1')) score += 30000;
                if (nearby.includes('fast')) score += 15000;
                if (controlTop !== null) {
                    const distance = controlTop - rect.bottom;
                    if (distance >= -20 && distance <= 220) score += 120000 - Math.max(0, distance) * 400;
                }
                const hasModelOnRight = modelButtons.some((btn) => {
                    const b = btn.getBoundingClientRect();
                    return b.left >= rect.right - 40 && Math.abs((b.top + b.height / 2) - (rect.top + rect.height / 2)) < 90;
                });
                if (hasModelOnRight) score += 90000;
                return { el, score };
            }).sort((a, b) => b.score - a.score)[0];
            if (best && best.score >= 140000) {
                best.el.setAttribute('data-codex-followup', '1');
                return true;
            }
            return controls.length > 0 && modelButtons.length > 0;
        }""")
        if ready:
            if log_wait:
                log_ok(f"Casilla de continuacion lista para la escena {scene_index}.")
            return True
        page.wait_for_timeout(1000)
    if log_wait:
        log_error(f"No aparecio la casilla 'Que pasa despues?' para la escena {scene_index}.")
    return False


def _poll_video_view_ready(page: Page, scene_index: int, timeout_sec: int = 12) -> bool:
    """
    Hace un polling corto del DOM despues de abrir el resultado generado.

    Replica la idea de "Nuevo proyecto": primero estabilizar el DOM visible
    del viewer y luego pasar al analisis fino de la casilla de continuacion.
    """
    log_info(f"Polling DOM de la vista del video para la escena {scene_index} (timeout {timeout_sec}s)...")
    deadline = time.time() + timeout_sec
    attempt = 0
    shell_activated = False

    while time.time() < deadline:
        attempt += 1
        status = page.evaluate("""() => {
            const normalize = (value) => String(value || '').toLowerCase();
            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 20 && rect.height > 20;
            };

            const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
            const textboxes = Array.from(document.querySelectorAll(
                '[contenteditable="true"], textarea, [role="textbox"]'
            )).filter((el) => {
                if (!isVisible(el)) return false;
                const rect = el.getBoundingClientRect();
                return (
                    rect.top > window.innerHeight * 0.45 &&
                    rect.width > window.innerWidth * 0.25 &&
                    rect.left < window.innerWidth * 0.82
                );
            });
            const media = Array.from(document.querySelectorAll('video, canvas, img, [role="img"]')).filter((el) => {
                if (!isVisible(el)) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 120 && rect.height > 90;
            });

            const controls = buttons.filter((btn) => {
                const text = normalize(btn.innerText || btn.textContent || '');
                return (
                    text.includes('ampliar') ||
                    text.includes('insertar') ||
                    text.includes('eliminar') ||
                    text.includes('camara') ||
                    text.includes('cámara')
                );
            });

            const modelButtons = buttons.filter((btn) => {
                const text = normalize(btn.innerText || btn.textContent || '');
                return text.includes('veo');
            });

            return {
                totalElements: document.querySelectorAll('*').length,
                buttons: buttons.length,
                media: media.length,
                controls: controls.length,
                textboxes: textboxes.length,
                modelButtons: modelButtons.length,
                ready: media.length > 0 && controls.length > 0 && modelButtons.length > 0 && textboxes.length > 0,
            };
        }""")

        checks = {
            "media": status["media"] > 0,
            "botones": status["buttons"] > 0,
            "controles": status["controls"] > 0,
            "modelo_veo": status["modelButtons"] > 0,
            "textbox": status["textboxes"] > 0,
        }
        passed = [key for key, value in checks.items() if value]
        pending = [key for key, value in checks.items() if not value]

        if attempt % 2 == 1:
            log_info(
                f"  [{attempt}] DOM: {status['totalElements']} elements, {status['buttons']} buttons | "
                f"OK: {passed} | Pendiente: {pending}"
            )

        if status.get("ready"):
            log_ok(f"Vista del video lista para analizar campos en la escena {scene_index}.")
            return True

        if (
            not shell_activated and
            status["media"] > 0 and
            status["controls"] > 0 and
            status["modelButtons"] > 0 and
            status["textboxes"] == 0
        ):
            shell_activated = _activate_followup_prompt_shell(page, scene_index)

        page.wait_for_timeout(1000)

    log_warn(f"La vista del video de la escena {scene_index} no termino de estabilizarse del todo, sigo con analisis fino...")
    return False


def _click_generated_video_for_followup(page: Page, scene_index: int, timeout_sec: int = 30) -> bool:
    """Hace click en el video generado para abrir el panel '¿Que pasa despues?'."""
    log_info(f"Buscando el video generado para abrir la continuacion de la escena {scene_index}...")

    candidate_info = page.evaluate("""() => {
        const normalize = (value) => String(value || '').toLowerCase();
        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 120 && rect.height > 90;
        };
        const nearbyText = (el) => {
            const parts = [];
            let node = el;
            let depth = 0;
            while (node && depth < 3) {
                parts.push(node.innerText || node.textContent || '');
                node = node.parentElement;
                depth += 1;
            }
            return normalize(parts.join(' '));
        };

        const result = { media: null, controls: null, viewport: null };

        const mediaCandidates = Array.from(document.querySelectorAll(
            'video, canvas, img, [role="img"], [aria-label*="preview"], [aria-label*="video"]'
        )).filter(isVisible);

        const scoredMedia = mediaCandidates.map((el) => {
            const rect = el.getBoundingClientRect();
            const text = nearbyText(el);
            let score = rect.width * rect.height;
            if (el.tagName === 'VIDEO') score += 300000;
            if (el.tagName === 'CANVAS') score += 180000;
            if (el.tagName === 'IMG') score += 120000;
            if (rect.top > 100) score += 20000;
            if (rect.bottom < window.innerHeight - 120) score += 10000;
            if (rect.left < window.innerWidth * 0.12) score -= 15000;
            if (rect.right > window.innerWidth * 0.82) score -= 250000;
            if (rect.left > window.innerWidth * 0.68) score -= 180000;
            if (rect.width > window.innerWidth * 0.35) score += 90000;
            const centerX = rect.x + rect.width / 2;
            const distanceFromCenter = Math.abs(centerX - window.innerWidth * 0.5);
            score -= distanceFromCenter * 80;
            if (text.includes('ampliar') || text.includes('insertar') || text.includes('eliminar')) score += 8000;
            const src = (
                el.currentSrc || el.src || el.getAttribute?.('src') || el.getAttribute?.('aria-label') || ''
            );
            if (String(src).trim()) score += 50000;
            return { score, x: rect.x, y: rect.y, w: rect.width, h: rect.height, via: el.tagName.toLowerCase() };
        }).sort((a, b) => b.score - a.score);

        if (scoredMedia.length) {
            result.media = { strategy: 'media', ...scoredMedia[0] };
        }

        const buttons = Array.from(document.querySelectorAll('button')).filter((btn) => btn.offsetParent !== null);
        const controlButtons = buttons.filter((btn) => {
            const normalize = (value) => String(value || '').toLowerCase();
            const text = normalize(btn.innerText || btn.textContent || '');
            return (
                text.includes('ampliar') ||
                text.includes('insertar') ||
                text.includes('eliminar') ||
                text.includes('camara') ||
                text.includes('cámara')
            );
        });

        if (controlButtons.length) {
            const rects = controlButtons.map((btn) => btn.getBoundingClientRect());
            const minX = Math.min(...rects.map((r) => r.left));
            const maxX = Math.max(...rects.map((r) => r.right));
            const minTop = Math.min(...rects.map((r) => r.top));
            const clickX = (minX + maxX) / 2;
            const clickY = Math.max(120, minTop - 140);
            result.controls = {
                strategy: 'controls-fallback',
                x: clickX - 5,
                y: clickY - 5,
                w: 10,
                h: 10,
                via: 'controls',
            };
        }

        result.viewport = {
            strategy: 'viewport-fallback',
            x: window.innerWidth * 0.5 - 5,
            y: window.innerHeight * 0.45 - 5,
            w: 10,
            h: 10,
            via: 'viewport',
        };

        return result;
    }""")

    strategies = [
        candidate_info.get("media"),
        candidate_info.get("controls"),
        candidate_info.get("viewport"),
    ]

    for strategy in [item for item in strategies if item]:
        cx = strategy["x"] + strategy["w"] / 2
        cy = strategy["y"] + strategy["h"] / 2
        log_info(
            f"Resultado generado encontrado en ({cx:.0f}, {cy:.0f}) "
            f"via {strategy.get('via', strategy.get('strategy', 'desconocido'))} "
            f"para la escena {scene_index}. Haciendo click..."
        )
        page.mouse.click(cx, cy)
        page.wait_for_timeout(2500)
        _poll_video_view_ready(page, scene_index, timeout_sec=min(10, timeout_sec))

        if _ensure_followup_ready(page, scene_index, timeout_sec=min(8, timeout_sec), log_wait=False):
            log_ok(f"Click en el resultado generado realizado para la escena {scene_index}.")
            return True

        log_warn(
            f"El click via {strategy.get('via', strategy.get('strategy', 'desconocido'))} "
            f"no abrio la continuacion para la escena {scene_index}. Probando otra estrategia..."
        )

    log_error(f"No pude abrir la continuacion desde el resultado generado de la escena {scene_index}.")
    return False


def _wait_for_prompt_settle(
    page: Page,
    prompt_text: str,
    timeout_sec: int = 45,
    stable_rounds: int = 10,
    editor_selector: str = '[contenteditable="true"]',
    action_mode: str = "create",
) -> bool:
    """
    Espera a que el prompt quede completo y estable antes de lanzar "Crear".

    stable_rounds=10 con polling de 1s equivale a ~10s de estabilidad real.
    """
    normalized_expected = _normalize_prompt_text(prompt_text)
    expected_len = len(normalized_expected)

    def _poll_until_stable(
        phase_label: str,
        phase_timeout_sec: int,
        phase_stable_rounds: int,
        log_every: int = 5,
    ) -> bool:
        stable_hits = 0
        attempts = 0
        deadline = time.time() + phase_timeout_sec
        log_info(
            f"{phase_label}: esperando a que Flow termine de absorber el prompt "
            f"(timeout {phase_timeout_sec}s, estabilidad {phase_stable_rounds}s)..."
        )

        while time.time() < deadline:
            attempts += 1
            remaining = max(0, int(deadline - time.time()))
            current_text = page.evaluate("""(selector) => {
                // Priority: find the WIDEST visible contenteditable/textbox (the prompt field)
                // NOT the narrow date or title inputs
                const candidates = Array.from(document.querySelectorAll(
                    '[contenteditable="true"], [role="textbox"], textarea, input[type="text"], input:not([type])'
                ));
                const visible = candidates.filter(el => el.offsetParent !== null);
                // Sort by width descending — the prompt field is the widest
                visible.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
                const tagged = document.querySelector(selector);
                // Prefer tagged if it's visible and wide, otherwise take widest
                const el = (tagged && tagged.offsetParent !== null && tagged.getBoundingClientRect().width > 200)
                    ? tagged
                    : visible.find(v => v.getBoundingClientRect().width > 200) || visible[0];
                if (!el) return '';
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return (el.value || '').trim();
                return (el.innerText || el.textContent || '').trim();
            }""", editor_selector)
            normalized_current = _normalize_prompt_text(current_text)

            action_ready = page.evaluate("""({ selector, actionMode }) => {
                const isVisible = (el) => !!el && el.offsetParent !== null;
                const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);
                const scoreRelativeButton = (target, button, isFollowup) => {
                    const rect = button.getBoundingClientRect();
                    const targetRect = target.getBoundingClientRect();
                    const centerX = rect.x + rect.width / 2;
                    const centerY = rect.y + rect.height / 2;
                    const targetCenterY = targetRect.y + targetRect.height / 2;
                    let score = 0;
                    if (centerX > targetRect.right - 10) score += 5000;
                    score -= Math.abs(centerY - targetCenterY) * 10;
                    score -= Math.abs(centerX - (targetRect.right + (isFollowup ? 24 : 36)));
                    if (rect.width >= (isFollowup ? 28 : 32) && rect.height >= (isFollowup ? 28 : 32)) score += 500;
                    const text = (button.innerText || button.textContent || '').toLowerCase();
                    if (text.includes('arrow_forward') || text.includes('send')) score += 800;
                    if (text.includes('crear') || text.includes('create')) score += 1500;
                    return score;
                };

                if (actionMode === 'followup') {
                    const target = document.querySelector(selector) || document.querySelector('[data-codex-followup="1"]');
                    if (!target) return false;
                    const targetRect = target.getBoundingClientRect();
                    const scored = buttons.map((btn) => {
                        return { btn, score: scoreRelativeButton(target, btn, true) };
                    }).sort((a, b) => b.score - a.score);
                    const best = scored[0]?.btn;
                    if (!best) return false;
                    return !best.disabled && best.getAttribute('aria-disabled') !== 'true';
                }

                const target = document.querySelector(selector) || document.querySelector('[contenteditable="true"]');
                if (target) {
                    const scored = buttons.map((btn) => {
                        return { btn, score: scoreRelativeButton(target, btn, false) };
                    }).sort((a, b) => b.score - a.score);
                    const best = scored[0];
                    if (best && best.score >= 4200) {
                        return !best.btn.disabled && best.btn.getAttribute('aria-disabled') !== 'true';
                    }
                }

                const btn = buttons.find((b) => {
                    const text = (b.innerText || b.textContent || '').toLowerCase();
                    return text.includes('crear') || text.includes('create');
                });
                if (!btn) return false;
                return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
            }""", {"selector": editor_selector, "actionMode": action_mode})

            # Exact match or close enough (>90% of expected length and action button ready)
            text_match = (normalized_current == normalized_expected)
            close_enough = (
                not text_match
                and action_ready
                and expected_len > 0
                and len(normalized_current) >= expected_len * 0.9
                and normalized_expected[:50] in normalized_current
            )
            if (text_match or close_enough) and action_ready:
                stable_hits += 1
                if stable_hits >= phase_stable_rounds:
                    match_type = "exacto" if text_match else f"~{len(normalized_current)}/{expected_len} chars"
                    log_ok(
                        f"Prompt estable y completo en Flow ({match_type}). "
                        "Ya se puede pulsar el boton de envio."
                    )
                    return True
            else:
                if stable_hits > 0:
                    log_info("El prompt aun sigue cambiando. Reiniciando ventana de estabilidad...")
                stable_hits = 0

            if attempts % log_every == 1:
                log_info(
                    f"{phase_label}: polling del prompt "
                    f"({len(normalized_current)}/{expected_len} chars, action_ready={action_ready}, quedan {remaining}s)..."
                )

            page.wait_for_timeout(1000)

        return False

    if _poll_until_stable("Fase principal", timeout_sec, stable_rounds):
        return True

    log_warn(
        "Flow no termino de estabilizar el prompt en la fase principal. "
        "Activo un polling de recuperacion antes de abortar..."
    )

    if _poll_until_stable("Fase de recuperacion", phase_timeout_sec=90, phase_stable_rounds=6, log_every=3):
        return True

    log_error("Flow no termino de estabilizar el prompt a tiempo ni en recuperacion. No voy a pulsar Crear para evitar lanzar un prompt incompleto.")
    return False


def _click_create(page: Page, max_retries: int = 5) -> bool:
    """Click en el boton de envio (flecha →, arrow_forward, Crear) con click real."""
    log_info("Buscando boton de envio...")

    for attempt in range(max_retries):
        btn_info = page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => b.offsetParent !== null);
            // Strategy 1: Find "arrow_forward + Create/Crear" button (the actual send button)
            const sendBtn = buttons.find(b => {
                const text = (b.innerText || '').toLowerCase().trim();
                return (
                    (text.includes('arrow_forward') && (text.includes('create') || text.includes('crear'))) ||
                    text === 'arrow_forward' ||
                    text === '→' || text === '➡' || text === '▶'
                );
            });
            if (sendBtn) {
                const rect = sendBtn.getBoundingClientRect();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: (sendBtn.innerText || '').slice(0, 30), method: 'arrow_forward' };
            }
            // Strategy 2: Find by aria-label
            const ariaBtn = buttons.find(b => {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                return aria.includes('send') || aria.includes('submit') || aria.includes('generate') ||
                       aria.includes('crear') || aria.includes('create');
            });
            if (ariaBtn) {
                const rect = ariaBtn.getBoundingClientRect();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: (ariaBtn.innerText || '').slice(0, 30), method: 'aria' };
            }
            // Strategy 3: Find the LAST small button in the bottom-right (the send arrow is always rightmost)
            const bottomBtns = buttons.filter(b => {
                const r = b.getBoundingClientRect();
                return r.bottom > window.innerHeight - 150 && r.right > window.innerWidth - 200;
            }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
            // The rightmost small button in the bottom bar is the send arrow
            const rightmost = bottomBtns.find(b => {
                const r = b.getBoundingClientRect();
                return r.width < 60 && r.height < 60; // send button is small (~32x32), not the options button (~89x34)
            }) || bottomBtns[0];
            if (rightmost) {
                const rect = rightmost.getBoundingClientRect();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height, text: (rightmost.innerText || '').slice(0, 30), method: 'rightmost' };
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
            log_ok(f"Click en boton de envio realizado ({btn_info.get('text','?')}).")
            return True

        if attempt < max_retries - 1:
            log_info(f"Boton de envio no encontrado. Reintento {attempt + 2}/{max_retries} en 3s...")
            page.wait_for_timeout(3000)

    log_error("No se encontro el boton de envio despues de todos los reintentos.")
    return False


def _click_followup_send(page: Page, scene_index: int, max_retries: int = 8) -> bool:
    """Hace click en el boton circular de envio junto a '¿Que pasa despues?'."""
    log_info(f"Buscando boton de envio de continuacion para la escena {scene_index}...")
    for attempt in range(max_retries):
        btn_info = page.evaluate("""() => {
            const target = document.querySelector('[data-codex-followup="1"]');
            if (!target) return { found: false };
            const targetRect = target.getBoundingClientRect();
            const buttons = Array.from(document.querySelectorAll('button')).filter((btn) => btn.offsetParent !== null);
            const scored = buttons.map((btn) => {
                const rect = btn.getBoundingClientRect();
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const targetCenterY = targetRect.y + targetRect.height / 2;
                let score = 0;
                if (centerX > targetRect.right - 10) score += 5000;
                score -= Math.abs(centerY - targetCenterY) * 10;
                score -= Math.abs(centerX - (targetRect.right + 24));
                if (rect.width >= 36 && rect.height >= 36) score += 1000;
                return { rect, score };
            }).sort((a, b) => b.score - a.score);
            const best = scored[0];
            if (!best) return { found: false };
            return {
                found: true,
                x: best.rect.x,
                y: best.rect.y,
                w: best.rect.width,
                h: best.rect.height,
            };
        }""")
        if btn_info.get("found"):
            cx = btn_info["x"] + btn_info["w"] / 2
            cy = btn_info["y"] + btn_info["h"] / 2
            log_info(f"Boton de continuacion encontrado en ({cx:.0f}, {cy:.0f}). Haciendo click...")
            page.mouse.click(cx, cy)
            page.wait_for_timeout(2000)
            log_ok(f"Click en el boton de continuacion realizado para la escena {scene_index}.")
            return True
        if attempt < max_retries - 1:
            page.wait_for_timeout(1500)
    log_error(f"No se encontro el boton de envio de continuacion para la escena {scene_index}.")
    return False


def _handle_google_login(page: Page, timeout_sec: int = 30) -> bool:
    """
    Maneja el login de Google cuando Flow lo requiere.
    Hace click en la cuenta guardada — la contraseña está en el navegador.
    """
    log_info("Detectado login de Google. Seleccionando cuenta guardada...")

    page.wait_for_timeout(3000)

    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        url = (page.url or "").lower()

        # Auth error page — click "Sign in with Google" to retry
        if "error=callback" in url or "signin?error" in url:
            log_warn("Error de autenticación. Reintentando login...")
            page.evaluate("""() => {
                const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const btn = all.find(b => {
                    const t = (b.innerText || '').toLowerCase();
                    return t.includes('sign in with google') || t.includes('iniciar sesión con google') ||
                           t.includes('try signing') || t.includes('intentar');
                });
                if (btn) btn.click();
            }""")
            page.wait_for_timeout(4000)
            continue

        # Success — landed on Flow
        if "labs.google/fx" in url and "accounts.google" not in url and "error" not in url:
            log_ok("Login de Google completado.")
            return True

        try:
            # Google Sign-In account chooser: click on the first account row
            # The account row is a <li> containing a <div> with the user's name and email
            # It's inside a <ul> in the account chooser form
            clicked = page.evaluate("""() => {
                // Strategy 1: Google's account chooser uses data-identifier on the account link
                const byId = document.querySelector('[data-identifier]');
                if (byId) { byId.click(); return 'data-identifier'; }

                // Strategy 2: Find the <li> that contains an email address
                // Google wraps each account in a <li> inside the chooser
                const items = document.querySelectorAll('ul li');
                for (const li of items) {
                    const text = li.innerText || '';
                    // An account row contains @ (email) and has reasonable size
                    if (text.includes('@') && li.getBoundingClientRect().height > 40) {
                        li.click();
                        return 'li-with-email';
                    }
                }

                // Strategy 3: Find the account card div directly
                // Google uses class like JDAKTe or similar for account rows
                const divs = document.querySelectorAll('div[role="link"], div[tabindex="0"], div[data-authuser]');
                for (const div of divs) {
                    const text = div.innerText || '';
                    if (text.includes('@')) {
                        div.click();
                        return 'div-role-link';
                    }
                }

                // Strategy 4: Find the specific "Saliste de la cuenta" text and click its parent row
                const spans = document.querySelectorAll('div, span');
                for (const span of spans) {
                    const text = (span.innerText || '').trim();
                    if (text.includes('Saliste de la cuenta') || text.includes('Signed out')) {
                        // Go up to find the clickable container
                        let parent = span.parentElement;
                        for (let i = 0; i < 5 && parent; i++) {
                            if (parent.getAttribute('role') === 'link' || parent.getAttribute('tabindex') === '0' || parent.tagName === 'LI') {
                                parent.click();
                                return 'signed-out-parent';
                            }
                            parent = parent.parentElement;
                        }
                        // Click the nearest ancestor with click handler
                        span.closest('li, [role="link"], [tabindex="0"]')?.click();
                        return 'signed-out-closest';
                    }
                }

                return false;
            }""")

            if clicked:
                log_ok(f"Click en cuenta de Google ({clicked}). Esperando...")
                page.wait_for_timeout(4000)

                url_after = (page.url or "").lower()
                if "accounts.google" not in url_after:
                    continue  # Login completed

                # Still on Google login — need to handle password page
                log_info("Pagina de contraseña detectada. Activando autofill...")

                # Step A: Click on the password field to trigger browser autofill
                try:
                    pwd_field = page.query_selector('input[type="password"]')
                    if pwd_field:
                        pwd_field.click()
                        log_info("Click en campo de contraseña. Esperando autofill...")
                        page.wait_for_timeout(2000)

                        # Step B: The browser should show autofill dropdown
                        # Press ArrowDown + Enter to select the saved password
                        page.keyboard.press("ArrowDown")
                        page.wait_for_timeout(500)
                        page.keyboard.press("Enter")
                        log_info("Seleccionada contraseña guardada via teclado.")
                        page.wait_for_timeout(2000)
                except Exception as pwd_err:
                    log_warn(f"No se pudo interactuar con campo de password: {pwd_err}")

                # Step C: Click "Next" / "Siguiente" / "Sign in" button
                page.evaluate("""() => {
                    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const next = btns.find(b => {
                        const t = (b.innerText || '').toLowerCase();
                        return t.includes('next') || t.includes('siguiente') ||
                               t.includes('continuar') || t.includes('sign in') ||
                               t.includes('iniciar') || t.includes('acceder');
                    });
                    if (next) { next.click(); return true; }
                    // Fallback: submit the form
                    const form = document.querySelector('form');
                    if (form) { form.submit(); return true; }
                    return false;
                }""")
                log_info("Click en boton Siguiente/Sign in.")
                page.wait_for_timeout(5000)
                continue
        except Exception as exc:
            log_warn(f"Error durante login de Google: {exc}")

        page.wait_for_timeout(2000)

    # Final check
    if "labs.google" in (page.url or "").lower():
        log_ok("Login completado.")
        return True

    log_error("No se pudo completar el login de Google en el tiempo esperado.")
    return False


def _wait_for_session_ready(page: Page, timeout_sec: int = 60) -> bool:
    """Espera a que Flow este listo. Si hay login wall, lo maneja automáticamente."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        url = (page.url or "").lower()

        # Login wall detected — handle it
        if "accounts.google.com" in url:
            if not _handle_google_login(page, timeout_sec=45):
                return False
            page.wait_for_timeout(3000)
            continue

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
    scene_index = max(1, int(os.environ.get("BOT_VIDEO_ACTIVE_SCENE_INDEX", "1") or "1"))
    log_info(
        f"Prompt de la escena {scene_index} leido ({len(prompt_text)} chars). "
        f"Conectando a CDP en puerto {cdp_port}..."
    )

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

            project_page = None

            if scene_index <= 1:
                # Si estamos dentro de un proyecto viejo, volver a la lista
                if not _go_to_flow_list(page):
                    return 1

                # Click en "Nuevo proyecto" + polling hasta que cargue
                if not _click_new_project(page):
                    return 1

                project_page = _find_project_page(browser) or page
                project_page.bring_to_front()
                page.wait_for_timeout(1000)
                log_ok(f"Proyecto nuevo listo: {project_page.url}")
            else:
                project_page = _find_project_page(browser)
                if not project_page:
                    log_warn(
                        f"No encontre un proyecto abierto para la escena {scene_index}. "
                        "Intentando crear uno nuevo como respaldo..."
                    )
                    if not _go_to_flow_list(page):
                        return 1
                    if not _click_new_project(page):
                        return 1
                    project_page = _find_project_page(browser) or page
                project_page.bring_to_front()
                if not _click_generated_video_for_followup(project_page, scene_index):
                    return 1
                if not _ensure_followup_ready(project_page, scene_index):
                    return 1
                log_ok(f"Proyecto listo para continuar con la escena {scene_index}: {project_page.url}")

            if scene_index <= 1:
                # Pegar prompt inicial
                if not _paste_prompt_in_flow(project_page, prompt_text):
                    return 1
            else:
                if not _paste_followup_prompt_in_flow(project_page, prompt_text, scene_index):
                    return 1

            # Esperar a que Flow termine de fijar el prompt completo antes de crear.
            settle_selector = 'textarea, input:not([type="hidden"]), [contenteditable="true"], [role="textbox"]' if scene_index <= 1 else '[data-codex-followup="1"]'
            if not _wait_for_prompt_settle(
                project_page,
                prompt_text,
                timeout_sec=45,
                stable_rounds=10,
                editor_selector=settle_selector,
                action_mode="create" if scene_index <= 1 else "followup",
            ):
                return 1

            if scene_index <= 1:
                # Click en "Crear" para generar el video inicial
                if not _click_create(project_page):
                    return 1
            else:
                if not _click_followup_send(project_page, scene_index):
                    return 1

            print(f"PROMPT_SENT=scene-{scene_index}")
            log_ok(f"Escena {scene_index} en proceso de generacion en Flow (Veo 3).")
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
