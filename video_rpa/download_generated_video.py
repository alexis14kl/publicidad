"""
Download Generated Video — Espera y descarga el video generado en Google Flow (Veo 3).

Flujo:
1. Conectar via Playwright CDP al puerto del perfil
2. Buscar la pestaña del proyecto en Flow
3. Polling: esperar a que aparezca un <video> con readyState === 4
4. Descargar el video via la URL del src
5. Guardar en videos_publicitarias/{timestamp}.mp4
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Browser

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error

VIDEO_DIR = PROJECT_ROOT / "videos_publicitarias"
DEFAULT_CDP_PORT = 9225
DEFAULT_WAIT_TIMEOUT_SEC = 600  # 10 minutos — videos tardan mas que imagenes
DEFAULT_POLL_INTERVAL_SEC = 5


def _find_project_page(browser: Browser) -> Page | None:
    """Busca la pestaña del proyecto activo en Flow."""
    best_page = None
    best_buttons = 0
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "/project/" in url and "/edit/" not in url and "accounts.google" not in url:
                try:
                    btn_count = page.evaluate("() => document.querySelectorAll('button').length")
                    if btn_count > best_buttons:
                        best_buttons = btn_count
                        best_page = page
                except Exception:
                    continue
    return best_page


def _poll_for_video(page: Page, timeout_sec: int = DEFAULT_WAIT_TIMEOUT_SEC, poll_interval: int = DEFAULT_POLL_INTERVAL_SEC) -> dict | None:
    """Polling: espera a que aparezca un video listo para descargar."""
    log_info(f"Esperando video generado (timeout {timeout_sec}s, polling cada {poll_interval}s)...")
    deadline = time.time() + timeout_sec
    attempt = 0

    while time.time() < deadline:
        attempt += 1
        remaining = int(deadline - time.time())

        # Verificar error de pagina
        has_error = page.evaluate("() => (document.body.innerText || '').includes('Application error')")
        if has_error:
            log_error("La pagina crasheo (Application error).")
            return None

        # Buscar videos — Flow usa preload=none, asi que checamos src + boton Descargar
        video_info = page.evaluate("""() => {
            const videos = Array.from(document.querySelectorAll('video'));
            const buttons = Array.from(document.querySelectorAll('button'));
            const hasDownload = buttons.some(b => {
                const text = (b.innerText || '').toLowerCase();
                return (text.includes('descargar') || text.includes('download')) && b.offsetParent !== null;
            });

            // Video listo si: tiene src Y (readyState >= 3 O boton Descargar visible)
            const withSrc = videos.filter(v => (v.src || v.currentSrc));
            const ready = withSrc.filter(v => v.readyState >= 3 || hasDownload);

            if (ready.length === 0) {
                const body = (document.body.innerText || '').toLowerCase();
                const isGenerating = body.includes('generando') || body.includes('generating')
                    || body.includes('procesando') || body.includes('processing')
                    || body.includes('en cola') || body.includes('queued');
                return {
                    found: false,
                    totalVideos: videos.length,
                    videosWithSrc: withSrc.length,
                    hasDownload: hasDownload,
                    isGenerating: isGenerating,
                };
            }
            const v = ready[ready.length - 1];
            return {
                found: true,
                src: v.src || v.currentSrc || '',
                width: v.videoWidth || 0,
                height: v.videoHeight || 0,
                duration: isNaN(v.duration) ? 0 : v.duration,
                readyState: v.readyState,
                hasDownload: hasDownload,
                totalVideos: videos.length,
            };
        }""")

        if video_info.get("found"):
            w = video_info.get('width', 0)
            h = video_info.get('height', 0)
            dur = video_info.get('duration', 0)
            dl = "con Descargar" if video_info.get('hasDownload') else ""
            log_ok(f"Video listo! {w}x{h} | {dur:.1f}s | readyState={video_info.get('readyState', '?')} {dl}")
            return video_info

        # Log status
        if attempt % 3 == 1:
            total = video_info.get("totalVideos", 0)
            with_src = video_info.get("videosWithSrc", 0)
            has_dl = video_info.get("hasDownload", False)
            generating = video_info.get("isGenerating", False)
            if generating:
                status = "generando..."
            elif with_src and not has_dl:
                status = f"{with_src} video(s) con src, esperando boton Descargar..."
            else:
                status = f"{total} videos (sin src)"
            log_info(f"  [{attempt}] {status} | quedan {remaining}s")

        page.wait_for_timeout(poll_interval * 1000)

    log_error(f"Timeout ({timeout_sec}s): no se genero ningun video.")
    return None


def _download_video(page: Page, video_url: str) -> Path | None:
    """Descarga el video desde la URL."""
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Extraer ID del video de la URL si es posible
    match = re.search(r"name=([a-f0-9-]+)", video_url)
    video_id = match.group(1)[:12] if match else f"veo_{int(time.time())}"
    filename = f"{timestamp}_{video_id}.mp4"
    output_path = VIDEO_DIR / filename

    log_info(f"Descargando video: {video_url[:80]}...")

    try:
        context = page.context
        response = context.request.get(video_url, timeout=120000)
        if not response.ok:
            log_error(f"Error descargando video: HTTP {response.status}")
            return None

        video_bytes = response.body()
        output_path.write_bytes(video_bytes)
        size_mb = len(video_bytes) / (1024 * 1024)
        log_ok(f"Video descargado: {output_path.name} ({size_mb:.1f}MB)")
        return output_path

    except Exception as e:
        log_error(f"Error descargando video: {e}")
        return None


def main() -> int:
    cdp_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CDP_PORT
    env_port = os.environ.get("CDP_PROFILE_PORT")
    if env_port:
        cdp_port = int(env_port)

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    log_info(f"Conectando a CDP en puerto {cdp_port}...")

    with sync_playwright() as p:
        try:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        except Exception as e:
            log_error(f"No se pudo conectar a CDP: {e}")
            return 1

        try:
            # Buscar la pestaña del proyecto
            page = _find_project_page(browser)
            if not page:
                log_error("No se encontro pestaña de proyecto en Flow.")
                return 1

            page.bring_to_front()
            log_info(f"Proyecto: {page.url[:80]}")

            # Polling hasta que el video este listo
            video_info = _poll_for_video(page)
            if not video_info:
                return 1

            # Descargar el video
            video_url = video_info.get("src", "")
            if not video_url:
                log_error("Video encontrado pero sin URL.")
                return 1

            output_path = _download_video(page, video_url)
            if not output_path:
                return 1

            print(f"VIDEO_DOWNLOADED={output_path}")
            return 0

        except Exception as e:
            log_error(f"Error en download_generated_video: {e}")
            return 1
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
