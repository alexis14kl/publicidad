"""
Overlay de branding profesional sobre video generado por IA.

Agrega al video:
1. Header bar opaca superior — tapa logos falsos generados por Veo 3
2. Logo de la empresa prominente sobre el header bar (con sombra)
3. Barra inferior con nombre de empresa + contacto (gradiente + texto grande)
4. Upscale a 1080p si el video es 720p
5. Encoding de alta calidad para redes sociales

Requiere: ffmpeg instalado en el sistema.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_LOGO_PNG = PROJECT_ROOT / "assets" / "logos" / "logoapporange.png"

# ─── Config ─────────────────────────────────────────────────────────────────

# Header bar (top) — designed to cover Veo 3 fake logos
HEADER_HEIGHT_RATIO = 0.14       # Top bar height as fraction of video height
HEADER_BG_COLOR = (15, 15, 15, 230)  # Near-black, almost opaque

# Logo
LOGO_SCALE = 0.28               # Logo width as fraction of video width (was 0.12)
LOGO_OPACITY = 1.0              # Full opacity (was 0.92)
LOGO_SHADOW_RADIUS = 6          # Drop shadow blur radius
LOGO_SHADOW_OFFSET = (3, 3)     # Drop shadow offset (x, y)
LOGO_SHADOW_COLOR = (0, 0, 0, 180)

# Bottom bar
BAR_HEIGHT_RATIO = 0.11         # Bottom bar height as fraction of video height (was 0.07)
BAR_BG_COLOR_TOP = (0, 0, 0, 120)    # Gradient: lighter at top
BAR_BG_COLOR_BOTTOM = (0, 0, 0, 220) # Gradient: darker at bottom
BAR_TEXT_COLOR = (255, 255, 255, 255)
BAR_ACCENT_COLOR = (253, 145, 2, 255)  # Brand orange #fd9102

# Encoding
TARGET_HEIGHT = 1080             # Upscale target
FFMPEG_CRF = 16                  # Lower = better quality (was 18)
FFMPEG_PRESET = "medium"         # Better quality (was "fast")


def _find_ffmpeg() -> str | None:
    """Find ffmpeg binary."""
    for candidate in [
        shutil.which("ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]:
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None


def _find_ffprobe() -> str | None:
    """Find ffprobe binary."""
    for candidate in [
        shutil.which("ffprobe"),
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        "/usr/bin/ffprobe",
    ]:
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None


def _get_video_dimensions(video_path: Path) -> tuple[int, int]:
    """Get video width and height using ffprobe."""
    ffprobe = _find_ffprobe()
    if not ffprobe:
        return 1080, 1920

    result = subprocess.run(
        [
            ffprobe, "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            str(video_path),
        ],
        capture_output=True, text=True, timeout=15,
    )
    if result.returncode != 0:
        return 1080, 1920

    try:
        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                w = int(stream.get("width", 1080))
                h = int(stream.get("height", 1920))
                return w, h
    except (json.JSONDecodeError, ValueError, KeyError):
        pass
    return 1080, 1920


def _resolve_logo_path(logo_path_override: str | Path | None = None) -> Path:
    """Get the logo path from override, env, or default."""
    if logo_path_override:
        custom = Path(logo_path_override)
        if custom.exists() and custom.is_file():
            return custom
    raw = str(os.environ.get("BOT_COMPANY_LOGO_PATH", "")).strip()
    if raw and raw not in {".", "./"}:
        custom = Path(raw)
        if custom.exists() and custom.is_file():
            return custom
    if DEFAULT_LOGO_PNG.exists():
        return DEFAULT_LOGO_PNG
    return Path("")


def _render_svg_to_png(svg_path: Path, size: int = 800) -> Path:
    """Convert SVG to PNG using macOS qlmanage."""
    output_dir = Path(tempfile.mkdtemp(prefix="publicidad_video_logo_"))
    try:
        subprocess.run(
            ["/usr/bin/qlmanage", "-t", "-s", str(size), "-o", str(output_dir), str(svg_path)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        rsvg = shutil.which("rsvg-convert")
        if rsvg:
            out = output_dir / f"{svg_path.stem}.png"
            subprocess.run(
                [rsvg, "-w", str(size), "-o", str(out), str(svg_path)],
                check=True, timeout=15,
            )
            return out
        return Path("")
    rendered = output_dir / f"{svg_path.stem}.png"
    if not rendered.exists():
        alt = output_dir / f"{svg_path.name}.png"
        if alt.exists():
            return alt
        return Path("")
    return rendered


def _load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Load a system font."""
    candidates = []
    if sys.platform == "darwin":
        candidates.extend([
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/SFNS.ttf",
            "/System/Library/Fonts/Supplemental/Helvetica.ttc",
        ])
    else:
        candidates.extend([
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ])
    for c in candidates:
        if c and Path(c).exists():
            try:
                return ImageFont.truetype(c, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _create_header_overlay(
    logo_path: Path,
    video_w: int,
    video_h: int,
) -> Path:
    """
    Create a transparent PNG with:
    1. Dark header bar at top (covers Veo 3 fake logos)
    2. Company logo centered in header bar with drop shadow
    """
    overlay = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    header_h = int(video_h * HEADER_HEIGHT_RATIO)

    # Draw gradient header bar (darker at top, slightly lighter at bottom)
    for y in range(header_h):
        progress = y / max(header_h - 1, 1)
        alpha = int(HEADER_BG_COLOR[3] * (1.0 - progress * 0.3))
        draw.line([(0, y), (video_w, y)], fill=(HEADER_BG_COLOR[0], HEADER_BG_COLOR[1], HEADER_BG_COLOR[2], alpha))

    # Load and place logo
    if not logo_path.exists():
        out_path = Path(tempfile.mktemp(suffix="_header_overlay.png", prefix="publicidad_"))
        overlay.save(str(out_path), "PNG")
        return out_path

    if logo_path.suffix.lower() == ".svg":
        logo_png_path = _render_svg_to_png(logo_path, size=int(video_w * LOGO_SCALE * 2))
        if not logo_png_path.exists():
            out_path = Path(tempfile.mktemp(suffix="_header_overlay.png", prefix="publicidad_"))
            overlay.save(str(out_path), "PNG")
            return out_path
        logo = Image.open(logo_png_path).convert("RGBA")
    else:
        logo = Image.open(logo_path).convert("RGBA")

    # Scale logo
    target_w = int(video_w * LOGO_SCALE)
    scale = target_w / max(logo.size[0], 1)
    target_h = int(logo.size[1] * scale)

    # Ensure logo fits within header bar (with some padding)
    max_logo_h = int(header_h * 0.72)
    if target_h > max_logo_h:
        scale = max_logo_h / max(logo.size[1], 1)
        target_w = int(logo.size[0] * scale)
        target_h = max_logo_h

    logo = logo.resize((target_w, target_h), Image.LANCZOS)

    # Apply full opacity
    if LOGO_OPACITY < 1.0:
        alpha = logo.getchannel("A")
        alpha = alpha.point(lambda a: int(a * LOGO_OPACITY))
        logo.putalpha(alpha)

    # Create drop shadow
    shadow = Image.new("RGBA", (target_w + 20, target_h + 20), (0, 0, 0, 0))
    shadow_alpha = logo.getchannel("A").point(lambda a: min(int(a * 0.7), LOGO_SHADOW_COLOR[3]))
    shadow_img = Image.new("RGBA", logo.size, LOGO_SHADOW_COLOR[:3] + (255,))
    shadow_img.putalpha(shadow_alpha)
    shadow.paste(shadow_img, (10 + LOGO_SHADOW_OFFSET[0], 10 + LOGO_SHADOW_OFFSET[1]), shadow_img)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=LOGO_SHADOW_RADIUS))

    # Position: left side of header bar, vertically centered
    logo_x = int(video_w * 0.04)
    logo_y = (header_h - target_h) // 2

    # Paste shadow first, then logo
    shadow_x = logo_x - 10
    shadow_y = logo_y - 10
    if shadow_x >= 0 and shadow_y >= 0:
        overlay.paste(shadow, (shadow_x, shadow_y), shadow)
    overlay.paste(logo, (logo_x, logo_y), logo)

    out_path = Path(tempfile.mktemp(suffix="_header_overlay.png", prefix="publicidad_"))
    overlay.save(str(out_path), "PNG")
    return out_path


