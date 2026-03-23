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


def _replace_css_for_print(html: str) -> str:
    """Quita el CSS de ChatGPT y pone CSS propio que funciona en PDF."""
    # Quitar TODO el CSS de ChatGPT
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.IGNORECASE | re.DOTALL)

    # CSS profesional para PDF que funciona con Edge/Chromium print
    print_css = """<style>
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.55; background: #f4f6fa; }
body { padding: 0; }

/* Pagina */
section { padding: 44px 48px; page-break-inside: avoid; }
section + section { page-break-before: always; }

/* Topbar decorativo */
section::before {
  content: ''; display: block; height: 6px; margin: -44px -48px 28px;
  background: linear-gradient(90deg, var(--c1, #3469ED), var(--c2, #00bcd4), var(--c3, #fd9102));
}

/* Variables de color */
:root {
  --c1: #3469ED; --c2: #00bcd4; --c3: #fd9102; --c4: #28a745; --bg: #f4f6fa;
}

/* Logo + empresa */
img[alt="Logo"] { max-width: 100px; max-height: 56px; object-fit: contain; border-radius: 12px; background: #fff; padding: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); display: block; margin-bottom: 14px; }

/* Titulos */
h1 { font-size: 28px; font-weight: 800; color: var(--c1); margin-bottom: 6px; line-height: 1.1; }
h2 { font-size: 22px; font-weight: 800; color: #0f172a; margin: 18px 0 10px; line-height: 1.15; }
h3 { font-size: 16px; font-weight: 700; color: var(--c1); margin: 14px 0 8px; }
h4 { font-size: 14px; font-weight: 700; color: #0f172a; margin: 8px 0 4px; }
p { margin-bottom: 10px; color: #475569; }
small { font-size: 12px; color: #64748b; }

/* Badges/kickers */
span[class] { display: inline-block; }

/* Cards */
div[class*="card"], div[class*="visual"], div[class*="service"],
div[class*="benefit"], div[class*="quote"], div[class*="testimonial"],
div[class*="stat"], div[class*="mini"], div[class*="note"] {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  padding: 16px 18px; margin-bottom: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.04);
  page-break-inside: avoid;
}

/* Visual panel (gradiente) */
div[class*="visual"] {
  background: linear-gradient(145deg, var(--c1), #1a3a8a);
  color: #fff; border: none;
}
div[class*="visual"] h2, div[class*="visual"] h3 { color: #fff; }
div[class*="visual"] p, div[class*="visual"] span { color: rgba(255,255,255,0.88); }
div[class*="visual"] div[class*="stat"] { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.18); }
div[class*="visual"] div[class*="stat"] strong { color: #fff; }
div[class*="visual"] div[class*="stat"] span { color: rgba(255,255,255,0.8); }

/* Testimonial */
div[class*="testimonial"], div[class*="quote"] {
  background: linear-gradient(135deg, var(--c1), var(--c2));
  color: #fff; border: none; font-style: italic;
}
div[class*="testimonial"] h3, div[class*="quote"] h3 { color: #fff; font-style: normal; }
div[class*="testimonial"] p, div[class*="quote"] p { color: #fff; }

/* Footer oscuro */
div[class*="footer"] {
  background: #0f172a; color: #fff; border: none; border-radius: 16px;
  padding: 22px 24px; margin-top: 16px;
}
div[class*="footer"] h2, div[class*="footer"] h3 { color: #fff; }
div[class*="footer"] p, div[class*="footer"] span { color: rgba(255,255,255,0.80); }
div[class*="footer"] b { color: var(--c2); }

/* Botones CTA */
span[class*="cta"], span[class*="btn"], a[class*="cta"], a[class*="btn"] {
  display: inline-block; padding: 10px 22px; border-radius: 999px;
  color: #fff; font-weight: 700; font-size: 12px; margin: 4px 4px 4px 0;
  text-decoration: none;
}
span[class*="cta"]:first-of-type, a[class*="btn"]:first-of-type,
span[class*="btn-primary"], span[class*="cta-1"] { background: var(--c3); box-shadow: 0 4px 12px rgba(253,145,2,0.25); }
span[class*="cta"]:nth-of-type(2), span[class*="btn-secondary"],
span[class*="cta-2"], span[class*="btn2"] { background: var(--c1); box-shadow: 0 4px 12px rgba(52,105,237,0.2); }
div[class*="footer"] span[class*="cta"] { background: var(--c3); }

/* Tags */
span[class*="tag"] {
  display: inline-block; padding: 5px 12px; border-radius: 999px;
  background: rgba(52,105,237,0.08); color: var(--c1);
  font-size: 10px; font-weight: 700; margin: 2px;
}

/* Badges/kickers */
span[class*="kicker"], span[class*="badge"] {
  display: inline-block; padding: 4px 14px; border-radius: 999px;
  background: rgba(0,188,212,0.10); color: var(--c2);
  font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  margin-bottom: 10px;
}

/* Listas check */
ul { list-style: none; padding: 0; }
li { position: relative; padding-left: 22px; margin-bottom: 7px; font-size: 13px; color: #334155; }
li::before { content: "\\2713"; position: absolute; left: 0; color: var(--c4); font-weight: 900; }

/* Contact grid */
div[class*="contact"] div, div[class*="info-grid"] div { margin-bottom: 4px; font-size: 12px; }
b { color: var(--c1); }

/* Icons */
div[class*="icon"] {
  width: 36px; height: 36px; border-radius: 10px; margin-bottom: 8px;
  background: rgba(52,105,237,0.10); color: var(--c1);
  display: inline-block; text-align: center; line-height: 36px;
  font-size: 16px; font-weight: 900;
}

/* Utility: esconder decoraciones absolutas que no se ven en print */
div[class*="shape"], div[class*="deco"], div[class*="diag"],
div[class*="pattern"], div[class*="overlay"] { display: none; }
</style>"""

    # Insertar antes de </head>
    if "</head>" in html.lower():
        idx = html.lower().index("</head>")
        html = html[:idx] + print_css + html[idx:]
    else:
        html = print_css + html

    return html


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
  /* ── Print: forzar colores y quitar clipping ── */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page { size: letter; margin: 0; }
  /* ── CRITICO: no ocultar contenido ── */
  .page, section, [class*="page"] {
    overflow: visible !important;
    min-height: 11in;
  }
  /* ── Break control ── */
  h1, h2, h3, h4 { break-after: avoid; }
  .card, .service, .benefit, .footer-card { break-inside: avoid; }
  /* ── Logo polish ── */
  img[alt="Logo"], .brochure-logo {
    max-width: 160px;
    max-height: 80px;
    object-fit: contain;
    border-radius: 12px;
  }
  img { image-rendering: auto; }
  p { orphans: 3; widows: 3; }
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
    """Reemplaza el placeholder <img src="logo"> con el logo real en base64."""
    # Reemplazar SOLO el src del img, manteniendo todos los estilos y atributos originales
    # Esto preserva el layout del brochure tal como ChatGPT lo diseño
    count = 0

    def _replace_src(match: re.Match) -> str:
        nonlocal count
        count += 1
        tag = match.group(0)
        # Reemplazar solo el src, mantener el resto del tag intacto
        return re.sub(
            r'src=["\'](?:logo|placeholder|#|about:blank)["\']',
            f'src="{logo_data_uri}"',
            tag,
            flags=re.IGNORECASE,
        )

    # Buscar todos los <img> con src="logo" y reemplazar solo el src
    html = re.sub(
        r'<img[^>]*src=["\'](?:logo|placeholder|#|about:blank)["\'][^>]*/?>',
        _replace_src,
        html,
        flags=re.IGNORECASE,
    )

    if count > 0:
        log_info(f"Logo reemplazado en {count} ubicacion(es).")
        return html

    # Fallback: buscar {{LOGO}} placeholder
    if "{{LOGO}}" in html:
        logo_img = f'<img src="{logo_data_uri}" alt="Logo" style="max-width:160px;max-height:80px;object-fit:contain;" />'
        return html.replace("{{LOGO}}", logo_img)

    log_warn("No se encontro placeholder de logo en el HTML. El brochure se genera sin logo.")
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

    # Reemplazar CSS de ChatGPT con CSS propio que funciona en PDF
    html = _replace_css_for_print(html)
    log_info("CSS reemplazado para compatibilidad PDF.")

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

    # Generar PDF usando Microsoft Edge headless (Chromium del sistema)
    # Soporta CSS moderno completo, viene con Windows, sin dependencias extra
    import subprocess
    import shutil

    # Guardar HTML en archivo temporal
    tmp_html = out_dir / f"_tmp_{timestamp}.html"
    tmp_html.write_text(html, encoding="utf-8")
    html_url = f"file:///{str(tmp_html).replace(os.sep, '/')}"

    # Buscar Edge o Chrome
    browser_exe = None
    candidates = [
        shutil.which("msedge"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        shutil.which("chrome"),
        shutil.which("google-chrome"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if c and Path(c).exists():
            browser_exe = str(c)
            break

    if not browser_exe:
        log_error("No se encontro Microsoft Edge ni Chrome en el sistema.")
        tmp_html.unlink(missing_ok=True)
        return 1

    log_info(f"Usando: {Path(browser_exe).name}")
    log_info(f"Generando PDF desde: {tmp_html.name}")

    try:
        cmd = [
            browser_exe,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--run-all-compositor-stages-before-draw",
            "--disable-features=PaintHolding",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer",
            "--print-to-pdf-no-header",
            html_url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if result.returncode != 0 and result.stderr:
            log_warn(f"Browser stderr: {result.stderr[:200]}")

    except subprocess.TimeoutExpired:
        log_error("Timeout generando PDF.")
        tmp_html.unlink(missing_ok=True)
        return 1
    except Exception as exc:
        log_error(f"Error ejecutando browser: {exc}")
        tmp_html.unlink(missing_ok=True)
        return 1

    # Limpiar HTML temporal
    tmp_html.unlink(missing_ok=True)

    if pdf_path.exists() and pdf_path.stat().st_size > 0:
        log_ok(f"PDF generado: {pdf_path} ({pdf_path.stat().st_size / 1024:.1f} KB)")
        return 0

    log_error("El browser no genero el PDF.")
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
