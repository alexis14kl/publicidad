"""Verifica y renueva el token de Facebook antes de publicar.

1. Valida el token actual directamente con la Graph API de Facebook.
2. Si el token es válido → no hace nada.
3. Si el token expiró → llama al endpoint TOKEN_MANAGER_FB de n8n para renovarlo.
4. Si falla → continúa con el token actual (fail-open, nunca bloquea el bot).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.utils.logger import log_info, log_ok, log_warn

WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/token-manager-fb"
GRAPH_API_BASE = "https://graph.facebook.com/v21.0"
TIMEOUT_SEC = 15


def _get_current_token() -> str:
    for key in ("FB_ACCESS_TOKEN", "FACEBOOK_ACCESS_TOKEN", "META_ACCESS_TOKEN"):
        value = str(os.environ.get(key, "") or "").strip()
        if value:
            return value
    return ""


def _get_page_id() -> str:
    return str(os.environ.get("FB_PAGE_ID", "") or "").strip()


def _is_token_valid(token: str, page_id: str) -> bool:
    """Valida el token directamente con Facebook Graph API."""
    try:
        url = f"{GRAPH_API_BASE}/{page_id}?fields=name&access_token={token}"
        with urlopen(url, timeout=TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("name") or data.get("id"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if "expired" in body.lower() or "invalid" in body.lower() or exc.code == 401:
            return False
        return False
    except Exception:
        return True  # Si no se puede verificar, asumir válido (fail-open)


def _request_new_token(current_token: str, page_id: str) -> str | None:
    """Llama a n8n TOKEN_MANAGER_FB para obtener un token renovado."""
    payload = json.dumps({
        "short_token": current_token,
        "page_id": page_id,
    }, ensure_ascii=False).encode("utf-8")

    req = Request(
        WEBHOOK_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-verify-token/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=TIMEOUT_SEC) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
            if not raw:
                return None
            data = json.loads(raw)
    except Exception as exc:
        log_warn(f"verify_token_fb: Error llamando a n8n: {exc}")
        return None

    if data.get("status") != "success":
        log_warn(f"verify_token_fb: n8n respondió: {data.get('message', data.get('status', 'unknown'))}")
        return None

    selected = data.get("selected_page") or {}
    new_token = str(selected.get("page_access_token", "") or "").strip()
    return new_token if new_token else None


def _update_sqlite(page_id: str, new_token: str) -> None:
    """Actualiza el token en facebook.sqlite3 para la página indicada."""
    try:
        db_path = PROJECT_ROOT / "Backend" / "facebook.sqlite3"
        if not db_path.exists():
            return

        bin_path = PROJECT_ROOT / "scripts" / "bin" / "sqlite3.exe"
        sqlite_bin = str(bin_path) if bin_path.exists() else "sqlite3"

        import subprocess
        safe_token = new_token.replace("'", "''")
        sql = f"UPDATE facebook_form SET token = '{safe_token}' WHERE page_id = '{page_id}' AND is_primary = 1;"
        subprocess.run(
            [sqlite_bin, str(db_path)],
            input=sql,
            encoding="utf-8",
            timeout=10,
            capture_output=True,
        )
        log_ok(f"verify_token_fb: Token actualizado en SQLite para page_id={page_id}")
    except Exception as exc:
        log_warn(f"verify_token_fb: No se pudo actualizar SQLite: {exc}")


def run_token_verification() -> bool:
    """Verifica y renueva el token de FB. Retorna True si se renovó."""
    current_token = _get_current_token()
    page_id = _get_page_id()

    if not current_token:
        log_warn("verify_token_fb: No hay token FB activo, omitiendo.")
        return False

    if not page_id:
        log_warn("verify_token_fb: No hay FB_PAGE_ID, omitiendo.")
        return False

    log_info(f"verify_token_fb: Verificando token para page_id={page_id}...")

    # Paso 1: Validar token actual con Facebook
    if _is_token_valid(current_token, page_id):
        log_ok("verify_token_fb: Token vigente y válido.")
        return False

    # Paso 2: Token expirado → intentar renovar via n8n
    log_warn("verify_token_fb: Token expirado o inválido. Intentando renovar...")
    new_token = _request_new_token(current_token, page_id)

    if not new_token:
        log_warn("verify_token_fb: No se pudo obtener token nuevo. Se usará el actual.")
        return False

    if new_token == current_token:
        log_ok("verify_token_fb: Token sin cambios.")
        return False

    # Paso 3: Actualizar token en memoria y SQLite
    os.environ["FB_ACCESS_TOKEN"] = new_token
    log_ok("verify_token_fb: FB_ACCESS_TOKEN actualizado en memoria.")
    _update_sqlite(page_id, new_token)

    return True
