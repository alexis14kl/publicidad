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
import sys
import time
import urllib.request
from pathlib import Path

from core.utils.logger import log_info, log_ok, log_warn, log_error

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
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

    # Helper JS: busca el campo fresco del DOM y lo enfoca (sin guardar referencia)
    FIND_AND_FOCUS_JS = """() => {
        const candidates = Array.from(document.querySelectorAll(
            '[contenteditable="true"], [role="textbox"], textarea'
        ));
        for (const el of candidates) {
            if (!el.offsetParent) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.y > window.innerHeight * 0.5) {
                el.scrollIntoView({block: 'center'});
                el.focus();
                el.click();
                return { found: true, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
            }
        }
        return { found: false };
    }"""

    # ── Step 1: Encontrar y enfocar el campo ──
    field_info = page.evaluate(FIND_AND_FOCUS_JS)
    if not field_info.get("found"):
        log_error("No se encontró el campo 'What happens next?' en Flow.")
        return False

    log_ok(f"Campo encontrado en ({field_info['x']:.0f},{field_info['y']:.0f}) {field_info['w']:.0f}x{field_info['h']:.0f}")
    page.wait_for_timeout(1000)

    # ── Step 2: Limpiar campo completamente antes de escribir ──
    log_info("Limpiando campo de texto...")

    # Hacer click directo en las coordenadas del campo para activar el cursor
    page.mouse.click(
        field_info['x'] + field_info['w'] / 2,
        field_info['y'] + field_info['h'] / 2
    )
    page.wait_for_timeout(500)

    # Intentar limpiar múltiples veces hasta que el campo quede vacío
    for _clear_attempt in range(5):
        page.keyboard.press(f"{modifier}+a")
        page.wait_for_timeout(200)
        page.keyboard.press("Backspace")
        page.wait_for_timeout(300)
        page.keyboard.press("Delete")
        page.wait_for_timeout(300)

        # Verificar si el campo quedó vacío
        remaining = page.evaluate("""() => {
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
        if not remaining or len(remaining) < 5 or "what happens" in remaining.lower() or "que pasa" in remaining.lower():
            break
        log_info(f"  Campo aún tiene texto ({len(remaining)} chars). Reintentando limpieza...")

    page.wait_for_timeout(500)

    # ── Step 3: Limpiar caracteres problemáticos y escribir de corrido ──
    # Las comillas dobles causan que Flow cierre el campo o active shortcuts
    clean_text = prompt_text.replace('"', "'").replace('"', "'").replace('"', "'")
    prompt_len = len(clean_text)
    log_info(f"Escribiendo prompt ({prompt_len} chars)...")
    page.keyboard.type(clean_text, delay=60)
    log_ok(f"Escritura completada ({prompt_len} chars).")
    page.wait_for_timeout(5000)

    # Verificar que el texto llegó
    result = page.evaluate("""() => {
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

    if result and len(result) > 5 and "what happens" not in result.lower() and "que pasa" not in result.lower():
        log_ok(f"Prompt verificado ({len(result)} chars).")
        return True

    log_error("No se pudo escribir el prompt de extensión.")
    return False


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


def _click_video_tile_to_open(page) -> bool:
    """
    Click the last video tile in the project gallery to open the video view.
    The "What happens next?" field only appears after clicking into a video.
    """
    clicked = page.evaluate("""() => {
        // Find clickable video tiles (large buttons with play_circle or video elements)
        const candidates = Array.from(document.querySelectorAll(
            'button, [role="button"]'
        )).filter(el => {
            if (!el.offsetParent) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width < 100 || rect.height < 80) return false;
            const text = (el.innerText || '').toLowerCase();
            return text.includes('play_circle') || text.includes('videocam')
                || el.querySelector('video') !== null;
        });
        // Click the LAST one (most recently generated video)
        if (candidates.length) {
            candidates[candidates.length - 1].click();
            return true;
        }
        // Fallback: click any large video element
        const videos = Array.from(document.querySelectorAll('video')).filter(v => {
            const r = v.getBoundingClientRect();
            return r.width > 50 && r.height > 50 && v.offsetParent !== null;
        });
        if (videos.length) {
            videos[videos.length - 1].click();
            return true;
        }
        return false;
    }""")

    if clicked:
        log_ok("Click en video tile para abrir vista individual.")
        return True

    log_error("No se encontró tile de video para abrir.")
    return False


def _wait_for_followup_field(page, timeout_sec: int = 15) -> bool:
    """
    Wait for the "What happens next?" field to appear after clicking a video tile.
    Polls for a contenteditable field below 50% of the viewport.
    """
    import time
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        found = page.evaluate("""() => {
            const editables = Array.from(document.querySelectorAll(
                '[contenteditable="true"], [role="textbox"]'
            )).filter(el => {
                if (!el.offsetParent) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 200 && rect.y > window.innerHeight * 0.5;
            });
            // Also check for Extend button as indicator we're in video view
            const buttons = Array.from(document.querySelectorAll('button'))
                .filter(b => b.offsetParent !== null);
            const hasExtend = buttons.some(b =>
                (b.innerText || '').toLowerCase().includes('extend')
            );
            return editables.length > 0 || hasExtend;
        }""")
        if found:
            log_ok("Vista de video individual lista (campo de continuación visible).")
            return True
        page.wait_for_timeout(1000)

    log_error(f"Timeout ({timeout_sec}s): el campo 'What happens next?' no apareció.")
    return False


def _poll_for_combined_video(page, timeout_sec: int = 540) -> dict | None:
    """
    Poll for the combined video (original + extension) to appear.
    Flow replaces the current video with the combined one (duration > original).
    We look for a non-placeholder video with readyState >= 3.
    """
    import time
    log_info(f"Esperando video combinado (timeout {timeout_sec}s)...")
    deadline = time.time() + timeout_sec
    attempt = 0

    while time.time() < deadline:
        attempt += 1
        remaining = int(deadline - time.time())

        try:
            info = page.evaluate("""() => {
                const videos = Array.from(document.querySelectorAll('video'));
                const isPlaceholder = (url) => {
                    const v = String(url || '').toLowerCase();
                    return v.includes('gstatic.com/aitestkitchen') || v.endsWith('/back.mp4');
                };
                const buttons = Array.from(document.querySelectorAll('button'));
                const hasDownload = buttons.some(b => {
                    const text = (b.innerText || '').toLowerCase();
                    return (text.includes('descargar') || text.includes('download')) && b.offsetParent !== null;
                });
                const ready = videos.filter(v => {
                    const src = (v.src || v.currentSrc || '').trim();
                    if (!src || isPlaceholder(src)) return false;
                    const w = v.videoWidth || 0;
                    const h = v.videoHeight || 0;
                    if (w > 0 && h > 0 && (w < 320 || h < 180)) return false;
                    if (!(v.readyState >= 3 || hasDownload)) return false;
                    return true;
                });
                if (!ready.length) {
                    const body = (document.body.innerText || '').toLowerCase();
                    const generating = body.includes('generating') || body.includes('generando')
                        || body.includes('processing') || body.includes('procesando');
                    return { found: false, count: videos.length, generating, hasDownload };
                }
                // Pick the video with the longest duration (combined video)
                ready.sort((a, b) => {
                    const da = isNaN(a.duration) ? 0 : a.duration;
                    const db = isNaN(b.duration) ? 0 : b.duration;
                    return db - da;
                });
                const v = ready[0];
                return {
                    found: true,
                    src: v.src || v.currentSrc || '',
                    width: v.videoWidth || 0,
                    height: v.videoHeight || 0,
                    duration: isNaN(v.duration) ? 0 : v.duration,
                    readyState: v.readyState,
                    hasDownload,
                };
            }""")
        except Exception as e:
            if "Execution context was destroyed" in str(e):
                page.wait_for_timeout(2000)
                continue
            raise

        if info.get("found"):
            rs = info.get("readyState", 0)
            if rs < 4 and remaining > 15:
                log_info("Video disponible, esperando buffering completo...")
                page.wait_for_timeout(8000)
            return info

        if attempt % 3 == 1:
            gen = "generando..." if info.get("generating") else ""
            dl = "Download visible" if info.get("hasDownload") else ""
            log_info(f"  [{attempt}] {gen} {dl} | quedan {remaining}s")

        elapsed = timeout_sec - remaining
        interval = 2 if elapsed < 60 else 3 if elapsed < 300 else 8
        page.wait_for_timeout(interval * 1000)

    log_error(f"Timeout ({timeout_sec}s): no se generó el video combinado.")
    return None


def _download_via_ui_menu(page) -> Path | None:
    """
    Descarga el video usando la UI de Google Flow:
    1. Click en botón "Descargar" / "Download"
    2. Click en "Full Video"
    3. Click en "720p"
    Espera la descarga del navegador y mueve el archivo a output/videos/.
    """
    from datetime import datetime

    log_info("Descargando video via menú UI: Descargar → Full Video → 720p...")

    # Paso 1: Click en "Descargar" / "Download"
    for attempt in range(3):
        try:
            download_btn = page.locator('button, [role="button"]').filter(
                has_text=lambda t: any(k in (t or "").lower() for k in ["descargar", "download"])
            ).first
            if download_btn.is_visible(timeout=5000):
                download_btn.click()
                log_ok("Click en botón Descargar.")
                page.wait_for_timeout(1500)
                break
        except Exception:
            pass
        # Fallback: buscar por texto directo
        try:
            btns = page.query_selector_all('button, [role="button"], [role="menuitem"]')
            for btn in btns:
                text = (btn.text_content() or "").lower().strip()
                if "descargar" in text or "download" in text:
                    btn.click()
                    log_ok("Click en botón Descargar (fallback).")
                    page.wait_for_timeout(1500)
                    break
            else:
                continue
            break
        except Exception:
            page.wait_for_timeout(2000)
    else:
        log_warn("No se encontró botón Descargar.")
        return None

    # Paso 2: Click en "Full Video"
    for attempt in range(3):
        try:
            items = page.query_selector_all(
                'button, [role="button"], [role="menuitem"], [role="option"], li, a, div[class*="menu"], div[class*="item"]'
            )
            clicked = False
            for item in items:
                text = (item.text_content() or "").strip().lower()
                if "full video" in text:
                    item.click()
                    log_ok("Click en Full Video.")
                    page.wait_for_timeout(1500)
                    clicked = True
                    break
            if clicked:
                break
        except Exception:
            pass
        page.wait_for_timeout(1500)
    else:
        log_warn("No se encontró opción Full Video.")
        return None

    # Paso 3: Click en "720p" y capturar descarga
    for attempt in range(3):
        try:
            with page.expect_download(timeout=120000) as download_info:
                items = page.query_selector_all(
                    'button, [role="button"], [role="menuitem"], [role="option"], li, a, div[class*="menu"], div[class*="item"]'
                )
                clicked = False
                for item in items:
                    text = (item.text_content() or "").strip().lower()
                    if "720" in text:
                        item.click()
                        log_ok("Click en 720p. Esperando descarga...")
                        clicked = True
                        break
                if not clicked:
                    # Si no hay opción 720p, buscar "original" o primer item
                    for item in items:
                        text = (item.text_content() or "").strip().lower()
                        if "original" in text or "tamaño" in text:
                            item.click()
                            log_ok("Click en tamaño original (720p no disponible).")
                            clicked = True
                            break
                if not clicked:
                    log_warn(f"Intento {attempt + 1}: no se encontró opción de calidad.")
                    page.wait_for_timeout(2000)
                    continue

            download = download_info.value
            VIDEO_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            suggested = download.suggested_filename or "video.mp4"
            ext = Path(suggested).suffix or ".mp4"
            output_path = VIDEO_DIR / f"{ts}_fullvideo{ext}"
            download.save_as(str(output_path))
            size_mb = output_path.stat().st_size / (1024 * 1024)
            log_ok(f"Video Full descargado: {output_path.name} ({size_mb:.1f}MB)")
            return output_path

        except Exception as e:
            log_warn(f"Intento {attempt + 1} descarga: {e}")
            page.wait_for_timeout(3000)

    log_error("No se pudo descargar el video via UI.")
    return None


def _download_combined_video(page, video_url: str) -> Path | None:
    """
    Descarga el video combinado.
    Prioridad: UI menu (Descargar → Full Video → 720p) → CDP request (fallback).
    """
    # Intentar via UI de Google Flow (mejor calidad, video completo)
    result = _download_via_ui_menu(page)
    if result:
        return result

    log_warn("Descarga via UI falló. Intentando descarga directa...")

    # Fallback: CDP request directo
    from datetime import datetime
    import hashlib

    log_info(f"Descargando video combinado via CDP: {video_url[:80]}...")
    for attempt in range(3):
        try:
            context = page.context
            response = context.request.get(video_url, timeout=180000)
            video_bytes = response.body()
            if len(video_bytes) < 100_000:
                log_warn(f"Intento {attempt + 1}: archivo muy pequeño ({len(video_bytes)} bytes)")
                page.wait_for_timeout(3000)
                continue

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            vid = hashlib.md5(video_url.encode()).hexdigest()[:11]
            output_path = VIDEO_DIR / f"{ts}_{vid}.mp4"
            output_path.write_bytes(video_bytes)
            size_mb = len(video_bytes) / (1024 * 1024)
            log_ok(f"Video descargado via CDP: {output_path.name} ({size_mb:.1f}MB)")
            return output_path
        except Exception as e:
            log_warn(f"Intento {attempt + 1} fallo: {e}")
            page.wait_for_timeout(3000)

    return None


def _analyze_extend_prompt(raw_prompt: str) -> str:
    """
    Analiza el prompt de extensión con Claude usando las reglas de video-scene-creator.
    Convierte la idea del usuario en un prompt cinematográfico optimizado para Veo 3.
    Si Claude no responde, usa el prompt original.
    """
    try:
        from core.utils.claude_client import ask_claude
    except ImportError:
        log_warn("Claude client no disponible. Usando prompt original.")
        return raw_prompt

    # Cargar reglas del agente video-scene-creator
    skill_path = PROJECT_ROOT / "core" / "utils" / "AgenteMarketing" / "video-scene-creator.md"
    skill_rules = ""
    if skill_path.exists():
        content = skill_path.read_text("utf-8")
        # Extraer solo el contenido después del frontmatter
        if "---" in content:
            parts = content.split("---", 2)
            if len(parts) >= 3:
                skill_rules = parts[2].strip()[:4000]

    system_prompt = f"""Eres el agente video-scene-creator. Tu tarea es convertir la idea del usuario en un prompt de CONTINUACIÓN de video optimizado para Google Veo 3.

REGLAS DEL AGENTE:
{skill_rules}

REGLAS PARA EL PROMPT DE EXTENSIÓN:
1. El prompt debe describir QUÉ PASA DESPUÉS en el video actual.
2. Debe estar en INGLÉS profesional (Veo 3 funciona mejor en inglés).
3. Debe describir UNA sola acción clara de ~7 segundos.
4. Mantener continuidad visual con la escena anterior (mismos personajes, ropa, ambiente).
5. Incluir: estilo visual, acción exacta, composición de cámara, iluminación.
6. PROHIBIDO incluir texto, logos, nombres de marca o palabras visibles en pantalla.
7. Terminar con: "No text, no logos, no brand names, no written words visible anywhere."
8. Máximo 2-3 oraciones concisas.

Responde SOLO con el prompt optimizado. Sin explicaciones, sin comillas, sin prefijos."""

    user_prompt = f"Idea del usuario para la continuación del video:\n\"{raw_prompt}\"\n\nConviértelo en un prompt cinematográfico para Veo 3."

    log_info(f"Analizando prompt de extensión con Claude ({len(raw_prompt)} chars)...")
    result = ask_claude(system_prompt, user_prompt, max_retries=2, max_tokens=512)

    if result and len(result) > 10:
        log_ok(f"Prompt optimizado por Claude ({len(result)} chars).")
        return result.strip()

    log_warn("Claude no pudo optimizar el prompt. Usando original.")
    return raw_prompt


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

    raw_prompt = os.environ.get("BOT_VIDEO_EXTEND_PROMPT", "").strip()
    if not raw_prompt:
        log_error("No se proporcionó prompt de extensión (BOT_VIDEO_EXTEND_PROMPT).")
        return 1

    # Si el prompt viene de una escena pre-generada por Claude, ya está optimizado.
    # Solo analizar con Claude si es un prompt manual del usuario.
    is_pregenerated = os.environ.get("BOT_VIDEO_EXTEND_PREGENERATED", "0") == "1"
    if is_pregenerated:
        log_info("Prompt pre-generado por el agente. Usando directo sin re-analizar.")
        extend_prompt = raw_prompt
    else:
        extend_prompt = _analyze_extend_prompt(raw_prompt)

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

            # Step 1: Click the last video tile to open the video view
            # (the "What happens next?" field only appears in the video view)
            if not _click_video_tile_to_open(page):
                return 1

            page.wait_for_timeout(3000)

            # Step 2: Wait for "What happens next?" field to appear
            if not _wait_for_followup_field(page, timeout_sec=20):
                return 1

            # Step 3: Find and paste into the field
            if not _find_followup_field_and_paste(page, extend_prompt):
                return 1

            # Esperar a que Flow registre el texto y habilite el botón de envío
            log_info("Esperando que Flow procese el prompt...")
            page.wait_for_timeout(3000)

            # Verificar que el botón de envío esté habilitado antes de clickear
            for _wait in range(10):
                send_ready = page.evaluate("""() => {
                    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                    const sendBtn = btns.find(b => {
                        const text = (b.innerText || '').toLowerCase();
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        return (text.includes('arrow_forward') || text.includes('→') ||
                                text.includes('send') || aria.includes('send') || aria.includes('submit'))
                               && b.offsetParent !== null
                               && b.getBoundingClientRect().top > window.innerHeight * 0.4;
                    });
                    if (!sendBtn) return 'not_found';
                    return sendBtn.disabled ? 'disabled' : 'ready';
                }""")
                if send_ready == "ready":
                    log_ok("Botón de envío habilitado.")
                    break
                log_info(f"  Botón de envío: {send_ready}. Esperando...")
                page.wait_for_timeout(2000)

            # Step 4: Click the send button (→)
            if not _click_send_button(page):
                return 1

            log_ok("Prompt de extensión enviado. Esperando video combinado...")
            print("PROMPT_SENT=extend")

            # Wait for the combined video (duration > 10s) in the SAME session
            # Flow generates the combined video in-place — we poll for it
            page.wait_for_timeout(5000)  # Give Flow time to start generating

            combined_video = _poll_for_combined_video(page, timeout_sec=540)
            if not combined_video:
                log_error("No se generó el video combinado.")
                return 1

            video_url = combined_video["src"]
            duration = combined_video.get("duration", 0)
            log_ok(f"Video combinado listo: {combined_video.get('width', 0)}x{combined_video.get('height', 0)} | {duration:.1f}s")

            # ── Loop de extensiones adicionales ──
            # Leer prompts adicionales de BOT_VIDEO_EXTEND_PROMPTS_JSON (array)
            extra_prompts = []
            try:
                raw = os.environ.get("BOT_VIDEO_EXTEND_PROMPTS_JSON", "").strip()
                if raw:
                    extra_prompts = json.loads(raw)
                    if not isinstance(extra_prompts, list):
                        extra_prompts = []
            except Exception:
                extra_prompts = []

            ext_index = 0
            while ext_index < len(extra_prompts):
                next_prompt = str(extra_prompts[ext_index]).strip()
                if not next_prompt:
                    ext_index += 1
                    continue

                scene_index += 1
                log_info(f"Extensión adicional {ext_index + 1}/{len(extra_prompts)}: {next_prompt[:50]}...")

                # Recargar para que Flow detecte el campo
                page.reload(wait_until="domcontentloaded")
                page.wait_for_timeout(5000)

                if not _wait_for_followup_field(page, timeout_sec=20):
                    log_warn("No apareció campo de extensión. Continuando con descarga.")
                    break

                if not _find_followup_field_and_paste(page, next_prompt):
                    log_warn("No se pudo pegar el prompt adicional. Continuando con descarga.")
                    break

                log_info("Esperando que Flow procese el prompt...")
                page.wait_for_timeout(3000)

                # Esperar botón habilitado
                for _wait in range(10):
                    send_ready = page.evaluate("""() => {
                        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                        const sendBtn = btns.find(b => {
                            const text = (b.innerText || '').toLowerCase();
                            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                            return (text.includes('arrow_forward') || text.includes('→') ||
                                    text.includes('send') || aria.includes('send') || aria.includes('submit'))
                                   && b.offsetParent !== null
                                   && b.getBoundingClientRect().top > window.innerHeight * 0.4;
                        });
                        if (!sendBtn) return 'not_found';
                        return sendBtn.disabled ? 'disabled' : 'ready';
                    }""")
                    if send_ready == "ready":
                        break
                    page.wait_for_timeout(2000)

                if not _click_send_button(page):
                    log_warn("No se pudo enviar extensión adicional.")
                    break

                log_ok(f"Extensión {ext_index + 1} enviada. Esperando video...")
                print(f"PROMPT_SENT=extend_{ext_index + 1}")
                page.wait_for_timeout(5000)

                combined_video = _poll_for_combined_video(page, timeout_sec=540)
                if not combined_video:
                    log_warn("No se generó el video. Descargando último disponible.")
                    break

                video_url = combined_video["src"]
                duration = combined_video.get("duration", 0)
                log_ok(f"Video listo: {combined_video.get('width', 0)}x{combined_video.get('height', 0)} | {duration:.1f}s")
                ext_index += 1

            # ── Descargar video final ──
            VIDEO_DIR.mkdir(parents=True, exist_ok=True)
            output_path = _download_combined_video(page, video_url)
            if not output_path:
                log_error("No se pudo descargar el video combinado.")
                return 1

            # Update last_download.json
            import json as _json
            from datetime import datetime as _dt
            dl_state = {
                "scene_index": scene_index,
                "video_url": video_url,
                "output_path": str(output_path),
                "downloaded_at": _dt.now().isoformat(),
            }
            (VIDEO_DIR / "last_download.json").write_text(
                _json.dumps(dl_state, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            log_ok(f"Video final descargado: {output_path.name}")

        except Exception as e:
            log_error(f"Error en extend_video: {e}")
            return 1
        finally:
            browser.close()

    # Apply branding overlay (same as _video_pipeline in post_opening.py)
    videos = sorted(VIDEO_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
    if videos:
        try:
            from core.utils.overlay_video import overlay_video
            company_name = os.environ.get("BOT_COMPANY_NAME", "")
            website = os.environ.get("BUSINESS_WEBSITE", "")
            phone = os.environ.get("BUSINESS_WHATSAPP", "")
            logo_path = os.environ.get("BOT_COMPANY_LOGO_PATH", "")
            overlay_video(
                videos[0],
                company_name=company_name,
                website=website,
                phone=phone,
                logo_path=logo_path or None,
            )
        except Exception as exc:
            log_warn(f"No se pudo aplicar overlay al video extendido: {exc}")

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
