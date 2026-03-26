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

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Browser

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.cfg.platform import VIDEO_DIR
from core.utils.logger import log_info, log_ok, log_warn, log_error
LAST_DOWNLOAD_FILE = VIDEO_DIR / "last_download.json"
DEFAULT_CDP_PORT = 9225
DEFAULT_WAIT_TIMEOUT_SEC = 600  # 10 minutos — videos tardan mas que imagenes
DEFAULT_POLL_INTERVAL_SEC = 3   # Polling mas rapido (antes: 5s)
MAX_DOWNLOAD_RETRIES = 3        # Reintentos de descarga


def _find_project_page(browser: Browser) -> Page | None:
    """Busca la pestaña del proyecto activo en Flow."""
    best_page = None
    best_buttons = 0
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "/project/" in url and "accounts.google" not in url:
                try:
                    btn_count = page.evaluate("() => document.querySelectorAll('button').length")
                    if btn_count > best_buttons:
                        best_buttons = btn_count
                        best_page = page
                except Exception:
                    continue
    return best_page


def _poll_for_video(
    page: Page,
    browser: Browser,
    timeout_sec: int = DEFAULT_WAIT_TIMEOUT_SEC,
    poll_interval: int = DEFAULT_POLL_INTERVAL_SEC,
    previous_video_url: str = "",
) -> dict | None:
    """Polling: espera a que aparezca un video listo para descargar."""
    log_info(f"Esperando video generado (timeout {timeout_sec}s)...")
    deadline = time.time() + timeout_sec
    attempt = 0
    # Adaptive polling: fast at start (generation usually takes 30-120s), slower after
    FAST_POLL_SEC = 2
    NORMAL_POLL_SEC = poll_interval
    SLOW_POLL_SEC = 8
    FAST_PHASE_UNTIL = 60  # First 60s: poll every 2s

    while time.time() < deadline:
        attempt += 1
        elapsed = timeout_sec - int(deadline - time.time())
        remaining = int(deadline - time.time())

        try:
            current_project_page = _find_project_page(browser)
            if current_project_page and current_project_page is not page:
                page = current_project_page
                page.bring_to_front()
                log_info(f"Proyecto actualizado: {page.url[:80]}")
        except Exception:
            pass

        try:
            # Verificar error de pagina
            has_error = page.evaluate("() => (document.body.innerText || '').includes('Application error')")
        except Exception as e:
            if "Execution context was destroyed" in str(e):
                log_warn("Flow cambio de vista mientras esperaba el video. Reintentando sobre la pestaña activa...")
                page.wait_for_timeout(1500)
                continue
            raise
        if has_error:
            log_error("La pagina crasheo (Application error).")
            return None

        # Buscar videos — Flow usa preload=none, asi que checamos src + boton Descargar
        try:
            video_info = page.evaluate("""(previousVideoUrl) => {
            const videos = Array.from(document.querySelectorAll('video'));
            const buttons = Array.from(document.querySelectorAll('button'));
            const hasDownload = buttons.some(b => {
                const text = (b.innerText || '').toLowerCase();
                return (text.includes('descargar') || text.includes('download')) && b.offsetParent !== null;
            });
            const isPlaceholder = (url) => {
                const value = String(url || '').toLowerCase();
                return (
                    value.includes('gstatic.com/aitestkitchen/website/flow/flow_camera/back.mp4') ||
                    value.endsWith('/back.mp4')
                );
            };

            // Video listo si: tiene src Y (readyState >= 3 O boton Descargar visible)
            const withSrc = videos.filter(v => (v.src || v.currentSrc));
            const ready = withSrc.filter(v => {
                const current = (v.src || v.currentSrc || '').trim();
                const width = v.videoWidth || 0;
                const height = v.videoHeight || 0;
                const duration = isNaN(v.duration) ? 0 : v.duration;
                if (!current || isPlaceholder(current)) return false;
                if (!(v.readyState >= 3 || hasDownload)) return false;
                if (width > 0 && height > 0 && (width < 320 || height < 180)) return false;
                if (duration > 0 && duration < 2) return false;
                return true;
            });
            const previous = (previousVideoUrl || '').trim();
            const newReady = ready.filter(v => {
                const current = (v.src || v.currentSrc || '').trim();
                return current && current !== previous;
            });

            if (newReady.length === 0) {
                const body = (document.body.innerText || '').toLowerCase();
                const isGenerating = body.includes('generando') || body.includes('generating')
                    || body.includes('procesando') || body.includes('processing')
                    || body.includes('en cola') || body.includes('queued');
                return {
                    found: false,
                    totalVideos: videos.length,
                    videosWithSrc: withSrc.length,
                    readyVideos: ready.length,
                    hasDownload: hasDownload,
                    isGenerating: isGenerating,
                    matchedPrevious: !!previous && ready.some(v => (v.src || v.currentSrc || '').trim() === previous),
                };
            }
            const v = newReady[newReady.length - 1];
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
        }""", previous_video_url)
        except Exception as e:
            if "Execution context was destroyed" in str(e):
                log_warn("Flow navego mientras inspeccionaba los videos. Reintentando...")
                page.wait_for_timeout(1500)
                continue
            raise

        if video_info.get("found"):
            w = video_info.get('width', 0)
            h = video_info.get('height', 0)
            dur = video_info.get('duration', 0)
            dl = "con Descargar" if video_info.get('hasDownload') else ""
            rs = video_info.get('readyState', 0)
            log_ok(f"Video listo! {w}x{h} | {dur:.1f}s | readyState={rs} {dl}")

            # Si readyState < 4 (no completamente buffered), esperar un poco mas
            # para obtener la mejor calidad posible
            if rs < 4 and remaining > 15:
                log_info("Video disponible pero no completamente buffered. Esperando 10s para mejor calidad...")
                page.wait_for_timeout(10000)
                # Re-check with updated readyState
                try:
                    updated = page.evaluate("""(prevSrc) => {
                        const v = Array.from(document.querySelectorAll('video')).find(
                            el => (el.src || el.currentSrc || '').trim() === prevSrc
                        );
                        if (!v) return null;
                        return { readyState: v.readyState, width: v.videoWidth, height: v.videoHeight };
                    }""", video_info.get('src', ''))
                    if updated and updated.get('readyState', 0) >= 4:
                        log_ok(f"Video completamente buffered (readyState=4). Calidad maxima.")
                except Exception:
                    pass

            return video_info

        # If videos have src but readyState=0 and no Download button,
        # we may be in the gallery/tile view. Click the video tile to open playback view.
        with_src = video_info.get("videosWithSrc", 0)
        has_dl = video_info.get("hasDownload", False)
        ready_videos = video_info.get("readyVideos", 0)
        if with_src > 0 and not has_dl and ready_videos == 0 and attempt in (3, 8, 20, 40):
            try:
                clicked_tile = page.evaluate("""() => {
                    // Look for clickable video tiles/cards in gallery view
                    // Flow uses buttons with play_circle icon or video thumbnails
                    const candidates = Array.from(document.querySelectorAll(
                        'button, [role="button"], [role="listitem"]'
                    )).filter(el => {
                        if (!el.offsetParent) return false;
                        const rect = el.getBoundingClientRect();
                        // Large enough to be a video tile (not a small icon button)
                        if (rect.width < 100 || rect.height < 80) return false;
                        const text = (el.innerText || '').toLowerCase();
                        // Has play icon or video-related text
                        return text.includes('play_circle') || text.includes('videocam')
                            || el.querySelector('video') !== null;
                    });
                    // Click the last one (most recently generated)
                    if (candidates.length) {
                        candidates[candidates.length - 1].click();
                        return true;
                    }
                    // Fallback: click any large visible video element
                    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
                        const r = v.getBoundingClientRect();
                        return r.width > 50 && r.height > 50;
                    });
                    if (videos.length) {
                        videos[videos.length - 1].click();
                        return true;
                    }
                    return false;
                }""")
                if clicked_tile:
                    log_info("Vista de galeria detectada. Click en tile para abrir video...")
                    page.wait_for_timeout(3000)
            except Exception:
                pass

        # Log status
        if attempt % 3 == 1:
            total = video_info.get("totalVideos", 0)
            generating = video_info.get("isGenerating", False)
            matched_previous = video_info.get("matchedPrevious", False)
            if matched_previous:
                status = "video anterior aun visible, esperando uno nuevo..."
            elif generating:
                status = "generando..."
            elif with_src and not has_dl:
                status = f"{with_src} video(s) con src, esperando boton Descargar..."
            elif ready_videos:
                status = f"{ready_videos} video(s) listos, esperando uno distinto al anterior..."
            else:
                status = f"{total} videos (sin src)"
            log_info(f"  [{attempt}] {status} | quedan {remaining}s")

        # Adaptive poll interval
        current_interval = (
            FAST_POLL_SEC if elapsed < FAST_PHASE_UNTIL
            else NORMAL_POLL_SEC if elapsed < 300
            else SLOW_POLL_SEC
        )
        page.wait_for_timeout(current_interval * 1000)

    log_error(f"Timeout ({timeout_sec}s): no se genero ningun video.")
    return None


