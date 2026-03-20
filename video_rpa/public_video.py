"""
Publica un video/reel en Facebook via n8n webhook.

Similar a public_img.py pero para videos.
Envia el video como multipart/form-data al webhook de n8n PUBLICAR_REEL_FB.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import get_env
from utils.logger import log_info, log_ok, log_warn, log_error

VIDEO_DIR = PROJECT_ROOT / "videos_publicitarias"
DEFAULT_POST_TEXT_FILE = PROJECT_ROOT / "utils" / "post_text.txt"
DEFAULT_WEBHOOK_URL = get_env(
    "N8N_WEBHOOK_PUBLICAR_REEL_FB",
    "https://n8n-dev.noyecode.com/webhook/publicar-reel-fb",
)
DEFAULT_TIMEOUT_SEC = 180  # Videos tardan mas en subir


def _find_latest_video(video_dir: Path = VIDEO_DIR) -> Path | None:
    """Busca el video mas reciente en videos_publicitarias/."""
    if not video_dir.exists():
        return None
    videos = sorted(
        [f for f in video_dir.iterdir() if f.suffix.lower() in (".mp4", ".mov", ".webm")],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return videos[0] if videos else None


def _get_credentials() -> tuple[str, str]:
    """Obtiene token y page_id desde env vars o SQLite."""
    token = (
        os.environ.get("FB_ACCESS_TOKEN")
        or os.environ.get("FACEBOOK_ACCESS_TOKEN")
        or get_env("FB_ACCESS_TOKEN")
        or get_env("FACEBOOK_ACCESS_TOKEN")
    )
    page_id = (
        os.environ.get("FB_PAGE_ID")
        or os.environ.get("FACEBOOK_PAGE_ID")
        or get_env("FB_PAGE_ID")
        or get_env("FACEBOOK_PAGE_ID")
    )
    return token or "", page_id or ""


def _multipart_encode(fields: dict[str, str], file_field: str, file_path: Path) -> tuple[bytes, str]:
    """Construye un body multipart/form-data manualmente (sin dependencias externas)."""
    import uuid
    boundary = f"----FormBoundary{uuid.uuid4().hex}"
    lines: list[bytes] = []

    # Campos de texto
    for key, value in fields.items():
        lines.append(f"--{boundary}\r\n".encode())
        lines.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        lines.append(f"{value}\r\n".encode())

    # Archivo de video
    filename = file_path.name
    mime = "video/mp4"
    if file_path.suffix.lower() == ".mov":
        mime = "video/quicktime"
    elif file_path.suffix.lower() == ".webm":
        mime = "video/webm"

    lines.append(f"--{boundary}\r\n".encode())
    lines.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode())
    lines.append(f"Content-Type: {mime}\r\n\r\n".encode())
    lines.append(file_path.read_bytes())
    lines.append(b"\r\n")

    # Cierre
    lines.append(f"--{boundary}--\r\n".encode())

    body = b"".join(lines)
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


def publish_video_to_n8n(
    video_path: Path | None = None,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    title: str = "",
    description: str = "",
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> dict:
    """
    Envia el video al webhook de n8n para publicar en Facebook.
    Returns dict con resultado.
    """
    # Buscar video
    if not video_path:
        video_path = _find_latest_video()
    if not video_path or not video_path.exists():
        raise FileNotFoundError("No se encontro video para publicar.")

    size_mb = video_path.stat().st_size / (1024 * 1024)
    log_info(f"Video: {video_path.name} ({size_mb:.1f}MB)")

    # Credenciales
    token, page_id = _get_credentials()
    if not token:
        raise RuntimeError("No se encontro FB_ACCESS_TOKEN.")
    if not page_id:
        raise RuntimeError("No se encontro FB_PAGE_ID.")

    # Titulo y descripcion
    if not title:
        title = os.environ.get("BOT_REEL_TITLE", "Reel publicitario")
    if not description:
        description = os.environ.get("BOT_REEL_CAPTION", "")
        if not description and DEFAULT_POST_TEXT_FILE.exists():
            description = DEFAULT_POST_TEXT_FILE.read_text(encoding="utf-8").strip()

    # Construir multipart
    fields = {
        "access_token": token,
        "page_id": page_id,
        "title": title,
        "description": description,
        "post_text": description,
    }

    log_info(f"Enviando video a n8n: {webhook_url[:60]}...")
    body, content_type = _multipart_encode(fields, "video", video_path)

    import urllib.request
    req = urllib.request.Request(webhook_url, data=body, method="POST")
    req.add_header("Content-Type", content_type)
    req.add_header("Content-Length", str(len(body)))

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            try:
                result = json.loads(resp_body)
            except json.JSONDecodeError:
                result = {"raw_response": resp_body[:500]}

            status = result.get("status", "unknown")
            post_id = result.get("post_id", "")

            if status == "success" or result.get("success"):
                log_ok(f"Video publicado via n8n! post_id={post_id}")
            else:
                log_warn(f"Respuesta de n8n: {result}")

            return result

    except HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")[:500]
        log_error(f"Error HTTP {e.code}: {body_err}")
        return {"status": "error", "error": body_err, "http_code": e.code}
    except URLError as e:
        log_error(f"Error de conexion: {e.reason}")
        return {"status": "error", "error": str(e.reason)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Publicar video/reel via n8n webhook")
    parser.add_argument("--video-path", type=str, help="Ruta al video (default: ultimo en videos_publicitarias/)")
    parser.add_argument("--webhook-url", type=str, default=DEFAULT_WEBHOOK_URL, help="URL del webhook n8n")
    parser.add_argument("--title", type=str, default="", help="Titulo del reel")
    parser.add_argument("--description", type=str, default="", help="Descripcion/caption del reel")
    parser.add_argument("--platform", type=str, default="facebook", help="Plataforma destino")
    args = parser.parse_args()

    video = Path(args.video_path) if args.video_path else None

    try:
        result = publish_video_to_n8n(
            video_path=video,
            webhook_url=args.webhook_url,
            title=args.title,
            description=args.description,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("status") == "success" or result.get("success") else 1
    except Exception as e:
        log_error(f"Error: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
