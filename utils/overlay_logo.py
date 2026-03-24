"""Superpone branding real de la empresa sobre la imagen publicitaria.

Recupera un look mas cercano al formato anterior:
- logo flotante y limpio en la parte superior
- barra/pildora de contacto redondeada en la parte inferior
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"

TOP_SAFE_RATIO = 0.08
LOGO_SEARCH_RATIO = 0.22
LOGO_WIDTH_RATIO = 0.15
_DEFAULT_WIDTH = 1080
_DEFAULT_HEIGHT = 1350


def _get_target_dimensions() -> tuple[int, int]:
    try:
        w = int(os.environ.get("BOT_IMAGE_WIDTH", "0") or "0")
        h = int(os.environ.get("BOT_IMAGE_HEIGHT", "0") or "0")
        if w > 0 and h > 0:
            return w, h
    except (ValueError, TypeError):
        pass
    return _DEFAULT_WIDTH, _DEFAULT_HEIGHT


def _fit_to_target(img: Image.Image, tw: int, th: int) -> Image.Image:
    w, h = img.size
    if w == tw and h == th:
        return img
    scale = min(tw / w, th / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    canvas = Image.new("RGBA", (tw, th), (240, 240, 245, 255))
    x = (tw - new_w) // 2
    y = (th - new_h) // 2
    canvas.paste(img, (x, y), img if img.mode == "RGBA" else None)
    return canvas


def _parse_color(value: str | None, fallback: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    raw = str(value or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return fallback
    try:
        return tuple(int(raw[i : i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        return fallback


def _resolve_logo_path() -> Path:
    raw = str(os.environ.get("BOT_COMPANY_LOGO_PATH", "")).strip()
    if raw and raw not in {".", "./"}:
        custom = Path(raw)
        if custom.exists() and custom.is_file():
            return custom
    if DEFAULT_LOGO_PNG.exists() and DEFAULT_LOGO_PNG.is_file():
        return DEFAULT_LOGO_PNG
    return Path("")


def _render_svg_to_png(svg_path: Path) -> Path:
    output_dir = Path(tempfile.mkdtemp(prefix="publicidad_logo_svg_"))
    command = [
        "/usr/bin/qlmanage",
        "-t",
        "-s",
        "1200",
        "-o",
        str(output_dir),
        str(svg_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rendered = output_dir / f"{svg_path.stem}.png"
    if not rendered.exists():
        raise FileNotFoundError(f"No se pudo rasterizar el SVG: {svg_path}")
    return rendered


def _load_logo_image(logo_path: Path) -> Image.Image:
    raster_path = logo_path
    cleanup_dir: Path | None = None
    if logo_path.suffix.lower() == ".svg":
        raster_path = _render_svg_to_png(logo_path)
        cleanup_dir = raster_path.parent
    try:
        return Image.open(raster_path).convert("RGBA")
    finally:
        if cleanup_dir and cleanup_dir.exists():
            shutil.rmtree(cleanup_dir, ignore_errors=True)


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = []
    if sys.platform == "darwin":
        candidates.extend(
            [
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/SFNS.ttf",
                "/System/Library/Fonts/Supplemental/Helvetica.ttc",
            ]
        )
    else:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            ]
        )

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, start_size: int, bold: bool = False) -> ImageFont.ImageFont:
    size = start_size
    while size >= 16:
        font = _load_font(size, bold=bold)
        bbox = draw.textbbox((0, 0), text, font=font)
        if (bbox[2] - bbox[0]) <= max_width:
            return font
        size -= 2
    return _load_font(16, bold=bold)


def _normalize_website(value: str) -> str:
    website = str(value or "").strip()
    if not website:
        return ""
    website = website.replace("https://", "").replace("http://", "").strip("/")
    return website


def _find_best_logo_position(bg: Image.Image, logo_size: tuple[int, int]) -> tuple[int, int]:
    bg_w, bg_h = bg.size
    logo_w, logo_h = logo_size
    search_top = max(int(bg_h * 0.015), 8)
    search_bottom = max(search_top + logo_h + 8, int(bg_h * LOGO_SEARCH_RATIO))
    margin_x = max(int(bg_w * 0.04), 20)
    candidates = [
        (margin_x, search_top),
        ((bg_w - logo_w) // 2, search_top),
        (max(margin_x, bg_w - logo_w - margin_x), search_top),
        (margin_x, max(search_top, search_bottom - logo_h)),
        ((bg_w - logo_w) // 2, max(search_top, search_bottom - logo_h)),
        (max(margin_x, bg_w - logo_w - margin_x), max(search_top, search_bottom - logo_h)),
    ]

    rgba = bg.convert("RGBA")
    edge_map = rgba.convert("L").filter(ImageFilter.FIND_EDGES)

    best_score = None
    best_pos = candidates[0]
    for x, y in candidates:
        x = max(margin_x, min(x, bg_w - logo_w - margin_x))
        y = max(search_top, min(y, search_bottom - logo_h))
        crop = rgba.crop((x, y, x + logo_w, y + logo_h))
        edge_crop = edge_map.crop((x, y, x + logo_w, y + logo_h))
        alpha_mask = crop.getchannel("A")
        mean_edge = ImageStat.Stat(edge_crop, mask=alpha_mask).mean[0]
        mean_luma = ImageStat.Stat(crop.convert("L"), mask=alpha_mask).mean[0]
        distance_from_center = abs((x + logo_w / 2) - bg_w / 2) / max(bg_w, 1)
        score = (mean_edge * 3.0) - (mean_luma * 0.18) + (distance_from_center * 22.0)
        if best_score is None or score < best_score:
            best_score = score
            best_pos = (int(x), int(y))

    return best_pos


def _draw_top_logo(bg: Image.Image, logo: Image.Image) -> None:
    bg_w, bg_h = bg.size
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / max(logo.size[0], 1)
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)
    alpha = logo_resized.split()[3]
    alpha = alpha.point(lambda a: 255 if a >= 96 else 0)
    logo_resized.putalpha(alpha)

    x, y = _find_best_logo_position(bg, (target_w, target_h))
    bg.paste(logo_resized, (x, y), logo_resized)


def overlay_logo(image_path: str | Path) -> Path:
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _resolve_logo_path()
    if not logo_path.exists():
        raise FileNotFoundError(f"Logo no encontrado: {logo_path}")

    bg = Image.open(image_path).convert("RGBA")
    logo = _load_logo_image(logo_path)

    tw, th = _get_target_dimensions()
    bg = _fit_to_target(bg, tw, th)
    _draw_top_logo(bg, logo)

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
