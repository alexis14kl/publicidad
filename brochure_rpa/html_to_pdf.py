"""
HTML to PDF — Inyecta logo de empresa en el HTML y genera PDF.

Flujo:
1. Lee el HTML generado por ChatGPT
2. Inyecta logo de la empresa (base64 embebido)
3. Convierte a PDF usando Playwright Chromium (page.pdf())
4. Guarda en brochures_generados/

Usa Playwright headless Chromium para renderizar — mismo motor que
DiCloak, soporta CSS moderno (flexbox, grid, @page), cross-platform,
sin dependencias externas (GTK, cairo, etc).
"""
from __future__ import annotations

import base64
import os
import re
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error

BROCHURES_DIR = PROJECT_ROOT / "brochures_generados"


def _read_logo_as_base64(logo_path: str) -> str | None:
    """Lee un archivo de logo y lo convierte a data URI base64."""
    p = Path(logo_path)
    if not p.exists():
        return None

    suffix = p.suffix.lower()
    mime_map = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    mime = mime_map.get(suffix, "image/png")

    try:
        data = p.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"
    except Exception as exc:
        log_warn(f"No se pudo leer el logo: {exc}")
        return None


def _inject_premium_css(html: str) -> str:
    """Inyecta CSS profesional para pulir el brochure antes del render PDF."""
    premium_css = """
<style id="brochure-polish">
  /* ── Font & base ── */
  html, body {
    font-family: 'Segoe UI', 'Inter', -apple-system, Arial, sans-serif;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }
  /* ── Print color safety ── */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page { size: letter; margin: 0; }
  /* ── Page overflow control ── */
  .page, section { overflow: hidden; }
  /* ── Break control for clean pages ── */
  h1, h2, h3, h4 { break-after: avoid; }
  .card, .service, .benefit, .footer-card { break-inside: avoid; }
  /* ── Logo polish ── */
  img[alt="Logo"], .brochure-logo {
    max-width: 160px;
    max-height: 80px;
    object-fit: contain;
    border-radius: 12px;
  }
  /* ── Image quality ── */
  img { image-rendering: auto; }
  /* ── Typography refinements ── */
  p { orphans: 3; widows: 3; }
  /* ── Smooth gradients on decorative shapes ── */
  [class*="shape"], [class*="diag"] { will-change: transform; }
</style>
"""
    # Insertar antes de </head> para que se aplique despues de los estilos de ChatGPT
    if "</head>" in html.lower():
        idx = html.lower().index("</head>")
        html = html[:idx] + premium_css + html[idx:]
    elif "</style>" in html.lower():
        idx = html.lower().rindex("</style>") + len("</style>")
        html = html[:idx] + premium_css + html[idx:]
    else:
        html = premium_css + html
    return html


def _inject_logo_in_html(html: str, logo_data_uri: str) -> str:
    """Inyecta el logo como <img> en el HTML del brochure."""
    logo_img = (
        f'<img src="{logo_data_uri}" '
        f'alt="Logo" '
        f'style="max-width:160px;max-height:80px;object-fit:contain;border-radius:12px;" />'
    )

    # Estrategia 1: Buscar placeholder del logo
    if "{{LOGO}}" in html:
        return html.replace("{{LOGO}}", logo_img)

    # Estrategia 2: Buscar <img> con src vacio o placeholder
    html = re.sub(
        r'<img[^>]*src=["\'](?:logo|placeholder|#|about:blank)["\'][^>]*/?>',
        logo_img,
        html,
        flags=re.IGNORECASE,
    )

    # Estrategia 3: Insertar despues de <body> si no se encontro placeholder
    if logo_data_uri not in html:
        logo_block = (
            f'<div style="text-align:center;padding:16px 0;">'
            f'{logo_img}'
            f'</div>'
        )
        if "<body" in html.lower():
            html = re.sub(
                r'(<body[^>]*>)',
                rf'\1\n{logo_block}',
                html,
                count=1,
                flags=re.IGNORECASE,
            )
        else:
            html = logo_block + "\n" + html

    return html


def _ensure_full_html(html: str) -> str:
    """Asegura que el HTML tenga estructura completa."""
    lower = html.strip().lower()
    if lower.startswith("<!doctype") or lower.startswith("<html"):
        return html

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brochure</title>
</head>
<body>
{html}
</body>
</html>"""


def run_html_to_pdf(
    html_path: str,
    logo_path: str = "",
    output_dir: str = "",
) -> int:
    """Convierte HTML a PDF inyectando logo."""
    html_file = Path(html_path)
    if not html_file.exists():
        log_error(f"No existe el archivo HTML: {html_file}")
        return 1

    html = html_file.read_text(encoding="utf-8").strip()
    if not html:
        log_error("El archivo HTML esta vacio.")
        return 1

    # Asegurar HTML completo
    html = _ensure_full_html(html)

    # Inyectar CSS premium para pulir el render
    html = _inject_premium_css(html)
    log_info("CSS premium inyectado.")

    # Inyectar logo si se proporciono
    if logo_path:
        logo_data_uri = _read_logo_as_base64(logo_path)
        if logo_data_uri:
            html = _inject_logo_in_html(html, logo_data_uri)
            log_ok("Logo inyectado en el HTML.")
        else:
            log_warn(f"No se pudo cargar el logo desde: {logo_path}")

    # Directorio de salida
    out_dir = Path(output_dir) if output_dir else BROCHURES_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    pdf_name = f"brochure_{timestamp}.pdf"
    pdf_path = out_dir / pdf_name

    # Generar PDF con Playwright Chromium (headless)
    # Mismo motor que DiCloak, soporta CSS moderno, cross-platform
    try:
        from playwright.sync_api import sync_playwright
        log_info("Generando PDF con Playwright Chromium...")

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            # Viewport a tamaño Letter (8.5x11in @ 96dpi) para render consistente
            page = browser.new_page(viewport={"width": 816, "height": 1056})
            page.set_content(html, wait_until="networkidle")
            # Esperar a que todos los paints de CSS se completen
            page.wait_for_timeout(1500)
            page.pdf(
                path=str(pdf_path),
                format="Letter",
                print_background=True,
                prefer_css_page_size=True,
                scale=1,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
            browser.close()

        if pdf_path.exists() and pdf_path.stat().st_size > 0:
            log_ok(f"PDF generado: {pdf_path} ({pdf_path.stat().st_size / 1024:.1f} KB)")
            return 0
        else:
            log_error("Playwright no genero un PDF valido.")
            return 1

    except ImportError:
        log_error("Playwright no esta instalado. Ejecuta: pip install playwright && playwright install chromium")
        return 1
    except Exception as exc:
        log_error(f"Error generando PDF: {exc}")
        return 1


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="HTML to PDF - Inyectar logo y generar PDF")
    parser.add_argument("--html", required=True, help="Ruta al archivo HTML")
    parser.add_argument("--logo", default="", help="Ruta al logo (SVG/PNG/JPG)")
    parser.add_argument("--output-dir", default="", help="Directorio de salida")
    args = parser.parse_args()

    return run_html_to_pdf(
        html_path=args.html,
        logo_path=args.logo,
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    sys.exit(main())
