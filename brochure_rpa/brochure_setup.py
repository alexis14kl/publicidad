"""
Brochure Setup — Pega prompt en ChatGPT via CDP y extrae el HTML generado.

Flujo:
1. Conectar via Playwright CDP al puerto del perfil
2. Encontrar/abrir pestaña de ChatGPT
3. Pegar prompt pidiendo HTML/CSS para brochure
4. Esperar respuesta completa (stop button desaparece)
5. Extraer bloque de codigo HTML de la respuesta
6. Guardar HTML en archivo de salida
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Browser

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error

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


def _find_chatgpt_page(browser: Browser) -> Page | None:
    """Busca una pestaña de ChatGPT ya abierta."""
    for context in browser.contexts:
        for page in context.pages:
            url = (page.url or "").lower()
            if "chatgpt.com" in url and "accounts.google" not in url:
                return page
    return None


def _open_chatgpt_page(browser: Browser) -> Page:
    """Abre una nueva pestaña con ChatGPT."""
    context = browser.contexts[0]
    page = context.new_page()
    log_info("Navegando a https://chatgpt.com/ ...")
    page.goto("https://chatgpt.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    return page


def _wait_for_composer(page: Page, timeout_ms: int = 30000) -> bool:
    """Espera a que el editor de prompt este listo."""
    try:
        page.wait_for_function(
            """() => {
                const editor = document.querySelector(
                    'div#prompt-textarea[contenteditable="true"], '
                    + '#prompt-textarea[contenteditable="true"]'
                );
                if (!editor) return false;
                const rect = editor.getBoundingClientRect();
                const style = window.getComputedStyle(editor);
                return (
                    rect.width > 50 && rect.height > 20 &&
                    style.display !== 'none' && style.visibility !== 'hidden'
                );
            }""",
            timeout=timeout_ms,
        )
        return True
    except Exception:
        return False


def _paste_prompt(page: Page, prompt: str) -> bool:
    """Pega el prompt en el editor de ChatGPT."""
    # Foco en el editor
    page.evaluate("""() => {
        const editor = document.querySelector(
            'div#prompt-textarea[contenteditable="true"], '
            + '#prompt-textarea[contenteditable="true"]'
        );
        if (editor) {
            editor.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }""")
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)

    # Insertar texto
    page.evaluate("""() => {
        const editor = document.querySelector(
            'div#prompt-textarea[contenteditable="true"], '
            + '#prompt-textarea[contenteditable="true"]'
        );
        if (editor) editor.focus();
    }""")
    page.keyboard.insert_text(prompt)
    page.wait_for_timeout(500)

    # Verificar que se registro
    registered = page.evaluate("""(expectedStart) => {
        const editor = document.querySelector(
            'div#prompt-textarea[contenteditable="true"], '
            + '#prompt-textarea[contenteditable="true"]'
        );
        if (!editor) return false;
        const text = (editor.innerText || editor.textContent || '').trim().toLowerCase();
        return text.length > 20 && text.includes(expectedStart);
    }""", prompt[:80].lower())

    return bool(registered)


def _click_send(page: Page) -> bool:
    """Hace click en el boton de enviar."""
    # Intentar con data-testid
    btn = page.locator('button[data-testid="send-button"]').first
    try:
        if btn.is_visible(timeout=3000):
            btn.click(timeout=5000)
            return True
    except Exception:
        pass

    # Fallback: Enter
    page.keyboard.press("Enter")
    return True


def _wait_for_response_complete(page: Page, timeout_sec: int = 180) -> bool:
    """Espera a que ChatGPT termine de responder (stop button desaparece)."""
    log_info("Esperando que ChatGPT genere la respuesta...")
    deadline = time.time() + timeout_sec

    # Primero esperar a que aparezca indicador de generacion
    generation_started = False
    start_deadline = time.time() + 15
    while time.time() < start_deadline:
        stop_visible = page.locator('button[data-testid="stop-button"]').first.is_visible()
        if stop_visible:
            generation_started = True
            log_info("ChatGPT esta generando la respuesta...")
            break
        page.wait_for_timeout(500)

    if not generation_started:
        # Puede que ya haya terminado muy rapido
        log_warn("No se detecto boton stop, verificando si ya hay respuesta...")

    # Esperar a que el stop button desaparezca
    while time.time() < deadline:
        try:
            stop_visible = page.locator('button[data-testid="stop-button"]').first.is_visible()
        except Exception:
            stop_visible = False

        if not stop_visible:
            # Verificar que no esta en estado idle
            page.wait_for_timeout(2000)
            try:
                still_visible = page.locator('button[data-testid="stop-button"]').first.is_visible()
            except Exception:
                still_visible = False

            if not still_visible:
                log_ok("ChatGPT termino de generar la respuesta.")
                return True

        page.wait_for_timeout(1000)

    log_warn("Timeout esperando respuesta de ChatGPT.")
    return False


def _extract_html_from_response(page: Page) -> str:
    """Extrae el HTML de la respuesta de ChatGPT.

    Estrategia principal: tomar el texto completo del ultimo mensaje
    del asistente (texto plano, no code blocks) y buscar el HTML dentro.
    """
    html_content = page.evaluate("""() => {
        // ── Estrategia 1: Texto completo del ultimo mensaje del asistente ──
        const assistantMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (assistantMsgs.length) {
            const lastMsg = assistantMsgs[assistantMsgs.length - 1];
            const fullText = lastMsg.innerText || lastMsg.textContent || '';
            if (fullText.includes('<!DOCTYPE') || fullText.includes('<html')) {
                return fullText;
            }
            // Buscar en code blocks dentro del mensaje
            const codeBlocks = lastMsg.querySelectorAll('pre code, pre');
            let best = '';
            for (const block of codeBlocks) {
                const text = block.innerText || block.textContent || '';
                if (text.includes('<') && text.length > best.length) best = text;
            }
            if (best) return best;
        }

        // ── Estrategia 2: Articles con data-testid ──
        const articles = document.querySelectorAll('article[data-testid^="conversation-turn"]');
        if (articles.length) {
            const lastArticle = articles[articles.length - 1];
            const fullText = lastArticle.innerText || lastArticle.textContent || '';
            if (fullText.includes('<!DOCTYPE') || fullText.includes('<html')) {
                return fullText;
            }
            const codeBlocks = lastArticle.querySelectorAll('pre code, pre');
            let best = '';
            for (const block of codeBlocks) {
                const text = block.innerText || block.textContent || '';
                if (text.includes('<') && text.length > best.length) best = text;
            }
            if (best) return best;
        }

        // ── Estrategia 3: Todos los pre/code de la pagina ──
        const allBlocks = document.querySelectorAll('pre code, pre');
        let best = '';
        for (const block of allBlocks) {
            const text = block.innerText || block.textContent || '';
            if (text.includes('<') && text.length > best.length) best = text;
        }
        if (best) return best;

        // ── Estrategia 4: Texto completo del body ──
        return document.body?.innerText || '';
    }""")

    raw = str(html_content or "").strip()
    if not raw:
        return ""

    # Limpiar texto basura antes del <!DOCTYPE o <html
    doctype_match = re.search(r'(<!DOCTYPE\s+html|<html)', raw, re.IGNORECASE)
    if doctype_match:
        raw = raw[doctype_match.start():]

    # Asegurar que termina en </html>
    html_end = raw.lower().rfind("</html>")
    if html_end > 0:
        raw = raw[:html_end + len("</html>")]

    return raw.strip()


def run_brochure_setup(cdp_port: int = 0, output_html: str = "") -> int:
    """Flujo completo: pegar prompt en ChatGPT y extraer HTML."""
    if not cdp_port:
        cdp_port = int(os.environ.get("CDP_PROFILE_PORT", DEFAULT_CDP_PORT))

    prompt = read_prompt()
    log_info(f"Prompt leido ({len(prompt)} chars)")

    output_path = Path(output_html) if output_html else (PROJECT_ROOT / "brochure_rpa" / "brochure_output.html")

    with sync_playwright() as pw:
        log_info(f"Conectando a CDP en puerto {cdp_port}...")
        browser = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")

        # Buscar o abrir ChatGPT
        page = _find_chatgpt_page(browser)
        if page:
            log_info(f"Pestaña ChatGPT encontrada: {page.url}")
            page.bring_to_front()
        else:
            log_info("No se encontro pestaña de ChatGPT, abriendo nueva...")
            page = _open_chatgpt_page(browser)

        # Esperar composer
        if not _wait_for_composer(page):
            log_error("El editor de prompt no esta disponible.")
            return 1

        # Pegar prompt
        log_info("Pegando prompt en ChatGPT...")
        if not _paste_prompt(page, prompt):
            log_warn("No se pudo verificar el prompt, intentando enviar de todas formas...")

        # Enviar
        _click_send(page)
        log_ok("Prompt enviado a ChatGPT.")

        # Esperar respuesta completa
        if not _wait_for_response_complete(page, timeout_sec=180):
            log_warn("La respuesta puede estar incompleta.")

        # Extraer HTML
        log_info("Extrayendo HTML de la respuesta...")
        html = _extract_html_from_response(page)

        if html:
            log_ok(f"HTML extraido: {len(html)} caracteres")
            log_info(f"Primeros 200 chars: {html[:200]}")
        else:
            log_error("No se encontro HTML en la respuesta de ChatGPT.")
            # Debug: capturar texto de la pagina para diagnostico
            try:
                page_text_len = page.evaluate("() => (document.body?.innerText || '').length")
                log_info(f"Debug: texto total en la pagina = {page_text_len} chars")
                # Verificar si hay copy buttons (indicio de code blocks)
                copy_btns = page.evaluate("() => document.querySelectorAll('button[aria-label*=\"Copy\"], button[aria-label*=\"Copiar\"]').length")
                log_info(f"Debug: botones Copy encontrados = {copy_btns}")
            except Exception:
                pass
            return 1

        # Validar que parece HTML
        if "<" not in html or ">" not in html:
            log_error("El contenido extraido no parece HTML valido.")
            return 1

        # Guardar
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(html, encoding="utf-8")
        log_ok(f"HTML guardado en: {output_path} ({len(html)} chars)")

        browser.close()
        return 0


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Brochure Setup - Pegar prompt y extraer HTML")
    parser.add_argument("cdp_port", nargs="?", type=int, default=0)
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    return run_brochure_setup(cdp_port=args.cdp_port, output_html=args.output)


if __name__ == "__main__":
    sys.exit(main())