def _create_bar_overlay(
    video_w: int,
    video_h: int,
    company_name: str,
    website: str,
    phone: str,
) -> Path:
    """
    Create a transparent PNG with a bottom info bar.
    Shows: CompanyName  |  website  |  phone
    Uses gradient background and larger text.
    """
    overlay = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    bar_h = int(video_h * BAR_HEIGHT_RATIO)
    bar_y = video_h - bar_h

    # Draw gradient bar background (lighter at top → darker at bottom)
    for y in range(bar_h):
        progress = y / max(bar_h - 1, 1)
        alpha = int(
            BAR_BG_COLOR_TOP[3] + (BAR_BG_COLOR_BOTTOM[3] - BAR_BG_COLOR_TOP[3]) * progress
        )
        r = int(BAR_BG_COLOR_TOP[0] + (BAR_BG_COLOR_BOTTOM[0] - BAR_BG_COLOR_TOP[0]) * progress)
        g = int(BAR_BG_COLOR_TOP[1] + (BAR_BG_COLOR_BOTTOM[1] - BAR_BG_COLOR_TOP[1]) * progress)
        b = int(BAR_BG_COLOR_TOP[2] + (BAR_BG_COLOR_BOTTOM[2] - BAR_BG_COLOR_TOP[2]) * progress)
        draw.line([(0, bar_y + y), (video_w, bar_y + y)], fill=(r, g, b, alpha))

    # Build text
    parts = [p for p in [company_name, website, phone] if p]
    if not parts:
        return Path("")

    # Font sizing: 55% of bar height
    font_size = int(bar_h * 0.55)
    font = _load_font(font_size, bold=True)
    separator = "  |  "
    full_text = separator.join(parts)

    bbox = draw.textbbox((0, 0), full_text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Reduce font if text too wide
    while text_w > video_w * 0.92 and font_size > 16:
        font_size -= 2
        font = _load_font(font_size, bold=True)
        bbox = draw.textbbox((0, 0), full_text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    # Center text in bar
    text_x = (video_w - text_w) // 2
    text_y = bar_y + (bar_h - text_h) // 2

    # Draw text with company name in accent color, rest in white
    current_x = text_x
    for i, part in enumerate(parts):
        color = BAR_ACCENT_COLOR if i == 0 else BAR_TEXT_COLOR
        draw.text((current_x, text_y), part, fill=color, font=font)
        part_bbox = draw.textbbox((0, 0), part, font=font)
        current_x += part_bbox[2] - part_bbox[0]
        if i < len(parts) - 1:
            draw.text((current_x, text_y), separator, fill=BAR_TEXT_COLOR, font=font)
            sep_bbox = draw.textbbox((0, 0), separator, font=font)
            current_x += sep_bbox[2] - sep_bbox[0]

    out_path = Path(tempfile.mktemp(suffix="_bar_overlay.png", prefix="publicidad_"))
    overlay.save(str(out_path), "PNG")
    return out_path


def overlay_video(
    video_path: str | Path,
    company_name: str = "",
    website: str = "",
    phone: str = "",
    logo_path: str | Path | None = None,
) -> Path:
    """
    Apply professional branding overlay to a video using ffmpeg.

    1. Upscales to 1080p if needed (Lanczos)
    2. Header bar at top with company logo (covers Veo 3 fake branding)
    3. Bottom bar with company info
    4. High-quality encoding for social media

    Returns the path to the branded video (replaces original).
    """
    from core.utils.logger import log_info, log_ok, log_warn, log_error

    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video no encontrado: {video_path}")

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log_warn("ffmpeg no encontrado. Video se publicara sin overlay de branding.")
        return video_path

    # Get video dimensions
    video_w, video_h = _get_video_dimensions(video_path)
    log_info(f"Video original: {video_w}x{video_h}")

    # Calculate output dimensions (upscale if below 1080p)
    needs_upscale = video_h < TARGET_HEIGHT
    if needs_upscale:
        scale_factor = TARGET_HEIGHT / video_h
        out_w = int(video_w * scale_factor)
        out_h = TARGET_HEIGHT
        # Ensure even dimensions (required by libx264)
        out_w = out_w + (out_w % 2)
        out_h = out_h + (out_h % 2)
        log_info(f"Upscale: {video_w}x{video_h} → {out_w}x{out_h}")
    else:
        out_w, out_h = video_w, video_h

    # Resolve logo
    resolved_logo = _resolve_logo_path(logo_path)
    overlay_paths: list[Path] = []
    cleanup_paths: list[Path] = []

    # Create header overlay (top bar + logo)
    header_overlay = _create_header_overlay(resolved_logo, out_w, out_h)
    if header_overlay.exists():
        overlay_paths.append(header_overlay)
        cleanup_paths.append(header_overlay)

    # Create bottom bar overlay
    if company_name or website or phone:
        bar_overlay = _create_bar_overlay(out_w, out_h, company_name, website, phone)
        if bar_overlay.exists():
            overlay_paths.append(bar_overlay)
            cleanup_paths.append(bar_overlay)

    if not overlay_paths:
        log_warn("No hay overlays para aplicar. Video se mantiene sin cambios.")
        return video_path

    # Build ffmpeg command
    output_path = video_path.with_name(f"{video_path.stem}_branded{video_path.suffix}")

    # Build filter chain
    inputs = ["-i", str(video_path)]
    filter_parts = []

    # Step 1: Upscale if needed
    if needs_upscale:
        filter_parts.append(f"[0:v]scale={out_w}:{out_h}:flags=lanczos[scaled]")
        current = "scaled"
    else:
        current = "0:v"

    # Step 2: Overlay each PNG
    for idx, overlay_path in enumerate(overlay_paths):
        input_idx = idx + 1
        inputs.extend(["-i", str(overlay_path)])
        out_label = f"v{idx}"
        filter_parts.append(f"[{current}][{input_idx}:v]overlay=0:0[{out_label}]")
        current = out_label

    filter_complex = ";".join(filter_parts)

    cmd = [
        ffmpeg, "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{current}]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", FFMPEG_PRESET,
        "-crf", str(FFMPEG_CRF),
        "-profile:v", "high",
        "-level:v", "4.1",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(output_path),
    ]

    try:
        log_info(f"Aplicando overlay de branding ({out_w}x{out_h}, CRF {FFMPEG_CRF}, preset {FFMPEG_PRESET})...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode != 0:
            log_error(f"ffmpeg fallo: {result.stderr[:500]}")
            return video_path

        if output_path.exists() and output_path.stat().st_size > 100_000:
            shutil.move(str(output_path), str(video_path))
            final_size_mb = video_path.stat().st_size / (1024 * 1024)
            log_ok(
                f"Overlay aplicado: header+logo+barra sobre {video_path.name} "
                f"({out_w}x{out_h}, {final_size_mb:.1f}MB)"
            )
        else:
            log_warn("ffmpeg genero un archivo demasiado pequeno. Manteniendo video original.")
            if output_path.exists():
                output_path.unlink()
            return video_path

    except subprocess.TimeoutExpired:
        log_warn("ffmpeg timeout (180s). Video se mantiene sin overlay.")
        return video_path
    except Exception as exc:
        log_warn(f"Error en ffmpeg: {exc}. Video se mantiene sin overlay.")
        return video_path
    finally:
        for p in cleanup_paths:
            try:
                if p.exists():
                    p.unlink()
            except OSError:
                pass

    return video_path


def main() -> int:
    """CLI: python overlay_video.py <video_path>"""
    if len(sys.argv) < 2:
        print("Uso: python overlay_video.py <ruta_video>")
        return 1

    video_path = Path(sys.argv[1])
    company = os.environ.get("BOT_COMPANY_NAME", "")
    website = os.environ.get("BUSINESS_WEBSITE", "")
    phone = os.environ.get("BUSINESS_WHATSAPP", "")

    result = overlay_video(video_path, company_name=company, website=website, phone=phone)
    print(f"VIDEO_OVERLAY_APPLIED={result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
