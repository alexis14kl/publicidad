"""
Direct Video Upload to Facebook Graph API — bypass n8n.

Upload a video/reel to Facebook using the 3-phase Resumable Upload API:
1. Start: POST /{page_id}/video_reels?upload_phase=start
2. Upload: POST {upload_url} with binary video data
3. Finish: POST /{page_id}/video_reels?upload_phase=finish

Cross-platform (Windows/Mac/Linux).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.utils.logger import log_info, log_ok, log_warn, log_error

FB_GRAPH_API = "https://graph.facebook.com/v21.0"


def _post_json(url: str, data: dict, timeout: int = 30) -> dict:
    """POST form-urlencoded and return JSON response."""
    encoded = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=encoded, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _upload_binary(upload_url: str, video_path: Path, access_token: str, timeout: int = 180) -> dict:
    """POST binary video data to the upload URL."""
    file_size = video_path.stat().st_size
    with open(video_path, "rb") as f:
        video_data = f.read()

    req = urllib.request.Request(upload_url, data=video_data, method="POST")
    req.add_header("Authorization", f"OAuth {access_token}")
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("offset", "0")
    req.add_header("file_size", str(file_size))

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def upload_reel(
    video_path: str,
    page_id: str,
    access_token: str,
    title: str = "Reel publicitario",
    description: str = "",
) -> dict:
    """
    Upload a video as a Facebook Reel using 3-phase upload.
    Returns dict with status, post_id, video_id.
    """
    video = Path(video_path)
    if not video.exists():
        raise FileNotFoundError(f"Video no encontrado: {video_path}")

    file_size = video.stat().st_size
    log_info(f"Video: {video.name} ({file_size / 1024 / 1024:.1f}MB)")

    # Phase 1: Start upload
    log_info("Fase 1/3: Iniciando upload...")
    start_url = f"{FB_GRAPH_API}/{page_id}/video_reels"
    start_resp = _post_json(start_url, {
        "upload_phase": "start",
        "access_token": access_token,
    })

    video_id = start_resp.get("video_id")
    upload_url = start_resp.get("upload_url")
    if not video_id or not upload_url:
        raise RuntimeError(f"Facebook no devolvio video_id o upload_url: {start_resp}")

    log_ok(f"Fase 1 OK. video_id={video_id}")

    # Phase 2: Upload binary
    log_info("Fase 2/3: Subiendo video binario...")
    try:
        upload_resp = _upload_binary(upload_url, video, access_token)
        log_ok(f"Fase 2 OK. Respuesta: {upload_resp}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Fase 2 fallo (HTTP {e.code}): {body}")

    # Wait for Facebook to process (10 seconds)
    log_info("Esperando procesamiento de Facebook (10s)...")
    import time
    time.sleep(10)

    # Phase 3: Finish and publish
    log_info("Fase 3/3: Publicando reel...")
    finish_url = f"{FB_GRAPH_API}/{page_id}/video_reels"
    finish_resp = _post_json(finish_url, {
        "upload_phase": "finish",
        "video_id": video_id,
        "title": title,
        "description": description,
        "access_token": access_token,
    }, timeout=60)

    post_id = finish_resp.get("post_id", "")
    success = finish_resp.get("success", False)

    if success:
        reel_url = f"https://www.facebook.com/reel/{video_id}/"
        log_ok(f"Reel publicado! post_id={post_id}, video_id={video_id}")
        log_ok(f"URL del Reel: {reel_url}")
    else:
        log_warn(f"Facebook respondio sin success=true: {finish_resp}")

    return {
        "status": "success" if success else "error",
        "post_id": post_id,
        "video_id": video_id,
        "facebook_response": finish_resp,
    }


# Need urllib.parse for urlencode
import urllib.parse


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload video reel to Facebook")
    parser.add_argument("--video-path", required=True, help="Path to video file")
    parser.add_argument("--page-id", required=True, help="Facebook Page ID")
    parser.add_argument("--access-token", required=True, help="Facebook Access Token")
    parser.add_argument("--title", default="Reel publicitario", help="Reel title")
    parser.add_argument("--description", default="", help="Reel description/caption")
    args = parser.parse_args()

    try:
        result = upload_reel(
            video_path=args.video_path,
            page_id=args.page_id,
            access_token=args.access_token,
            title=args.title,
            description=args.description,
        )
        print(f"VIDEO_PUBLISHED={result.get('post_id', '')}")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] == "success" else 1
    except Exception as e:
        log_error(f"Error subiendo video: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
