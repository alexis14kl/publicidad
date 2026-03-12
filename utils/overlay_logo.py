"""Superpone una barra de header + logo real de NoyeCode sobre una imagen publicitaria.

Mejora: usa un gradiente suave en la barra de header en vez de un rectangulo solido,
para que se integre mejor con el fondo de la imagen generada por DALL-E.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"
LOGO_SVG = PROJECT_ROOT / "utils" / "logoapporange.svg"

# Color de la barra superior (debe coincidir con la paleta del prompt)
HEADER_COLOR = (26, 26, 46)  # #1a1a2e RGB
HEADER_RATIO = 0.15  # 15% del alto de la imagen
LOGO_WIDTH_RATIO = 0.35  # logo ocupa 35% del ancho
# Porcentaje extra debajo de la barra donde se aplica un fade gradual
FADE_EXTRA_RATIO = 0.05  # 5% adicional de transicion suave
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


def overlay_logo(image_path: str | Path) -> Path:
    """Pinta la barra de header con gradiente suave y superpone el logo."""
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _ensure_logo_png()
    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    # Forzar tamaño 1080x1350 (4:5) para eliminar bordes negros en FB/IG
    bg = _fit_to_target(bg, TARGET_WIDTH, TARGET_HEIGHT)
    bg_w, bg_h = bg.size
    header_h = int(bg_h * HEADER_RATIO)
    fade_h = int(bg_h * FADE_EXTRA_RATIO)

    # Pintar barra de header SOLIDA en la zona del logo (0 a header_h)
    draw = ImageDraw.Draw(bg)
    draw.rectangle([(0, 0), (bg_w, header_h)], fill=(*HEADER_COLOR, 255))

    # Crear un fade gradual debajo de la barra solida para transicion suave
    # Esto ayuda cuando DALL-E puso contenido justo en el borde del 15%
    if fade_h > 0:
        fade_overlay = Image.new("RGBA", (bg_w, fade_h), (0, 0, 0, 0))
        fade_draw = ImageDraw.Draw(fade_overlay)
        for y in range(fade_h):
            # Alpha va de 200 (casi opaco) a 0 (transparente)
            alpha = int(200 * (1 - y / fade_h))
            fade_draw.line([(0, y), (bg_w, y)], fill=(*HEADER_COLOR, alpha))
        bg.paste(fade_overlay, (0, header_h), fade_overlay)

    # Escalar logo al 35% del ancho de la imagen
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / logo.size[0]
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)

    # Limpiar pixeles semi-transparentes (anti-aliasing del SVG)
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
