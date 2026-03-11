"""Superpone el logo real de NoyeCode sobre la franja superior de una imagen publicitaria."""

import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"
LOGO_SVG = PROJECT_ROOT / "utils" / "logoapporange.svg"


def _ensure_logo_png() -> Path:
    """Verifica que el logo PNG exista (pre-generado desde el SVG)."""
    if LOGO_PNG.exists():
        return LOGO_PNG
    raise FileNotFoundError(
        f"No se encontro el logo PNG: {LOGO_PNG}. "
        f"Generalo previamente desde {LOGO_SVG} con Playwright o un editor de imagenes."
    )


def overlay_logo(image_path: str | Path) -> Path:
    """Superpone el logo sobre la imagen y sobreescribe el archivo original."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _ensure_logo_png()
    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    bg_w, bg_h = bg.size

    # El logo ocupa ~60% del ancho de la imagen, centrado en el 15% superior
    target_w = int(bg_w * 0.6)
    scale = target_w / logo.size[0]
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)

    # Centrar horizontalmente, centrar verticalmente en la franja del 15% superior
    logo_zone_h = int(bg_h * 0.15)
    x = (bg_w - target_w) // 2
    y = max(0, (logo_zone_h - target_h) // 2)

    # Pegar con transparencia
    bg.paste(logo_resized, (x, y), logo_resized)

    # Guardar como PNG (mismo archivo)
    bg.save(str(image_path), "PNG")
    return image_path


def _find_latest_image(directory: Path) -> Path:
    """Encuentra la imagen mas reciente en el directorio."""
    images = sorted(directory.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not images:
        raise FileNotFoundError(f"No hay imagenes PNG en {directory}")
    return images[0]


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python overlay_logo.py <ruta_imagen_o_directorio>")
        return 1
    target = Path(sys.argv[1])
    if target.is_dir():
        target = _find_latest_image(target)
    result = overlay_logo(target)
    print(f"LOGO_OVERLAY_APPLIED={result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
