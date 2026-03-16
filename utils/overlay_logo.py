"""Superpone el logo real de NoyeCode sobre la imagen publicitaria.

Solo pega el logo con transparencia limpia encima de la imagen.
No modifica el fondo, no pinta, no aplica blur ni efectos.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"

LOGO_WIDTH_RATIO = 0.25  # logo ocupa 25% del ancho (mas pequeno)
HEADER_RATIO = 0.08  # zona superior donde va centrado el logo (pegado arriba)
_DEFAULT_WIDTH = 1080
_DEFAULT_HEIGHT = 1350


def _get_target_dimensions() -> tuple[int, int]:
    """Lee dimensiones de env vars BOT_IMAGE_WIDTH/HEIGHT, fallback a 1080x1350."""
    try:
        w = int(os.environ.get("BOT_IMAGE_WIDTH", "0") or "0")
        h = int(os.environ.get("BOT_IMAGE_HEIGHT", "0") or "0")
        if w > 0 and h > 0:
            return w, h
    except (ValueError, TypeError):
        pass
    return _DEFAULT_WIDTH, _DEFAULT_HEIGHT


def _fit_to_target(img: Image.Image, tw: int, th: int) -> Image.Image:
    """Escala la imagen para que quepa en tw x th SIN recortar. Rellena con fondo claro."""
    w, h = img.size
    if w == tw and h == th:
        return img
    # min() = fit-to-contain (no recorta, puede dejar bordes)
    scale = min(tw / w, th / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    # Crear canvas del tamaño exacto con fondo claro (#f0f0f5)
    canvas = Image.new("RGBA", (tw, th), (240, 240, 245, 255))
    # Centrar la imagen en el canvas
    x = (tw - new_w) // 2
    y = (th - new_h) // 2
    canvas.paste(img, (x, y), img if img.mode == "RGBA" else None)
    return canvas


def overlay_logo(image_path: str | Path) -> Path:
    """Pega el logo centrado en la zona superior de la imagen. Sin modificar el fondo."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")
    if not LOGO_PNG.exists():
        raise FileNotFoundError(f"Logo no encontrado: {LOGO_PNG}")

    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(LOGO_PNG).convert("RGBA")

    # Forzar dimensiones del formato seleccionado (o 1080x1350 por defecto)
    tw, th = _get_target_dimensions()
    bg = _fit_to_target(bg, tw, th)
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
