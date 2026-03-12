"""Superpone el logo real de NoyeCode sobre la zona de header de una imagen publicitaria.

DALL-E genera la imagen con el 15% superior vacio (gradiente oscuro natural).
Este script limpia programaticamente la zona del header (borrando cualquier texto
que DALL-E haya puesto ahi) y coloca el logo encima.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"
LOGO_SVG = PROJECT_ROOT / "utils" / "logoapporange.svg"

HEADER_RATIO = 0.18  # 18% del alto = zona limpia para el logo
FADE_ROWS = 60  # filas de transicion suave entre header limpio y contenido
LOGO_WIDTH_RATIO = 0.35  # logo ocupa 35% del ancho
# Tamano final para Facebook/Instagram feed (4:5)
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1350


def _fit_to_target(img: Image.Image, tw: int, th: int) -> Image.Image:
    """Recorta/escala la imagen para que llene exactamente tw x th sin bordes negros.

    Usa crop centrado: escala al tamaño más grande que cubra el target y recorta el sobrante.
    """
    w, h = img.size
    if w == tw and h == th:
        return img

    # Escalar para cubrir (cover): el ratio mayor gana
    scale = max(tw / w, th / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    # Crop centrado al tamaño exacto
    left = (new_w - tw) // 2
    top = (new_h - th) // 2
    img = img.crop((left, top, left + tw, top + th))
    return img


def _ensure_logo_png() -> Path:
    """Verifica que el logo PNG exista (pre-generado desde el SVG)."""
    if LOGO_PNG.exists():
        return LOGO_PNG
    raise FileNotFoundError(
        f"No se encontro el logo PNG: {LOGO_PNG}. "
        f"Generalo previamente desde {LOGO_SVG} con Playwright o un editor de imagenes."
    )


def _clean_header_zone(bg: Image.Image, header_h: int, fade_rows: int) -> Image.Image:
    """Borra texto/elementos del header usando blur extremo + oscurecimiento.

    Estrategia: aplica un gaussian blur muy fuerte SOLO en la zona del header
    para destruir cualquier texto, luego oscurece progresivamente hacia arriba.
    Resultado: zona limpia que conserva los colores naturales de la imagen sin
    verse como un parche artificial.
    """
    bg_w, bg_h = bg.size
    total_zone = header_h + fade_rows

    # Recortar la zona del header + fade
    header_crop = bg.crop((0, 0, bg_w, min(total_zone, bg_h)))

    # Blur extremo: radio grande para destruir completamente cualquier texto
    blurred = header_crop.filter(ImageFilter.GaussianBlur(radius=40))

    # Oscurecer progresivamente hacia arriba (simula gradiente oscuro natural)
    blur_data = np.array(blurred, dtype=np.float32)
    for y in range(header_h):
        # Factor de oscurecimiento: 0.2 arriba -> 1.0 al borde del header
        darken = 0.2 + 0.8 * (y / max(header_h - 1, 1))
        blur_data[y, :, :3] *= darken

    # Zona de fade: mezclar blur con imagen original
    original_data = np.array(bg, dtype=np.float32)
    for i in range(fade_rows):
        y = header_h + i
        if y >= blur_data.shape[0]:
            break
        # t=0 al inicio del fade (100% blur), t=1 al final (100% original)
        t = i / max(fade_rows - 1, 1)
        blur_data[y, :, :3] = blur_data[y, :, :3] * (1 - t) + original_data[y, :, :3] * t

    blur_data = np.clip(blur_data, 0, 255).astype(np.uint8)

    # Pegar la zona procesada de vuelta en la imagen
    result = np.array(bg)
    result[:min(total_zone, bg_h)] = blur_data
    return Image.fromarray(result, "RGBA")


def overlay_logo(image_path: str | Path) -> Path:
    """Limpia la zona del header y coloca el logo encima.

    1. Fuerza tamano 1080x1350 (4:5)
    2. Limpia programaticamente la zona del header (borra texto invasor de DALL-E)
    3. Coloca el logo centrado en la zona limpia
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _ensure_logo_png()
    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    # Forzar tamaño 1080x1350 (4:5) para FB/IG
    bg = _fit_to_target(bg, TARGET_WIDTH, TARGET_HEIGHT)
    bg_w, bg_h = bg.size
    header_h = int(bg_h * HEADER_RATIO)

    # Limpiar zona del header: borrar cualquier texto que DALL-E haya puesto ahi
    bg = _clean_header_zone(bg, header_h, FADE_ROWS)

    # Escalar logo al 35% del ancho de la imagen
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / logo.size[0]
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)

    # Limpiar pixeles semi-transparentes (anti-aliasing del SVG)
    alpha = logo_resized.split()[3]
    alpha = alpha.point(lambda a: 255 if a >= 128 else 0)
    logo_resized.putalpha(alpha)

    # Centrar logo horizontal y verticalmente dentro de la zona de header
    x = (bg_w - target_w) // 2
    y = max(0, (header_h - target_h) // 2)

    # Pegar logo sobre el gradiente natural de la imagen
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