def _download_video(page: Page, video_url: str) -> Path | None:
    """
    Descarga el video con reintentos y fallback.

    Estrategia:
    1. Intenta con Playwright context.request (tiene cookies del browser)
    2. Si falla, intenta descarga directa con urllib (mas rapido, sin overhead del browser)
    3. Verifica que el archivo sea un MP4 valido (>100KB)
    """
    import urllib.request as _urllib_request

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    match = re.search(r"name=([a-f0-9-]+)", video_url)
    video_id = match.group(1)[:12] if match else f"veo_{int(time.time())}"
    filename = f"{timestamp}_{video_id}.mp4"
    output_path = VIDEO_DIR / filename

    log_info(f"Descargando video: {video_url[:80]}...")

    # ── Strategy 1: Playwright CDP request (has browser cookies) ──
    for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
        try:
            context = page.context
            response = context.request.get(video_url, timeout=180000)  # 3 min timeout
            if not response.ok:
                log_warn(f"Intento {attempt}/{MAX_DOWNLOAD_RETRIES}: HTTP {response.status}")
                if attempt < MAX_DOWNLOAD_RETRIES:
                    time.sleep(3)
                    continue
                break

            video_bytes = response.body()
            if len(video_bytes) < 100_000:  # <100KB = probably not a real video
                log_warn(f"Intento {attempt}: archivo muy pequeño ({len(video_bytes)} bytes), reintentando...")
                if attempt < MAX_DOWNLOAD_RETRIES:
                    time.sleep(3)
                    continue
                break

            output_path.write_bytes(video_bytes)
            size_mb = len(video_bytes) / (1024 * 1024)
            log_ok(f"Video descargado via CDP: {output_path.name} ({size_mb:.1f}MB)")
            return output_path

        except Exception as e:
            log_warn(f"Intento {attempt}/{MAX_DOWNLOAD_RETRIES} fallo: {e}")
            if attempt < MAX_DOWNLOAD_RETRIES:
                time.sleep(3)
                continue

    # ── Strategy 2: Direct urllib download (faster, no browser overhead) ──
    log_info("Intentando descarga directa (sin browser)...")
    for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
        try:
            req = _urllib_request.Request(video_url, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.8",
            })
            with _urllib_request.urlopen(req, timeout=180) as resp:
                video_bytes = resp.read()

            if len(video_bytes) < 100_000:
                log_warn(f"Descarga directa intento {attempt}: archivo muy pequeño ({len(video_bytes)} bytes)")
                if attempt < MAX_DOWNLOAD_RETRIES:
                    time.sleep(3)
                    continue
                break

            output_path.write_bytes(video_bytes)
            size_mb = len(video_bytes) / (1024 * 1024)
            log_ok(f"Video descargado via HTTP directo: {output_path.name} ({size_mb:.1f}MB)")
            return output_path

        except Exception as e:
            log_warn(f"Descarga directa intento {attempt}/{MAX_DOWNLOAD_RETRIES} fallo: {e}")
            if attempt < MAX_DOWNLOAD_RETRIES:
                time.sleep(3)
                continue

    # ── Strategy 3: Extract blob URL and download via CDP evaluate ──
    log_info("Intentando extraccion via blob/fetch en el browser...")
    try:
        b64_data = page.evaluate("""(url) => {
            return fetch(url)
                .then(r => r.blob())
                .then(blob => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }));
        }""", video_url)
        if b64_data:
            import base64
            video_bytes = base64.b64decode(b64_data)
            if len(video_bytes) > 100_000:
                output_path.write_bytes(video_bytes)
                size_mb = len(video_bytes) / (1024 * 1024)
                log_ok(f"Video descargado via fetch+blob: {output_path.name} ({size_mb:.1f}MB)")
                return output_path
    except Exception as e:
        log_warn(f"Fetch+blob fallo: {e}")

    log_error("No se pudo descargar el video despues de todos los intentos.")
    return None


