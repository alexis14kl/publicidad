"""Superpone branding real de la empresa sobre la imagen publicitaria.

Recupera un look mas cercano al formato anterior:
- logo flotante y limpio en la parte superior
- barra/pildora de contacto redondeada en la parte inferior
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOGO_PNG = PROJECT_ROOT / "utils" / "logoapporange.png"

TOP_SAFE_RATIO = 0.08
BOTTOM_SAFE_RATIO = 0.15
LOGO_WIDTH_RATIO = 0.22
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


def _draw_top_logo(bg: Image.Image, logo: Image.Image) -> None:
    bg_w, bg_h = bg.size
    target_w = int(bg_w * LOGO_WIDTH_RATIO)
    scale = target_w / max(logo.size[0], 1)
    target_h = int(logo.size[1] * scale)
    logo_resized = logo.resize((target_w, target_h), Image.LANCZOS)
    alpha = logo_resized.split()[3]
    alpha = alpha.point(lambda a: 255 if a >= 96 else 0)
    logo_resized.putalpha(alpha)

    x = (bg_w - target_w) // 2
    y = max(int(bg_h * 0.015), int((bg_h * TOP_SAFE_RATIO - target_h) / 2))
    bg.paste(logo_resized, (x, y), logo_resized)


def _draw_contact_pill(draw: ImageDraw.ImageDraw, bg: Image.Image) -> None:
    bg_w, bg_h = bg.size
    pill_h = int(bg_h * 0.09)
    pill_w = int(bg_w * 0.72)
    pill_x = (bg_w - pill_w) // 2
    pill_y = bg_h - int(bg_h * BOTTOM_SAFE_RATIO) + int(bg_h * 0.01)

    primary = _parse_color(os.environ.get("BOT_BRAND_PRIMARY"), (23, 87, 194, 255))
    cta = _parse_color(os.environ.get("BOT_BRAND_CTA"), (253, 145, 2, 255))
    accent = _parse_color(os.environ.get("BOT_BRAND_ACCENT"), (0, 188, 212, 255))
    text_light = (255, 255, 255, 255)
    text_dark = (33, 52, 88, 255)

    shadow_offset = max(4, pill_h // 12)
    draw.rounded_rectangle(
        (pill_x, pill_y + shadow_offset, pill_x + pill_w, pill_y + pill_h + shadow_offset),
        radius=int(pill_h * 0.45),
        fill=(0, 0, 0, 38),
    )
    draw.rounded_rectangle(
        (pill_x, pill_y, pill_x + pill_w, pill_y + pill_h),
        radius=int(pill_h * 0.45),
        fill=(255, 255, 255, 236),
    )

    left_w = int(pill_w * 0.36)
    draw.rounded_rectangle(
        (pill_x, pill_y, pill_x + left_w, pill_y + pill_h),
        radius=int(pill_h * 0.45),
        fill=cta,
    )
    draw.rectangle(
        (pill_x + int(pill_h * 0.45), pill_y, pill_x + left_w, pill_y + pill_h),
        fill=cta,
    )

    phone = str(os.environ.get("BOT_COMPANY_PHONE", "")).strip()
    email = str(os.environ.get("BOT_COMPANY_EMAIL", "")).strip()
    website = _normalize_website(os.environ.get("BOT_COMPANY_WEBSITE", ""))
    company_name = str(os.environ.get("BOT_COMPANY_NAME", "")).strip()

    if not website:
        website = (company_name or "noyecode").lower().replace(" ", "")
    if not phone and not email:
        phone = "Contactanos hoy"

    left_text = website or (company_name or "noyecode")
    right_parts = [part for part in [phone, email or website] if part]
    right_text = "  •  ".join(right_parts)

    left_font = _fit_font(draw, left_text, int(left_w * 0.78), int(pill_h * 0.33), bold=True)
    left_bbox = draw.textbbox((0, 0), left_text, font=left_font)
    left_x = pill_x + int(pill_w * 0.035)
    left_y = pill_y + (pill_h - (left_bbox[3] - left_bbox[1])) // 2
    draw.text((left_x, left_y), left_text, font=left_font, fill=text_light)

    if right_text:
        right_font = _fit_font(draw, right_text, int(pill_w * 0.54), int(pill_h * 0.28), bold=True)
        right_bbox = draw.textbbox((0, 0), right_text, font=right_font)
        right_w = right_bbox[2] - right_bbox[0]
        right_h = right_bbox[3] - right_bbox[1]
        right_x = max(pill_x + left_w + int(pill_w * 0.03), pill_x + pill_w - right_w - int(pill_w * 0.05))
        right_y = pill_y + (pill_h - right_h) // 2
        draw.text((right_x, right_y), right_text, font=right_font, fill=primary if primary[:3] != (23, 87, 194) else text_dark)

    separator_x = pill_x + left_w + int(pill_w * 0.015)
    separator_y = pill_y + int(pill_h * 0.2)
    draw.rounded_rectangle(
        (separator_x, separator_y, separator_x + max(3, pill_w // 220), pill_y + pill_h - int(pill_h * 0.2)),
        radius=4,
        fill=accent,
    )


def overlay_logo(image_path: str | Path) -> Path:
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Imagen no encontrada: {image_path}")

    logo_path = _resolve_logo_path()
    if not logo_path.exists():
        raise FileNotFoundError(f"Logo no encontrado: {logo_path}")

    bg = Image.open(image_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    tw, th = _get_target_dimensions()
    bg = _fit_to_target(bg, tw, th)
    draw = ImageDraw.Draw(bg)

    _draw_top_logo(bg, logo)
    _draw_contact_pill(draw, bg)

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
