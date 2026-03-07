import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


PROJECT_ROOT = Path(__file__).resolve().parent.parent
IMG_PUBLICITARIAS_DIR = PROJECT_ROOT / "img_publicitarias"
DEFAULT_CDP_PORT = 9225


def build_filename(source_url: str) -> str:
    parsed = urlparse(source_url)
    file_id_match = re.search(r"id=([^&]+)", parsed.query or "")
    file_id = file_id_match.group(1) if file_id_match else f"img_{int(time.time())}"
    safe_file_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", file_id)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{safe_file_id}.png"


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

            page.wait_for_function(
                """() => {
                    const imgs = Array.from(document.querySelectorAll('img'));
                    return imgs.some((img) =>
                        (img.alt || '').toLowerCase().includes('imagen generada') &&
                        (img.currentSrc || img.src || '').includes('/backend-api/estuary/content')
                    );
                }""",
                timeout=60000,
            )

            image_url = page.evaluate(
                """() => {
                    const imgs = Array.from(document.querySelectorAll('img'));
                    const matches = imgs.filter((img) =>
                        (img.alt || '').toLowerCase().includes('imagen generada') &&
                        (img.currentSrc || img.src || '').includes('/backend-api/estuary/content')
                    );
                    const selected = matches[matches.length - 1];
                    return selected ? (selected.currentSrc || selected.src || '') : '';
                }"""
            )

            if not image_url:
                raise RuntimeError("No se encontro la URL de la imagen generada")

            response = context.request.get(image_url, timeout=60000)
            if not response.ok:
                raise RuntimeError(f"No se pudo descargar la imagen generada: HTTP {response.status}")

            output_path = IMG_PUBLICITARIAS_DIR / build_filename(image_url)
            output_path.write_bytes(response.body())
            print(f"IMAGE_DOWNLOADED={output_path}")
            return 0
        finally:
            browser.close()


if __name__ == "__main__":
    raise SystemExit(main())
