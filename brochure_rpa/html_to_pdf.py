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
    """Quita el CSS de ChatGPT y pone CSS profesional para PDF."""
    # Colores de empresa desde env
    c1 = os.environ.get("BROCHURE_COLOR_PRIMARIO", "#3469ED")
    c2 = os.environ.get("BROCHURE_COLOR_ACENTO", "#00bcd4")
    c3 = os.environ.get("BROCHURE_COLOR_CTA", "#fd9102")
    c4 = os.environ.get("BROCHURE_COLOR_CHECKS", "#28a745")
    bg = os.environ.get("BROCHURE_COLOR_FONDO", "#f4f6fa")

    # Quitar TODO el CSS de ChatGPT
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.IGNORECASE | re.DOTALL)

    # CSS profesional para PDF con colores de empresa
    print_css = f"""<style>
@page {{ size: letter; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
html, body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 13px; line-height: 1.6; background: {bg}; }}

/* ── Paginas ── */
section {{ padding: 40px 46px; }}
section + section {{ page-break-before: always; }}
section::before {{ content: ''; display: block; height: 7px; margin: -40px -46px 24px; background: linear-gradient(90deg, {c1}, {c2}, {c3}); }}

/* ── Esconder decoraciones absolutas ── */
div[class*="shape"], div[class*="deco"], div[class*="diag"],
div[class*="pattern"], div[class*="overlay"], div[class*="dot"],
div[class*="bars"], div[class*="monitor-header"] span,
div[class*="line"] {{ display: none !important; }}

/* ── Logo ── */
img[alt="Logo"] {{ max-width: 110px; max-height: 60px; object-fit: contain; border-radius: 14px; background: #fff; padding: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.08); border: 1px solid rgba(0,0,0,0.05); margin-bottom: 12px; }}

/* ── Tipografia ── */
h1 {{ font-size: 30px; font-weight: 900; color: {c1}; margin-bottom: 8px; line-height: 1.08; letter-spacing: -0.5px; }}
h2 {{ font-size: 22px; font-weight: 800; color: #0f172a; margin: 16px 0 8px; line-height: 1.12; }}
h3 {{ font-size: 15px; font-weight: 700; color: {c1}; margin: 12px 0 6px; }}
h4 {{ font-size: 13px; font-weight: 700; color: #0f172a; margin: 6px 0 4px; }}
p {{ margin-bottom: 8px; color: #475569; line-height: 1.65; }}
small {{ font-size: 11px; color: #64748b; }}
blockquote {{ font-style: italic; margin: 0; }}
.accent {{ color: {c1}; }}

/* ── Small note (folleto corporativo) ── */
.small-note {{ font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #94a3b8; margin-bottom: 16px; }}

/* ── Brand section ── */
.brand {{ margin-bottom: 20px; }}
.brand-badge {{ display: inline-block; padding: 8px 18px; border-radius: 999px; background: linear-gradient(135deg, {c3}, {c3}dd); color: #fff; font-size: 12px; font-weight: 700; margin-top: 8px; box-shadow: 0 4px 14px rgba(253,145,2,0.2); }}

/* ── Hero ── */
.hero {{ margin-bottom: 18px; }}
.hero h1 {{ font-size: 32px; margin-bottom: 12px; }}

/* ── Kicker / Eyebrow ── */
.kicker, .eyebrow, span[class*="kicker"], span[class*="badge"] {{ display: inline-block; padding: 5px 16px; border-radius: 999px; background: {c2}18; color: {c2}; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 12px; }}

/* ── CTA buttons ── */
.cta, span[class*="cta"], span[class*="btn"], .cta-chip, .footer-pill {{ display: inline-block; padding: 11px 24px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 12px; margin: 4px 6px 4px 0; background: {c3}; box-shadow: 0 5px 16px rgba(253,145,2,0.22); }}
.cta-note {{ font-size: 12px; color: #64748b; margin-left: 4px; }}

/* ── Cards genericas ── */
div[class*="card"], div[class*="highlights"] > div {{ background: #fff; border: 1px solid #e8ecf2; border-radius: 16px; padding: 18px 20px; margin-bottom: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); page-break-inside: avoid; }}

/* ── Visual panel ── */
.visual, div[class*="visual"] {{ background: linear-gradient(150deg, {c1}, {c1}bb, {c2}88); color: #fff; border: none !important; border-radius: 18px; padding: 22px; margin-bottom: 16px; }}
.visual h2, .visual h3, div[class*="visual"] h2, div[class*="visual"] h3 {{ color: #fff; }}
.visual p, .visual span, .visual strong, div[class*="visual"] p {{ color: rgba(255,255,255,0.9); }}
.visual-card {{ padding: 16px; }}

/* ── Monitor / Dashboard ── */
.monitor {{ background: rgba(255,255,255,0.1); border-radius: 12px; padding: 14px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.15); }}
.dashboard {{ display: block; }}
.chart-card {{ margin-bottom: 10px; }}
.stats-col {{ display: block; }}
.stats-card, div[class*="stat"] {{ background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }}
.stats-card strong, div[class*="stat"] strong {{ display: block; font-size: 18px; color: #fff; margin-bottom: 2px; }}
.stats-card span, div[class*="stat"] span {{ font-size: 11px; color: rgba(255,255,255,0.8); }}

/* ── Floating badges en visual ── */
.floating {{ background: rgba(255,255,255,0.15); border-radius: 10px; padding: 8px 14px; margin: 6px 0; border: 1px solid rgba(255,255,255,0.12); }}
.floating .label {{ font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: rgba(255,255,255,0.7); }}
.floating .value {{ font-size: 12px; font-weight: 600; color: #fff; }}

/* ── Metric strip ── */
.metric-strip {{ display: block; margin-top: 10px; }}
.metric {{ display: inline-block; padding: 6px 14px; border-radius: 999px; background: {c1}0d; color: {c1}; font-size: 11px; font-weight: 700; margin: 3px 4px 3px 0; }}

/* ── Tags ── */
span[class*="tag"] {{ display: inline-block; padding: 5px 14px; border-radius: 999px; background: {c1}0d; color: {c1}; font-size: 10px; font-weight: 700; margin: 3px; }}

/* ── Listas ── */
ul {{ list-style: none; padding: 0; }}
li {{ position: relative; padding-left: 24px; margin-bottom: 8px; font-size: 13px; color: #334155; line-height: 1.55; }}
li::before {{ content: "\\2713"; position: absolute; left: 0; color: {c4}; font-weight: 900; font-size: 14px; }}
li .icon {{ position: absolute; left: 0; color: {c4}; font-weight: 900; }}

/* ── Footer band (pagina 1) ── */
.footer-band {{ background: #0f172a; border-radius: 16px; padding: 22px 26px; color: #fff; margin-top: 18px; page-break-inside: avoid; }}
.footer-title {{ font-size: 16px; font-weight: 800; color: #fff; margin-bottom: 6px; }}
.footer-copy {{ font-size: 12px; color: rgba(255,255,255,0.75); line-height: 1.6; margin-bottom: 8px; }}
.footer-info {{ margin-top: 8px; }}
.footer-info div {{ margin-bottom: 4px; font-size: 12px; color: rgba(255,255,255,0.8); }}
.footer-info strong {{ color: {c2}; margin-right: 8px; }}
.footer-pill {{ background: {c3}; margin-top: 10px; }}

/* ── Page 2: Back ── */
.back-header {{ margin-bottom: 18px; }}
.section-title {{ margin-bottom: 14px; }}
.mini-brand {{ background: #fff; border: 1px solid #e8ecf2; border-radius: 14px; padding: 16px; margin-bottom: 14px; box-shadow: 0 3px 12px rgba(0,0,0,0.04); }}
.mini-brand img {{ max-width: 80px; margin-bottom: 8px; }}
.brand-text {{ font-size: 12px; color: #64748b; line-height: 1.55; }}

/* ── Services grid ── */
.services {{ margin-bottom: 14px; }}
.service {{ background: #fff; border: 1px solid #e8ecf2; border-radius: 14px; padding: 14px 16px; margin-bottom: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.03); page-break-inside: avoid; }}
.service .ico {{ display: inline-block; width: 32px; height: 32px; border-radius: 8px; background: {c1}12; color: {c1}; text-align: center; line-height: 32px; font-size: 16px; margin-bottom: 6px; margin-right: 8px; }}
.service h3 {{ font-size: 14px; margin: 4px 0; }}
.service p {{ font-size: 12px; margin-bottom: 0; }}

/* ── Benefits panel ── */
.benefits-panel {{ background: linear-gradient(145deg, {c1}, {c1}cc); border-radius: 16px; padding: 20px 22px; color: #fff; margin-bottom: 14px; page-break-inside: avoid; }}
.benefits-panel h3 {{ color: #fff; font-size: 18px; }}
.benefits-panel .lead {{ color: rgba(255,255,255,0.85); font-size: 12px; margin-bottom: 12px; }}
.benefit {{ background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; color: #fff; }}
.benefit .b-ico {{ font-size: 14px; margin-right: 6px; display: inline; }}
.benefit h4 {{ color: #fff; display: inline; font-size: 13px; }}
.benefit p {{ color: rgba(255,255,255,0.82); font-size: 12px; margin: 4px 0 0; }}

/* ── Quote / Testimonial ── */
.quote {{ margin-bottom: 14px; }}
.quote-card {{ background: #fff; border: 1px solid #e8ecf2; border-radius: 16px; padding: 18px 20px; margin-bottom: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.04); }}
.quote-card h3 {{ color: {c1}; }}
.quote-card blockquote {{ font-size: 13px; color: #475569; line-height: 1.7; }}
.author {{ font-size: 11px; color: #94a3b8; margin-top: 8px; }}

/* ── Stat boxes ── */
.stat-box, .quote-stats .stat-box {{ background: #fff; border: 1px solid #e8ecf2; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }}
.stat-box {{ color: #1e293b !important; }}
.stat-box strong {{ color: {c1} !important; font-size: 22px; font-weight: 900; margin-right: 10px; display: inline-block; }}
.stat-box span {{ font-size: 12px; color: #1e293b !important; font-weight: 500; }}
.quote-stats .stat-box {{ border-left: 4px solid {c1}; }}
.quote-stats {{ color: #1e293b; }}

/* ── Contact footer (pagina 2) ── */
.contact-footer {{ background: #0f172a; border-radius: 16px; padding: 22px 26px; color: #fff; margin-top: 14px; page-break-inside: avoid; }}
.contact-title {{ font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 6px; }}
.contact-sub {{ font-size: 12px; color: rgba(255,255,255,0.72); line-height: 1.6; margin-bottom: 12px; }}
.contact-item {{ margin-bottom: 6px; font-size: 12px; }}
.contact-item strong {{ color: {c2}; margin-right: 8px; display: inline-block; min-width: 80px; }}
.contact-item span {{ color: rgba(255,255,255,0.82); }}
.contact-grid {{ display: block; }}

/* ── Generic strong/b in cards ── */
strong {{ font-weight: 700; }}
b {{ color: {c1}; }}

/* ── Anti-corte entre paginas ── */
.service, .benefit, .stat-box, .floating,
div[class*="card"], .quote-card, .mini-brand,
.footer-band, .contact-footer, .benefits-panel {{
  page-break-inside: avoid;
  break-inside: avoid;
}}
h1, h2, h3, h4 {{ page-break-after: avoid; break-after: avoid; }}
p {{ orphans: 3; widows: 3; }}
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
