"""
Brochure Pipeline — Orquestador del modulo de brochures.

Flujo completo:
1. brochure_setup.py → CDP ChatGPT, pega prompt, extrae HTML
2. html_to_pdf.py → Inyecta logo, genera PDF con weasyprint

Se ejecuta como subprocess desde el IPC de Electron o desde post_opening.
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


def run_brochure_pipeline(cdp_port: int = 0, logo_path: str = "") -> int:
    """Ejecuta el pipeline completo de generacion de brochure."""

    if not cdp_port:
        cdp_port = int(os.environ.get("CDP_PROFILE_PORT", "9225"))

    # ── Paso 1: Pegar prompt en ChatGPT y extraer HTML ──
    log_step("BROCHURE 1/2", "Pegando prompt en ChatGPT y esperando HTML...")
    from brochure_rpa.brochure_setup import run_brochure_setup

    rc = run_brochure_setup(cdp_port=cdp_port, output_html=str(HTML_OUTPUT))
    if rc != 0:
        log_error("Fallo la extraccion de HTML desde ChatGPT.")
        return 1
    log_ok("HTML extraido de ChatGPT con exito.")

    # ── Paso 2: Inyectar logo y generar PDF ──
    log_step("BROCHURE 2/2", "Generando PDF con logo...")

    # Resolver logo si no se paso explicitamente
    if not logo_path:
        logo_path = os.environ.get("BROCHURE_LOGO_PATH", "")
    if not logo_path:
        # Buscar logo activo en las rutas del proyecto
        try:
            from cfg.platform import PROJECT_ROOT as PR

            # 1. Logo activo principal (utils/logoapporange.png)
            active_logo = PR / "utils" / "logoapporange.png"
            if active_logo.exists():
                logo_path = str(active_logo)
                log_info(f"Logo encontrado: {active_logo.name}")

            # 2. Logo de empresa en utils/logos/companies/
            if not logo_path:
                company_logos = PR / "utils" / "logos" / "companies"
                if company_logos.exists():
                    for ext in ("*.png", "*.svg", "*.jpg", "*.jpeg", "*.webp"):
                        found = list(company_logos.glob(ext))
                        if found:
                            logo_path = str(found[0])
                            log_info(f"Logo empresa encontrado: {found[0].name}")
                            break

            # 3. Cualquier logo en utils/logos/
            if not logo_path:
                logos_dir = PR / "utils" / "logos"
                if logos_dir.exists():
                    for ext in ("*.png", "*.svg", "*.jpg", "*.jpeg", "*.webp"):
                        found = list(logos_dir.glob(ext))
                        if found:
                            logo_path = str(found[0])
                            log_info(f"Logo fallback encontrado: {found[0].name}")
                            break

            if not logo_path:
                log_warn("No se encontro ningun logo en el proyecto.")
        except Exception as exc:
            log_warn(f"Error buscando logo: {exc}")

    from brochure_rpa.html_to_pdf import run_html_to_pdf

    rc = run_html_to_pdf(
        html_path=str(HTML_OUTPUT),
        logo_path=logo_path,
        output_dir=str(BROCHURES_DIR),
    )
    if rc != 0:
        log_error("Fallo la generacion del PDF.")
        return 1

    # Log del PDF generado
    pdfs = sorted(BROCHURES_DIR.glob("brochure_*.pdf"), key=lambda f: f.stat().st_mtime, reverse=True)
    if pdfs:
        pdf = pdfs[0]
        log_ok(f"Brochure generado: {pdf.name} ({pdf.stat().st_size / 1024:.1f} KB)")
        log_info(f"Ruta: {pdf}")

    return 0


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Brochure Pipeline")
    parser.add_argument("cdp_port", nargs="?", type=int, default=0)
    parser.add_argument("--logo", default="", help="Ruta al logo")
    args = parser.parse_args()

    return run_brochure_pipeline(cdp_port=args.cdp_port, logo_path=args.logo)


if __name__ == "__main__":
    sys.exit(main())
