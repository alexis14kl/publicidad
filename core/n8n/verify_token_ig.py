"""Verifica y renueva el token de Instagram antes de publicar.

1. Valida el token actual con la Instagram Graph API.
2. Si es valido → no hace nada.
3. Si expiro → llama a TOKEN_MANAGER_IG de n8n para renovarlo (refresh 60 dias).
4. Si falla → continua con el token actual (fail-open, nunca bloquea el bot).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.utils.logger import log_info, log_ok, log_warn

WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/token-manager-ig"
IG_GRAPH_API = "https://graph.instagram.com/v21.0"
TIMEOUT_SEC = 15


def _get_current_token() -> str:
    for key in ("INSTAGRAM_ACCESS_TOKEN",):
        value = str(os.environ.get(key, "") or "").strip()
        if value:
            return value
    return ""


def _get_account_id() -> str:
    return str(os.environ.get("INSTAGRAM_ACCOUNT_ID", "") or "").strip()


def _is_token_valid(token: str) -> bool:
    """Valida el token con Instagram Graph API."""
    try:
        url = f"{IG_GRAPH_API}/me?fields=id,username&access_token={token}"
        with urlopen(url, timeout=TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return bool(data.get("id"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if "expired" in body.lower() or "invalid" in body.lower() or exc.code in (400, 401):
            return False
        return False
    except Exception:
        return True  # fail-open


def _request_token_refresh(current_token: str, account_id: str) -> str | None:
    """Llama a n8n TOKEN_MANAGER_IG para refrescar el token."""
    payload = json.dumps({
        "token": current_token,
        "account_id": account_id,
        "action": "exchange",
    }, ensure_ascii=False).encode("utf-8")

    req = Request(
        WEBHOOK_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-verify-token-ig/1.0",
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
        log_warn(f"verify_token_ig: Error llamando a n8n: {exc}")
        return None

    if data.get("status") != "success":
        log_warn(f"verify_token_ig: n8n respondio: {data.get('message', data.get('status', 'unknown'))}")
        return None

    new_token = str(data.get("access_token", "") or "").strip()
    expires_days = data.get("expires_in_days")
    if expires_days:
        log_info(f"verify_token_ig: Token renovado, expira en {expires_days} dias.")
    return new_token if new_token else None


def _update_sqlite(account_id: str, new_token: str) -> None:
    """Actualiza el token en instagram.sqlite3."""
    try:
        db_path = PROJECT_ROOT / "Backend" / "instagram.sqlite3"
        if not db_path.exists():
            return

        bin_path = PROJECT_ROOT / "scripts" / "bin" / "sqlite3.exe"
        sqlite_bin = str(bin_path) if bin_path.exists() else "sqlite3"

        safe_token = new_token.replace("'", "''")
        sql = f"UPDATE instagram_form SET token = '{safe_token}' WHERE account_id = '{account_id}' AND is_primary = 1;"
        subprocess.run(
            [sqlite_bin, str(db_path)],
            input=sql,
            encoding="utf-8",
            timeout=10,
            capture_output=True,
        )
        log_ok(f"verify_token_ig: Token actualizado en SQLite para account_id={account_id}")
    except Exception as exc:
        log_warn(f"verify_token_ig: No se pudo actualizar SQLite: {exc}")


def run_token_verification() -> bool:
    """Verifica y renueva el token de IG. Retorna True si se renovo."""
    current_token = _get_current_token()
    account_id = _get_account_id()

    if not current_token:
        log_warn("verify_token_ig: No hay token IG activo, omitiendo.")
        return False

    log_info(f"verify_token_ig: Verificando token para account_id={account_id or '?'}...")

    # Paso 1: Validar token actual
    if _is_token_valid(current_token):
        log_ok("verify_token_ig: Token vigente y valido.")
        return False

    # Paso 2: Token expirado → intentar renovar via n8n
    log_warn("verify_token_ig: Token expirado o invalido. Intentando renovar...")
    new_token = _request_token_refresh(current_token, account_id)

    if not new_token:
        log_warn("verify_token_ig: No se pudo obtener token nuevo. Se usara el actual.")
        return False

    if new_token == current_token:
        log_ok("verify_token_ig: Token sin cambios.")
        return False

    # Paso 3: Actualizar token en memoria y SQLite
    os.environ["INSTAGRAM_ACCESS_TOKEN"] = new_token
    log_ok("verify_token_ig: INSTAGRAM_ACCESS_TOKEN actualizado en memoria.")
    if account_id:
        _update_sqlite(account_id, new_token)

    return True
