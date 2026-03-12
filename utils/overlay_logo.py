"""Superpone el logo real de NoyeCode sobre la zona de header de una imagen publicitaria.

DALL-E genera la imagen con el 15% superior vacio (fondo claro limpio).
Este script limpia programaticamente la zona del header (borrando cualquier texto
que DALL-E haya puesto ahi) usando blur extremo y coloca el logo encima.
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
    """Borra texto/elementos del header pintando color solido uniforme + fade.

    Estrategia: detecta el color de fondo dominante de las esquinas de la imagen
    (que siempre son fondo limpio) y pinta todo el header con ese color uniforme.
    Luego aplica blur + fade para una transicion suave al contenido.
    """
    data = np.array(bg, dtype=np.float32)
    original = data.copy()
    h, w = data.shape[:2]

    # Muestrear color de las 4 esquinas (siempre son fondo limpio, no contenido)
    corner_size = 50
    corners = []
    for cy, cx in [(0, 0), (0, w - corner_size), (h - 1, 0), (h - 1, w - corner_size)]:
        cy = max(0, min(cy, h - 1))
        cx_end = min(cx + corner_size, w)
        corners.append(data[cy, cx:cx_end, :3].mean(axis=0))
    bg_color = np.mean(corners, axis=0)  # Color de fondo promedio (3,)

    # Pintar todo el header con el color de fondo uniforme
    for y in range(header_h):
        data[y, :, :3] = bg_color
        data[y, :, 3] = 255

    # Blur la zona de transicion de la imagen original para suavizar el borde
    total_zone = min(header_h + fade_rows, h)
    transition_crop = bg.crop((0, header_h, w, total_zone))
    blurred_transition = np.array(
        transition_crop.filter(ImageFilter.GaussianBlur(radius=20)),
        dtype=np.float32,
    )

    # Fade: color solido -> blur -> imagen original
    for i in range(fade_rows):
        y = header_h + i
        if y >= h:
            break
        t = i / max(fade_rows - 1, 1)
        if t < 0.5:
            # Primera mitad: color solido -> blur
            t2 = t / 0.5
            data[y, :, :3] = bg_color * (1 - t2) + blurred_transition[i, :, :3] * t2
        else:
            # Segunda mitad: blur -> original
            t2 = (t - 0.5) / 0.5
            data[y, :, :3] = blurred_transition[i, :, :3] * (1 - t2) + original[y, :, :3] * t2

    return Image.fromarray(np.clip(data, 0, 255).astype(np.uint8), "RGBA")


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
