from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from cfg.platform import get_env  # noqa: E402
from cfg.sqlite_store import add_artifact, new_run  # noqa: E402


DEFAULT_TIMEOUT_SEC = 60


class CreateCampaignError(RuntimeError):
    pass


def _read_json_response(resp: Any) -> dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace").strip()
    if not raw:
        return {"status": "ok", "http_status": getattr(resp, "status", 200), "body": ""}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"status": "ok", "http_status": getattr(resp, "status", 200), "body": raw}
    if isinstance(data, dict):
        data.setdefault("http_status", getattr(resp, "status", 200))
    return data


def post_json(url: str, payload: dict[str, Any], timeout_sec: int) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "publicidad-create-campaign/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            return _read_json_response(resp)
    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace").strip()
        raise CreateCampaignError(f"Webhook devolvio HTTP {exc.code}: {body_text[:400]}") from exc
    except URLError as exc:
        raise CreateCampaignError(f"No se pudo conectar con webhook: {exc}") from exc


def _default_webhook_for_platform(platform: str) -> str:
    p = str(platform or "").strip().lower()
    mapping = {
        "google": "N8N_WEBHOOK_CREATE_CAMPAIGN_GOOGLE",
        "facebook": "N8N_WEBHOOK_CREATE_CAMPAIGN_FACEBOOK",
        "linkedin": "N8N_WEBHOOK_CREATE_CAMPAIGN_LINKEDIN",
    }
    key = mapping.get(p, "")
    return get_env(key, "") if key else ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crea campañas via webhook n8n (Google/Facebook/LinkedIn).")
    parser.add_argument(
        "--platform",
        default="facebook",
        help="Plataforma destino (google|facebook|linkedin).",
    )
    parser.add_argument(
        "--webhook-url",
        default="",
        help="Webhook n8n. Si no se indica, usa N8N_WEBHOOK_CREATE_CAMPAIGN_<PLATFORM>.",
    )
    parser.add_argument(
        "--payload-json",
        default="",
        help="Payload JSON literal a enviar.",
    )
    parser.add_argument(
        "--payload-file",
        default="",
        help="Ruta a un archivo JSON con el payload.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="Timeout en segundos para el POST.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No envia nada; imprime el payload final.",
    )
    parser.add_argument(
        "--run-id",
        default=str(os.getenv("PUBLICIDAD_RUN_ID", "")).strip(),
        help="Run ID para versionado en SQLite. Por defecto usa PUBLICIDAD_RUN_ID si existe.",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="No guarda versionado en SQLite.",
    )
    return parser.parse_args()


def _load_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.payload_json:
        try:
            data = json.loads(args.payload_json)
        except json.JSONDecodeError as exc:
            raise CreateCampaignError(f"--payload-json no es JSON valido: {exc}") from exc
        if not isinstance(data, dict):
            raise CreateCampaignError("--payload-json debe ser un objeto JSON")
        return data

    if args.payload_file:
        path = Path(args.payload_file).expanduser().resolve()
        if not path.exists():
            raise CreateCampaignError(f"No existe --payload-file: {path}")
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except json.JSONDecodeError as exc:
            raise CreateCampaignError(f"--payload-file no contiene JSON valido: {exc}") from exc
        if not isinstance(data, dict):
            raise CreateCampaignError("--payload-file debe contener un objeto JSON")
        return data

    return {}


def main() -> int:
    args = parse_args()
    platform = str(args.platform or "facebook").strip().lower()
    payload = _load_payload(args)
    payload.setdefault("platform", platform)
    if args.run_id:
        payload.setdefault("run_id", str(args.run_id))

    webhook_url = str(args.webhook_url or "").strip() or _default_webhook_for_platform(platform)
    if not webhook_url:
        raise CreateCampaignError(
            "Debes indicar --webhook-url o definir N8N_WEBHOOK_CREATE_CAMPAIGN_<PLATFORM> en .env"
        )

    if args.dry_run:
        print(json.dumps({"webhook_url": webhook_url, "payload": payload}, ensure_ascii=False, indent=2))
        return 0

    response = post_json(webhook_url, payload, timeout_sec=int(args.timeout))
    print(json.dumps(response, ensure_ascii=False))

    if not args.no_db:
        run_id = new_run(
            "create_campaign",
            {"webhook_url": webhook_url, "platform": platform},
            run_id=str(args.run_id or "").strip() or None,
            status="ok",
        )
        add_artifact(
            run_id=run_id,
            artifact_type="campaign",
            content=json.dumps(response, ensure_ascii=False),
            file_path="",
            meta={"platform": platform, "payload": payload},
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