def _write_last_download_state(output_path: Path, video_url: str, scene_index: int) -> None:
    payload = {
        "scene_index": scene_index,
        "video_url": video_url,
        "output_path": str(output_path) if output_path else "",
        "downloaded_at": datetime.now().isoformat(),
    }
    LAST_DOWNLOAD_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    cdp_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CDP_PORT
    env_port = os.environ.get("CDP_PROFILE_PORT")
    if env_port:
        cdp_port = int(env_port)
    previous_video_url = str(os.environ.get("BOT_VIDEO_PREVIOUS_VIDEO_URL", "") or "").strip()
    scene_index = max(1, int(os.environ.get("BOT_VIDEO_ACTIVE_SCENE_INDEX", "1") or "1"))
    skip_download = str(os.environ.get("BOT_VIDEO_SKIP_DOWNLOAD", "0") or "0").strip() == "1"

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
            video_info = _poll_for_video(page, browser, previous_video_url=previous_video_url)
            if not video_info:
                return 1

            # Descargar el video
            video_url = video_info.get("src", "")
            if not video_url:
                log_error("Video encontrado pero sin URL.")
                return 1

            if skip_download:
                _write_last_download_state(None, video_url, scene_index)
                print(f"VIDEO_READY_URL={video_url}")
                return 0

            output_path = _download_video(page, video_url)
            if not output_path:
                return 1

            _write_last_download_state(output_path, video_url, scene_index)

            print(f"VIDEO_DOWNLOADED={output_path}")
            print(f"VIDEO_URL={video_url}")
            return 0

        except Exception as e:
            log_error(f"Error en download_generated_video: {e}")
            return 1
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
