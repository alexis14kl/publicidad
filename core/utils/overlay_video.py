"""
Overlay de branding profesional sobre video generado por IA.

Agrega al video:
1. Logo de la empresa (esquina superior, con sombra)
2. Barra inferior con nombre de empresa + contacto
3. Sin modificar la calidad del video original

Requiere: ffmpeg instalado en el sistema.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_LOGO_PNG = PROJECT_ROOT / "assets" / "logos" / "logoapporange.png"

# ─── Config ─────────────────────────────────────────────────────────────────

LOGO_SCALE = 0.12          # Logo width as fraction of video width
LOGO_MARGIN_RATIO = 0.025  # Margin from edge as fraction of video width
LOGO_OPACITY = 0.92

BAR_HEIGHT_RATIO = 0.07    # Bottom bar height as fraction of video height
BAR_BG_COLOR = (0, 0, 0, 180)  # Semi-transparent black
BAR_TEXT_COLOR = (255, 255, 255, 255)
BAR_ACCENT_COLOR = (79, 70, 229, 255)  # Brand indigo


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
        return 1080, 1920  # Default 9:16

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

    import json
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


def _resolve_logo_path() -> Path:
    """Get the logo path from env or default."""
    raw = str(os.environ.get("BOT_COMPANY_LOGO_PATH", "")).strip()
    if raw and raw not in {".", "./"}:
        custom = Path(raw)
        if custom.exists() and custom.is_file():
            return custom
    if DEFAULT_LOGO_PNG.exists():
        return DEFAULT_LOGO_PNG
    return Path("")


def _render_svg_to_png(svg_path: Path, size: int = 400) -> Path:
    """Convert SVG to PNG using macOS qlmanage."""
    output_dir = Path(tempfile.mkdtemp(prefix="publicidad_video_logo_"))
    try:
        subprocess.run(
            ["/usr/bin/qlmanage", "-t", "-s", str(size), "-o", str(output_dir), str(svg_path)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Fallback: try rsvg-convert or return empty
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
        # qlmanage sometimes adds .png.png
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


def _create_logo_overlay(logo_path: Path, video_w: int, video_h: int) -> Path:
    """
    Create a transparent PNG overlay with logo positioned top-left.
    Returns path to the overlay image.
    """
    overlay = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))

    # Load logo
    if logo_path.suffix.lower() == ".svg":
        logo_png_path = _render_svg_to_png(logo_path, size=int(video_w * LOGO_SCALE * 2))
        if not logo_png_path.exists():
            return Path("")
        logo = Image.open(logo_png_path).convert("RGBA")
    else:
        logo = Image.open(logo_path).convert("RGBA")

    # Scale logo
    target_w = int(video_w * LOGO_SCALE)
    scale = target_w / max(logo.size[0], 1)
    target_h = int(logo.size[1] * scale)
    logo = logo.resize((target_w, target_h), Image.LANCZOS)

    # Apply opacity
    alpha = logo.getchannel("A")
    alpha = alpha.point(lambda a: int(a * LOGO_OPACITY))
    logo.putalpha(alpha)

    # Position: top-left with margin
    margin = int(video_w * LOGO_MARGIN_RATIO)
    overlay.paste(logo, (margin, margin), logo)

    # Save overlay
    out_path = Path(tempfile.mktemp(suffix="_logo_overlay.png", prefix="publicidad_"))
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
    Shows: company_name | website | phone
    """
    overlay = Image.new("RGBA", (video_w, video_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    bar_h = int(video_h * BAR_HEIGHT_RATIO)
    bar_y = video_h - bar_h

    # Draw semi-transparent bar background
    draw.rectangle([(0, bar_y), (video_w, video_h)], fill=BAR_BG_COLOR)

    # Build text
    parts = [p for p in [company_name, website, phone] if p]
    text = "  |  ".join(parts) if parts else ""
    if not text:
        return Path("")

    # Fit font
    font_size = int(bar_h * 0.42)
    font = _load_font(font_size, bold=True)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Reduce font if text too wide
    while text_w > video_w * 0.9 and font_size > 14:
        font_size -= 2
        font = _load_font(font_size, bold=True)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    # Center text in bar
    text_x = (video_w - text_w) // 2
    text_y = bar_y + (bar_h - text_h) // 2

    draw.text((text_x, text_y), text, fill=BAR_TEXT_COLOR, font=font)

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
    log_info(f"Video: {video_w}x{video_h} | Aplicando overlay de branding...")

    # Resolve logo
    resolved_logo = Path(logo_path) if logo_path else _resolve_logo_path()
    overlay_paths: list[Path] = []
    cleanup_paths: list[Path] = []

    # Create logo overlay
    if resolved_logo.exists():
        logo_overlay = _create_logo_overlay(resolved_logo, video_w, video_h)
        if logo_overlay.exists():
            overlay_paths.append(logo_overlay)
            cleanup_paths.append(logo_overlay)

    # Create bottom bar overlay
    if company_name or website or phone:
        bar_overlay = _create_bar_overlay(video_w, video_h, company_name, website, phone)
        if bar_overlay.exists():
            overlay_paths.append(bar_overlay)
            cleanup_paths.append(bar_overlay)

    if not overlay_paths:
        log_warn("No hay overlays para aplicar. Video se mantiene sin cambios.")
        return video_path

    # Build ffmpeg command
    output_path = video_path.with_name(f"{video_path.stem}_branded{video_path.suffix}")

    # ffmpeg filter: overlay each PNG on top of video
    inputs = ["-i", str(video_path)]
    filter_parts = []
    current = "0:v"

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
        "-map", "0:a?",           # Keep original audio if present
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",             # High quality (lower = better, 18 is visually lossless)
        "-c:a", "copy",           # Don't re-encode audio
        "-movflags", "+faststart", # Optimize for streaming
        str(output_path),
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            log_error(f"ffmpeg fallo: {result.stderr[:300]}")
            return video_path  # Return original on failure

        # Replace original with branded version
        if output_path.exists() and output_path.stat().st_size > 100_000:
            shutil.move(str(output_path), str(video_path))
            log_ok(f"Overlay aplicado: logo + barra de contacto sobre {video_path.name}")
        else:
            log_warn("ffmpeg genero un archivo demasiado pequeno. Manteniendo video original.")
            if output_path.exists():
                output_path.unlink()
            return video_path

    except subprocess.TimeoutExpired:
        log_warn("ffmpeg timeout (120s). Video se mantiene sin overlay.")
        return video_path
    except Exception as exc:
        log_warn(f"Error en ffmpeg: {exc}. Video se mantiene sin overlay.")
        return video_path
    finally:
        # Cleanup temp files
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
