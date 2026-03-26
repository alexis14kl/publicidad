"""
Extiende un video ya generado en Google Flow (Veo 3).

Conecta al browser via CDP, encuentra el proyecto abierto con el video,
localiza el campo "What happens next?" / "¿Que pasa despues?",
pega el prompt de continuacion y hace click en el boton de envio (→).
Luego espera la descarga del video extendido.

Uso:
    python -m core.video_rpa.extend_video [cdp_port]

Env requeridas:
    BOT_VIDEO_EXTEND_PROMPT   — Prompt de continuacion
    CDP_PROFILE_PORT          — Puerto CDP (override)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from core.utils.logger import log_info, log_ok, log_warn, log_error

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DOWNLOAD_VIDEO_PY = PROJECT_ROOT / "core" / "video_rpa" / "download_generated_video.py"
VIDEO_DIR = PROJECT_ROOT / "output" / "videos"
CDP_DEBUG_INFO = PROJECT_ROOT / "cdp_debug_info.json"
DEFAULT_CDP_PORT = 9225


def _has_flow_tab(port: int) -> bool:
    """Check if there's a Google Flow tab open on this CDP port."""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/json")
        with urllib.request.urlopen(req, timeout=3) as resp:
            tabs = json.loads(resp.read())
            return any("labs.google/fx" in (t.get("url") or "").lower() for t in tabs)
    except Exception:
        return False


