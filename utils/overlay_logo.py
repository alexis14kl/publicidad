"""Superpone una barra de header + logo real de NoyeCode sobre una imagen publicitaria."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"
LOGO_SVG = PROJECT_ROOT / "utils" / "logoapporange.svg"

# Color de la barra superior (debe coincidir con la paleta del prompt)
HEADER_COLOR = (26, 26, 46, 255)  # #1a1a2e RGBA
HEADER_RATIO = 0.15  # 15% del alto de la imagen
LOGO_WIDTH_RATIO = 0.35  # logo ocupa 35% del ancho (antes 60%)


def _ensure_logo_png() -> Path:
    """Verifica que el logo PNG exista (pre-generado desde el SVG)."""
    if LOGO_PNG.exists():
        return LOGO_PNG
    raise FileNotFoundError(
        f"No se encontro el logo PNG: {LOGO_PNG}. "
        f"Generalo previamente desde {LOGO_SVG} con Playwright o un editor de imagenes."
    )


def overlay_logo(image_path: str | Path) -> Path:
    """Pinta la barra de header y superpone el logo sobre la imagen."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _ensure_logo_png()
    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    bg_w, bg_h = bg.size
    header_h = int(bg_h * HEADER_RATIO)

    # Pintar barra de header solida sobre la imagen (siempre queda integrada)
    draw = ImageDraw.Draw(bg)
    draw.rectangle([(0, 0), (bg_w, header_h)], fill=HEADER_COLOR)

    # Escalar logo al 35% del ancho de la imagen
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / logo.size[0]
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)

    # Limpiar pixeles semi-transparentes (anti-aliasing del SVG) que causan
    # un halo/sombra visible sobre el fondo oscuro.
    # Forzar alpha binario: opaco (>=128) o transparente (<128)
    alpha = logo_resized.split()[3]
    alpha = alpha.point(lambda a: 255 if a >= 128 else 0)
    logo_resized.putalpha(alpha)

    # Centrar horizontal y verticalmente dentro de la barra de header
    x = (bg_w - target_w) // 2
    y = max(0, (header_h - target_h) // 2)

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
