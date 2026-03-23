"""
Brochure Pipeline — Orquestador del modulo de brochures.

Flujo:
1. ChatGPT genera HTML/CSS dinamico via CDP (diseno unico cada vez)
2. Bot local inyecta logo + genera PDF via screenshot (no print mode)
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error, log_step

BROCHURE_RPA_DIR = PROJECT_ROOT / "brochure_rpa"
BROCHURES_DIR = PROJECT_ROOT / "brochures_generados"
HTML_OUTPUT = BROCHURE_RPA_DIR / "brochure_output.html"


def _resolve_logo() -> str:
    """Busca el logo en las rutas del proyecto."""
    logo = os.environ.get("BROCHURE_LOGO_PATH", "")
    if logo and Path(logo).exists():
        return logo
    p = PROJECT_ROOT / "utils" / "logoapporange.png"
    if p.exists():
        return str(p)
    for d in [PROJECT_ROOT / "utils" / "logos" / "companies", PROJECT_ROOT / "utils" / "logos"]:
        if d.exists():
            for ext in ("*.png", "*.svg", "*.jpg", "*.jpeg"):
                found = list(d.glob(ext))
                if found:
                    return str(found[0])
    return ""


def run_brochure_pipeline(cdp_port: int = 0, logo_path: str = "") -> int:
    """Ejecuta el pipeline completo de generacion de brochure."""
    if not cdp_port:
        cdp_port = int(os.environ.get("CDP_PROFILE_PORT", "9225"))

    # ── Paso 1: ChatGPT genera HTML dinamico ──
    log_step("BROCHURE 1/2", "Pegando prompt en ChatGPT y esperando HTML...")
    from brochure_rpa.brochure_setup import run_brochure_setup

    rc = run_brochure_setup(cdp_port=cdp_port, output_html=str(HTML_OUTPUT))
    if rc != 0:
        log_error("Fallo la extraccion de HTML desde ChatGPT.")
        return 1
    log_ok("HTML extraido de ChatGPT con exito.")

    # ── Paso 2: Inyectar logo y generar PDF ──
    log_step("BROCHURE 2/2", "Generando PDF...")
    if not logo_path:
        logo_path = _resolve_logo()
    if logo_path:
        log_info(f"Logo: {Path(logo_path).name}")

    from brochure_rpa.html_to_pdf import run_html_to_pdf
    rc = run_html_to_pdf(
        html_path=str(HTML_OUTPUT),
        logo_path=logo_path,
        output_dir=str(BROCHURES_DIR),
    )
    if rc != 0:
        log_error("Fallo la generacion del PDF.")
        return 1

    pdfs = sorted(BROCHURES_DIR.glob("brochure_*.pdf"), key=lambda f: f.stat().st_mtime, reverse=True)
    if pdfs:
        log_ok(f"Brochure listo: {pdfs[0].name} ({pdfs[0].stat().st_size / 1024:.1f} KB)")
        log_info(f"Ruta: {pdfs[0]}")

    return 0


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Brochure Pipeline")
    parser.add_argument("cdp_port", nargs="?", type=int, default=0)
    parser.add_argument("--logo", default="")
    args = parser.parse_args()
    return run_brochure_pipeline(cdp_port=args.cdp_port, logo_path=args.logo)


if __name__ == "__main__":
    sys.exit(main())
