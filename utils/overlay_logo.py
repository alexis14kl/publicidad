"""Superpone el logo real de NoyeCode sobre la imagen publicitaria.

Solo pega el logo con transparencia limpia encima de la imagen.
No modifica el fondo, no pinta, no aplica blur ni efectos.
"""

import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"

LOGO_WIDTH_RATIO = 0.25  # logo ocupa 25% del ancho (mas pequeno)
HEADER_RATIO = 0.15  # zona superior donde va centrado el logo
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1350


def _fit_to_target(img: Image.Image, tw: int, th: int) -> Image.Image:
    """Recorta/escala la imagen para que llene exactamente tw x th."""
    w, h = img.size
    if w == tw and h == th:
        return img
    scale = max(tw / w, th / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - tw) // 2
    top = (new_h - th) // 2
    return img.crop((left, top, left + tw, top + th))


def overlay_logo(image_path: str | Path) -> Path:
    """Pega el logo centrado en la zona superior de la imagen. Sin modificar el fondo."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")
    if not LOGO_PNG.exists():
        raise FileNotFoundError(f"Logo no encontrado: {LOGO_PNG}")

    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(LOGO_PNG).convert("RGBA")

    # Forzar 1080x1350 (4:5) para FB/IG
    bg = _fit_to_target(bg, TARGET_WIDTH, TARGET_HEIGHT)
    bg_w, bg_h = bg.size

    # Escalar logo
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / logo.size[0]
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)

    # Limpiar pixeles semi-transparentes del anti-aliasing (binario: visible o no)
    alpha = logo_resized.split()[3]
    alpha = alpha.point(lambda a: 255 if a >= 128 else 0)
    logo_resized.putalpha(alpha)

    # Centrar en zona superior
    header_h = int(bg_h * HEADER_RATIO)
    x = (bg_w - target_w) // 2
    y = max(0, (header_h - target_h) // 2)

    # Pegar logo directo sobre la imagen
    bg.paste(logo_resized, (x, y), logo_resized)

    bg.save(str(image_path), "PNG")
    return image_path


def _find_latest_image(directory: Path) -> Path:
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
