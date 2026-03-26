"""
Claude Client — módulo compartido para llamadas a Anthropic Claude.

Centraliza la lógica de retry, fallback de modelos y logging
para que todos los módulos del proyecto usen el mismo cliente.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from core.utils.logger import log_info, log_ok, log_warn, log_error

# Load .env
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass


def ask_claude(
    system_prompt: str,
    user_prompt: str,
    max_retries: int = 3,
    max_tokens: int = 4096,
) -> str:
    """Envía un prompt a Claude via Anthropic SDK con retry para overloaded.

    Modelos: claude-sonnet-4-20250514 → claude-haiku-4-5-20251001.
    Reintenta hasta *max_retries* veces por modelo en caso de 529 (overloaded).
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        log_error("ANTHROPIC_API_KEY no configurada en .env")
        return ""

    try:
        import anthropic
    except ImportError:
        log_error("SDK de anthropic no instalado. Ejecuta: pip install anthropic")
        return ""

    client = anthropic.Anthropic(api_key=api_key)

    models = ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]
    for model in models:
        for attempt in range(max_retries):
            try:
                log_info(f"Consultando {model} (intento {attempt + 1}/{max_retries})...")
                message = client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                log_ok(f"Respuesta recibida de {model}")
                return message.content[0].text.strip()
            except anthropic.APIStatusError as exc:
                if exc.status_code == 529 and attempt < max_retries - 1:
                    wait = (attempt + 1) * 3
                    log_warn(f"{model} sobrecargado. Reintentando en {wait}s...")
                    time.sleep(wait)
                    continue
                if exc.status_code == 529:
                    log_warn(f"{model} no disponible. Intentando siguiente modelo...")
                    break
                log_error(f"Claude API error: {exc}")
                return ""
            except Exception as exc:
                log_error(f"Claude error: {exc}")
                return ""

    log_error("Ningún modelo de Claude disponible.")
    return ""
