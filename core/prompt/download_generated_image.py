from __future__ import annotations

import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.cfg.platform import IMG_PUBLICITARIAS_DIR
DEFAULT_CDP_PORT = 9225
DEFAULT_WAIT_TIMEOUT_SEC = 300
DEFAULT_POLL_INTERVAL_SEC = 2


def build_filename(source_url: str) -> str:
    parsed = urlparse(source_url)
    file_id_match = re.search(r"id=([^&]+)", parsed.query or "")
    file_id = file_id_match.group(1) if file_id_match else f"img_{int(time.time())}"
    safe_file_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", file_id)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{safe_file_id}.png"


def get_latest_downloadable_image_info(page) -> dict:
    return page.evaluate(
        """() => {
            const comparisonButtons = Array.from(
                document.querySelectorAll('button,[role="button"],label')
            ).filter((el) =>
                /la imagen 1 es mejor|image 1 is better|que imagen te gusta mas|which image do you prefer/i.test(
                    (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim()
                )
            );

            const blockHasDownloadButton = (block) =>
                Array.from(block.querySelectorAll('button,[role="button"],a')).some((el) =>
                    /descargar esta imagen|download this image/i.test((el.innerText || el.getAttribute('aria-label') || '').trim())
                );

            const blockHasImageCreatedText = (block) =>
                /imagen creada|image created/i.test(block.innerText || '');

            const blockHasImageGenOverlay = (block) =>
                block.querySelector('[data-testid="image-gen-overlay-actions"]') !== null;

            // Tomar solo los últimos 2 turns (el más reciente primero)
            // Evita tomar la imagen de un turn anterior
            const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]'));
            const messages = Array.from(document.querySelectorAll('[data-message-id]'));
            const articles = Array.from(document.querySelectorAll('article'));
            const allBlocks = turns.length > 0 ? turns : messages.length > 0 ? messages : articles;
            // Solo los últimos 2 bloques (el response más reciente)
            const candidates = allBlocks.slice(-2).reverse();

            const targetBlock = candidates.find((block) =>
                blockHasDownloadButton(block) || blockHasImageGenOverlay(block) || blockHasImageCreatedText(block)
            );
            if (!targetBlock) {
                return {
                    foundArticle: false,
                    hasDownloadButton: false,
                    imageUrl: '',
                    articleText: '',
                    hasComparisonChoice: comparisonButtons.length > 0,
                };
            }

            const imgs = Array.from(targetBlock.querySelectorAll('img'));
            const matchingUrls = imgs
                .map((img) => img.currentSrc || img.src || '')
                .filter((src) => src.includes('/backend-api/estuary/content'));

            return {
                foundArticle: true,
                hasDownloadButton: blockHasDownloadButton(targetBlock),
                imageUrl: matchingUrls[matchingUrls.length - 1] || '',
                articleText: (targetBlock.innerText || '').slice(0, 400),
                hasComparisonChoice: comparisonButtons.length > 0,
            };
        }"""
    )


def resolve_image_comparison(page) -> bool:
    return page.evaluate(
        """() => {
            const candidates = Array.from(document.querySelectorAll('button,[role="button"],label'));
            const pick = candidates.find((el) =>
                /la imagen 1 es mejor|image 1 is better/i.test(
                    (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim()
                )
            );
            if (!pick) return false;
            pick.click();
            return true;
        }"""
    )


def wait_for_downloadable_image(page, timeout_sec: int = DEFAULT_WAIT_TIMEOUT_SEC, poll_interval_sec: int = DEFAULT_POLL_INTERVAL_SEC) -> str:
    deadline = time.time() + timeout_sec
    last_info: dict | None = None
    comparison_resolved = False

    while time.time() < deadline:
        info = get_latest_downloadable_image_info(page)
        last_info = info
        if info.get("hasComparisonChoice") and not comparison_resolved:
            if resolve_image_comparison(page):
                comparison_resolved = True
                page.wait_for_timeout(2500)
                continue
        if info.get("foundArticle") and info.get("hasDownloadButton") and info.get("imageUrl"):
            return str(info["imageUrl"]).strip()
        page.wait_for_timeout(int(poll_interval_sec * 1000))

    detail = ""
    if last_info:
        detail = f" Estado final: {last_info}"
    raise RuntimeError(f"No aparecio una imagen descargable dentro del tiempo de espera.{detail}")


def main() -> int:
    cdp_port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CDP_PORT
    IMG_PUBLICITARIAS_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
        try:
            context = browser.contexts[0]
            pages = [page for page in context.pages if (page.url or "").startswith("https://chatgpt.com/")]
            if not pages:
                raise RuntimeError("No hay pagina de ChatGPT abierta para descargar la imagen")

            page = pages[-1]
            page.bring_to_front()

            image_url = wait_for_downloadable_image(page)

            if not image_url:
                raise RuntimeError("No se encontro la URL de la imagen generada")

            # Descarga con retry y chunks para equipos lentos o conexiones inestables
            output_path = IMG_PUBLICITARIAS_DIR / build_filename(image_url)
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    response = context.request.get(image_url, timeout=120000)
                    if not response.ok:
                        raise RuntimeError(f"HTTP {response.status}")
                    image_bytes = response.body()
                    if len(image_bytes) < 1000:
                        raise RuntimeError(f"Imagen muy pequeña ({len(image_bytes)} bytes), posible error")
                    output_path.write_bytes(image_bytes)
                    print(f"IMAGE_DOWNLOADED={output_path}")
                    print(f"IMAGE_SIZE={len(image_bytes)}")
                    return 0
                except Exception as e:
                    if attempt < max_retries - 1:
                        print(f"[WARN] Intento {attempt + 1} falló: {e}. Reintentando en 3s...")
                        time.sleep(3)
                    else:
                        raise RuntimeError(f"No se pudo descargar la imagen después de {max_retries} intentos: {e}")
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