def _find_cdp_port_with_flow() -> int | None:
    """Find a CDP port that has a Google Flow tab open."""
    candidates = []

    # 1. From .video_cdp_port (saved by video pipeline)
    video_port_file = PROJECT_ROOT / ".video_cdp_port"
    if video_port_file.exists():
        try:
            port = int(video_port_file.read_text().strip())
            candidates.append(port)
        except Exception:
            pass

    # 2. From cdp_debug_info.json
    if CDP_DEBUG_INFO.exists():
        try:
            data = json.loads(CDP_DEBUG_INFO.read_text())
            for entry in data.values():
                port = entry.get("debugPort")
                if port:
                    candidates.append(int(port))
        except Exception:
            pass

    # 3. From env
    for key in ("CDP_PROFILE_PORT", "CDP_CHATGPT_PORT"):
        env_port = os.environ.get(key)
        if env_port:
            candidates.append(int(env_port))

    # 4. Common fixed ports
    candidates.extend([9225, 9226, 9227, 9228, 9229, 9230])

    # Check priority candidates first (deduplicated, preserving order)
    seen = set()
    for port in candidates:
        if port in seen:
            continue
        seen.add(port)
        if _has_flow_tab(port):
            return port

    # 5. Broader scan for dynamic ports (50000-60000 range used by DICloak profiles)
    # Use lsof to find listening Chrome/ginsbrowser debug ports
    try:
        import subprocess as _sp
        result = _sp.run(
            ["lsof", "-iTCP", "-sTCP:LISTEN", "-nP"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.splitlines():
            if "ginsbrowser" in line.lower() or "chrome" in line.lower():
                # Extract port from "TCP *:54188 (LISTEN)"
                parts = line.split(":")
                for part in parts:
                    for word in part.split():
                        try:
                            port = int(word.split("(")[0])
                            if port > 1024 and port not in seen:
                                seen.add(port)
                                if _has_flow_tab(port):
                                    return port
                        except ValueError:
                            continue
    except Exception:
        pass

    return None


def _find_followup_field_and_paste(page, prompt_text: str) -> bool:
    """
    Encuentra el campo "What happens next?" en Flow y pega el prompt.
    Replica el mismo patron que _paste_prompt_in_flow (generacion inicial).

    DOM real del campo:
      <DIV role="textbox" contenteditable="true"> pos ~(243,658) 564x20
        <P><SPAN contenteditable="false">What happens next?</SPAN></P>
      </DIV>
    """
    modifier = "Meta" if sys.platform == "darwin" else "Control"

    # ── Step 1: Find the field using wait_for_selector (same as initial) ──
    # Priority: role=textbox > contenteditable > textarea
    selectors_priority = [
        "[role='textbox']",
        "[contenteditable='true']",
        "[contenteditable='plaintext-only']",
        "textarea",
    ]

    textarea = None
    for selector in selectors_priority:
        try:
            elements = page.query_selector_all(selector)
            for el in elements:
                if not el.is_visible():
                    continue
                box = el.bounding_box()
                if not box:
                    continue
                # Must be wide enough (not the title input at ~199px)
                if box["width"] < 200:
                    continue
                # Must be below video (y > 50% of viewport height)
                viewport = page.viewport_size or {"height": 900}
                if box["y"] < viewport["height"] * 0.5:
                    continue
                textarea = el
                log_info(f"Campo encontrado: {selector} en ({box['x']:.0f},{box['y']:.0f}) {box['width']:.0f}x{box['height']:.0f}")
                break
            if textarea:
                break
        except Exception:
            continue

    if not textarea:
        # Fallback: find any wide editable field below video via JS
        log_info("Selectores directos no encontraron campo. Buscando via JS...")
        found_js = page.evaluate("""() => {
            const candidates = Array.from(document.querySelectorAll(
                '[contenteditable="true"], [role="textbox"], textarea'
            ));
            for (const el of candidates) {
                if (!el.offsetParent) continue;
                const rect = el.getBoundingClientRect();
                // Wide enough (not title field) AND below video
                if (rect.width > 200 && rect.y > window.innerHeight * 0.5) {
                    el.scrollIntoView({block: 'center'});
                    el.focus();
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if found_js:
            for sel in ["[role='textbox']", "[contenteditable='true']"]:
                try:
                    textarea = page.wait_for_selector(sel, timeout=3000, state="visible")
                    if textarea:
                        box = textarea.bounding_box()
                        if box and box["width"] > 200:
                            break
                        textarea = None
                except Exception:
                    continue

    if not textarea:
        log_error("No se encontró el campo 'What happens next?' en Flow.")
        return False

    log_ok("Campo de continuación encontrado y enfocado.")

    # ── Step 2: Click to focus (same as _paste_prompt_in_flow) ──
    textarea.click()
    page.wait_for_timeout(1000)

    # ── Step 3: Select all + delete (clear "What happens next?" placeholder text) ──
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(300)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)

    # ── Step 4: Paste via clipboard (same as _paste_prompt_in_flow) ──
    page.evaluate("(text) => navigator.clipboard.writeText(text)", prompt_text)
    page.wait_for_timeout(300)
    page.keyboard.press(f"{modifier}+v")
    page.wait_for_timeout(2000)

    # ── Step 5: Verify paste ──
    pasted = page.evaluate("""() => {
        const candidates = Array.from(document.querySelectorAll(
            '[contenteditable="true"], [role="textbox"]'
        ));
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.y > window.innerHeight * 0.5) {
                return (el.innerText || el.textContent || '').trim();
            }
        }
        return '';
    }""")

    if pasted and len(pasted) > 5 and "what happens" not in pasted.lower():
        log_ok(f"Prompt de extensión pegado ({len(pasted)} chars).")
        return True

    # ── Fallback: insert_text (same as _paste_prompt_in_flow) ──
    log_warn("Clipboard no pegó correctamente. Usando insert_text...")
    textarea.click()
    page.wait_for_timeout(500)
    page.keyboard.press(f"{modifier}+a")
    page.wait_for_timeout(200)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)
    page.keyboard.insert_text(prompt_text)
    page.wait_for_timeout(1000)

    # ── Fallback 2: force DOM (same as _paste_prompt_in_flow) ──
    typed = page.evaluate("""() => {
        const candidates = Array.from(document.querySelectorAll(
            '[contenteditable="true"], [role="textbox"]'
        ));
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.y > window.innerHeight * 0.5) {
                return (el.innerText || el.textContent || '').trim();
            }
        }
        return '';
    }""")

    if typed and len(typed) > 5 and "what happens" not in typed.lower():
        log_ok(f"Prompt de extensión escrito ({len(typed)} chars).")
        return True

    log_warn("Insertando por DOM directo...")
    page.evaluate("""(text) => {
        const candidates = Array.from(document.querySelectorAll(
            '[contenteditable="true"], [role="textbox"]'
        ));
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.y > window.innerHeight * 0.5) {
                el.focus();
                el.innerHTML = '';
                el.textContent = text;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        }
    }""", prompt_text)
    page.wait_for_timeout(500)

    log_ok("Prompt de extensión forzado via DOM.")
    return True


def _click_send_button(page) -> bool:
    """
    Click the send/arrow button (→) next to the "What happens next?" field.
    It's a small circular button to the right of the text field, near the Veo selector.
    """
    clicked = page.evaluate("""() => {
        const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 10 && rect.height > 10 && el.offsetParent !== null;
        };

        // Find the followup field to locate send button nearby
        const followupField = document.querySelector('[data-codex-followup="1"]');
        const fieldRect = followupField ? followupField.getBoundingClientRect() : null;

        const buttons = Array.from(document.querySelectorAll('button')).filter(isVisible);

        const scored = buttons.map(btn => {
            const rect = btn.getBoundingClientRect();
            const text = normalize(btn.innerText || btn.textContent || '');
            const ariaLabel = normalize(btn.getAttribute('aria-label') || '');
            const hasArrow = text.includes('arrow_forward') || text.includes('→') ||
                             text.includes('send') || text.includes('enviar');
            const hasAriaSubmit = ariaLabel.includes('send') || ariaLabel.includes('submit') ||
                                  ariaLabel.includes('enviar') || ariaLabel.includes('generate');

            // Skip control buttons (Extend, Insert, Remove, Camera)
            if (text.includes('extend') || text.includes('insert') || text.includes('remove') ||
                text.includes('camera') || text.includes('download') || text.includes('done') ||
                text.includes('ampliar') || text.includes('insertar') || text.includes('eliminar') ||
                text.includes('camara') || text.includes('descargar') || text.includes('show history')) {
                return null;
            }

            let score = 0;

            // Must be below 50% of viewport
            if (rect.top < window.innerHeight * 0.4) return null;

            // Arrow/send indicators
            if (hasArrow) score += 500000;
            if (hasAriaSubmit) score += 400000;

            // Small circular button (28-50px)
            if (rect.width >= 24 && rect.width <= 56 && rect.height >= 24 && rect.height <= 56) {
                score += 200000;
            }

            // Near the followup field (to the right)
            if (fieldRect) {
                const dx = rect.left - fieldRect.right;
                const dy = Math.abs((rect.top + rect.height/2) - (fieldRect.top + fieldRect.height/2));
                if (dx >= -50 && dx <= 100 && dy < 80) score += 300000;
            }

            // Contains SVG or material icon
            if (btn.querySelector('svg, mat-icon, .material-icons, [class*="icon"]')) {
                score += 50000;
            }

            return { btn, score, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }).filter(Boolean).sort((a, b) => b.score - a.score);

        if (scored.length) {
            scored[0].btn.click();
            return { clicked: true, score: scored[0].score };
        }
        return { clicked: false };
    }""")

    if clicked and clicked.get("clicked"):
        log_ok("Botón de envío clickeado.")
        return True

    # Fallback: press Enter
    log_warn("No se encontró botón de envío. Intentando Enter...")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    return True


def run_extend_video(cdp_port: int = DEFAULT_CDP_PORT) -> int:
    """
    Extiende el video actual en Flow:
    1. Encuentra la pestaña de Flow con el proyecto
    2. Localiza el campo "What happens next?" (sin click en el video)
    3. Pega el prompt de continuación
    4. Click en botón enviar (→)
    5. Espera y descarga el video extendido
    """
    from core.video_rpa.video_setup import (
        _find_flow_page,
        _find_project_page,
        _open_flow_page,
        _wait_for_session_ready,
    )
    from playwright.sync_api import sync_playwright

    extend_prompt = os.environ.get("BOT_VIDEO_EXTEND_PROMPT", "").strip()
    if not extend_prompt:
        log_error("No se proporcionó prompt de extensión (BOT_VIDEO_EXTEND_PROMPT).")
        return 1

    previous_video_url = os.environ.get("BOT_VIDEO_PREVIOUS_VIDEO_URL", "").strip()
    scene_index = 2

    # Auto-detect CDP port with Flow tab
    log_info("Buscando pestaña de Google Flow abierta...")
    flow_port = _find_cdp_port_with_flow()
    if flow_port:
        cdp_port = flow_port
        log_ok(f"Flow encontrado en puerto {cdp_port}.")
    else:
        log_error(
            "No se encontró Google Flow abierto en ningún puerto. "
            "Genera un video primero para que el perfil de Flow quede abierto."
        )
        return 1

    log_info(f"Extendiendo video con prompt ({len(extend_prompt)} chars). CDP puerto {cdp_port}...")

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        except Exception as e:
            log_error(f"No se pudo conectar a CDP en puerto {cdp_port}: {e}")
            return 1

        try:
            # Find Flow project page
            project_page = _find_project_page(browser)
            if not project_page:
                project_page = _find_flow_page(browser)
            if not project_page:
                log_error("No hay pestaña de Flow abierta en el browser.")
                return 1

            project_page.bring_to_front()
            log_ok(f"Pestaña de Flow: {project_page.url}")

            if not _wait_for_session_ready(project_page, timeout_sec=30):
                return 1

            page = project_page
            page.wait_for_timeout(2000)

            # Directly find and paste into "What happens next?" field
            # NO click on video needed - the field is already visible
            if not _find_followup_field_and_paste(page, extend_prompt):
                return 1

            page.wait_for_timeout(1000)

            # Click the send button (→)
            if not _click_send_button(page):
                return 1

            log_ok("Prompt de extensión enviado. Video en proceso de generación...")
            print("PROMPT_SENT=extend")

        except Exception as e:
            log_error(f"Error en extend_video: {e}")
            return 1
        finally:
            browser.close()

    # Download the extended video
    log_info("Esperando descarga del video extendido...")
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)

    env = {**os.environ}
    env.update({
        "CDP_PROFILE_PORT": str(cdp_port),
        "BOT_VIDEO_ACTIVE_SCENE_INDEX": str(scene_index),
        "BOT_VIDEO_PREVIOUS_VIDEO_URL": previous_video_url,
        "BOT_VIDEO_SKIP_DOWNLOAD": "0",
    })

    rc = subprocess.run(
        [sys.executable, str(DOWNLOAD_VIDEO_PY), str(cdp_port)],
        cwd=str(PROJECT_ROOT),
        env=env,
        timeout=600,
    ).returncode

    if rc != 0:
        log_error("No se pudo descargar el video extendido.")
        return 1

    log_ok("Video extendido descargado con éxito.")
    return 0


def main() -> int:
    cdp_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CDP_PORT
    env_port = os.environ.get("CDP_PROFILE_PORT")
    if env_port:
        cdp_port = int(env_port)
    return run_extend_video(cdp_port=cdp_port)


if __name__ == "__main__":
    raise SystemExit(main())
