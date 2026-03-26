"""
Post Text Client — genera captions para redes sociales via Anthropic Claude.

Reemplaza el antiguo flujo via webhook n8n. Ahora la generación del caption
se hace directamente con Claude (Sonnet → Haiku fallback).
"""
import argparse
import os
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.utils.logger import progress_bar, log_info
from core.utils.claude_client import ask_claude
from core.cfg.platform import get_env, PROMPT_FILE, POST_TEXT_FILE
from core.cfg.sqlite_store import add_artifact, new_run

DEFAULT_PROMPT_FILE = PROMPT_FILE
DEFAULT_OUTPUT_FILE = POST_TEXT_FILE
DEFAULT_WEBSITE = "noyecode.com"
DEFAULT_WHATSAPP = "+57 301 385 9952"


class PostTextGenerationError(RuntimeError):
    pass


def read_prompt(prompt_file: Path) -> str:
    if not prompt_file.exists():
        raise FileNotFoundError(f"No existe el archivo de prompt: {prompt_file}")
    text = prompt_file.read_text(encoding="utf-8", errors="ignore").strip()
    if not text:
        raise ValueError(f"El archivo de prompt esta vacio: {prompt_file}")
    return text


# ==============================
# LIMPIEZA Y FORMATO
# ==============================

def clean_post_text(text: str, prompt_text: str = "") -> str:
    normalized = "\n".join(line.rstrip() for line in str(text).strip().splitlines()).strip()
    if not normalized:
        raise PostTextGenerationError("Claude devolvio un caption vacio")
    formatted = _format_for_facebook(normalized)
    if _needs_rebuild(formatted):
        return _build_caption_from_prompt(prompt_text)
    return formatted


def _strip_markdown(line: str) -> str:
    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", line)
    cleaned = re.sub(r"__(.*?)__", r"\1", cleaned)
    cleaned = re.sub(r"^[\-\*\u2022]\s*", "", cleaned)
    return cleaned.strip()


def _looks_like_noise(line: str) -> bool:
    lowered = line.lower().strip()
    if not lowered:
        return True
    return lowered in {
        "imagen de alta definicion grafica",
        "imagen de alta definición gráfica",
    } or lowered.startswith("[imagen ")


def _format_for_facebook(text: str) -> str:
    lines = [_strip_markdown(line) for line in text.splitlines()]
    lines = [line for line in lines if not _looks_like_noise(line)]

    heading = ""
    description: list[str] = []
    bullets: list[str] = []
    cta: list[str] = []
    hashtags = ""

    for line in lines:
        lower = line.lower()
        if line.startswith("#"):
            hashtags = line
            continue
        if "beneficios" in lower:
            continue
        if "¿qué esperas" in lower or "comienza a mejorar" in lower:
            continue
        if "whatsapp" in lower or "sitio web" in lower or "visita nuestra" in lower or "visita noyecode.com" in lower:
            cta.append(line)
            continue
        if heading == "" and (
            "noyecode" in lower
            or "desarrollo" in lower
            or "automatiz" in lower
            or "legacy" in lower
            or "android" in lower
            or "desktop" in lower
            or "rpa" in lower
        ):
            heading = line
            continue
        if line.startswith(("Software ", "Soporte ", "Soluciones ")):
            bullets.append(line)
            continue
        description.append(line)

    if not heading and description:
        heading = description.pop(0)

    compact: list[str] = []
    if heading:
        compact.append(heading)
    if description:
        compact.append(" ".join(description[:2]).strip())
    if bullets:
        compact.append("Beneficios: " + " | ".join(bullets[:3]))
    if cta:
        compact.append(" ".join(cta[:2]).strip())
    if hashtags:
        compact.append(hashtags)

    result = "\n\n".join(part for part in compact if part).strip()
    if not result:
        raise PostTextGenerationError("No se pudo normalizar el caption")
    return result


def _needs_rebuild(text: str) -> bool:
    lowered = text.lower()
    return any(
        marker in lowered
        for marker in (
            "sentados alrededor",
            "la pantalla detrás",
            "texto publicitario",
            "imagen de alta definición",
            "imagen en alta definición",
            "titulo:",
            "título:",
            "descripción:",
            "descripcion:",
            "beneficios:",
            "se observa",
        )
    )


def _extract_service(prompt_text: str) -> str:
    match = re.search(r'servicio\s+"([^"]+)"', prompt_text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    if "automatiz" in prompt_text.lower():
        return "Automatizaciones"
    if "legacy" in prompt_text.lower():
        return "Modernizacion de Sistemas Legacy"
    if "android" in prompt_text.lower():
        return "Desarrollo Android"
    if "desktop" in prompt_text.lower():
        return "Desarrollo Desktop"
    if "rpa" in prompt_text.lower():
        return "RPAs Nativos"
    return "Desarrollo a la Medida"


def _extract_hashtags(prompt_text: str) -> str:
    hashtags = re.findall(r"#\w+", prompt_text)
    if hashtags:
        return " ".join(dict.fromkeys(hashtags))
    return "#NoyeCode #SoftwareEmpresarial #Colombia"


def _build_caption_from_prompt(prompt_text: str) -> str:
    service = _extract_service(prompt_text)
    hashtags = _extract_hashtags(prompt_text)
    return (
        f"{service} con NoyeCode\n\n"
        f"Impulsa tu negocio con soluciones de software personalizadas, escalables y pensadas para resultados reales. "
        f"Nuestro equipo crea tecnologia a la medida con enfoque profesional, visual moderno y alto nivel tecnico.\n\n"
        f"Escribenos por WhatsApp: {DEFAULT_WHATSAPP}\n"
        f"Visita: {DEFAULT_WEBSITE}\n\n"
        f"{hashtags}"
    )


# ==============================
# SYSTEM PROMPT PARA CLAUDE
# ==============================

_SYSTEM_PROMPT = """Eres un copywriter experto en redes sociales para empresas de tecnología en Colombia.

Tu tarea es generar UN caption profesional para una publicación de Facebook/Instagram
a partir del prompt visual de una imagen publicitaria.

REGLAS:
1. Responde SOLO con el caption. Nada más — sin explicaciones, sin prefijos, sin markdown extra.
2. Idioma: español colombiano, tono profesional y cercano.
3. Estructura obligatoria:
   - Hook (primera línea impactante que detenga el scroll)
   - Contexto (por qué importa ahora)
   - Valor (qué ofrece la empresa)
   - Prueba (dato, testimonio o credibilidad)
   - CTA (acción clara: visita la web, escríbenos por WhatsApp)
4. Incluir info de contacto:
   - WhatsApp: +57 301 385 9952
   - Web: noyecode.com
5. Mencionar el nombre de la empresa (NoyeCode) al menos una vez.
6. Usar emojis estratégicamente (máximo 5-6 en todo el texto).
7. Terminar con 8-12 hashtags relevantes en una línea separada.
8. Máximo 200 palabras (sin contar hashtags).
9. NO describir la imagen. Escribir copy que VENDA el servicio.
10. NO usar markdown (ni **, ni ##, ni bullets con -)."""


def generate_post_text(
    prompt_text: str,
    **_kwargs,
) -> str:
    """Genera caption para redes sociales usando Claude directamente.

    Acepta **_kwargs para compatibilidad con callers antiguos que pasaban
    webhook_url, timeout, etc.
    """
    log_info("Generando caption con Claude...")

    user_prompt = (
        f"PROMPT VISUAL DE LA IMAGEN PUBLICITARIA:\n{prompt_text}\n\n"
        f"Genera el caption profesional para Facebook/Instagram."
    )

    response = ask_claude(_SYSTEM_PROMPT, user_prompt, max_tokens=1024)

    if not response:
        raise PostTextGenerationError(
            "Claude no devolvió respuesta para el caption. Verifica ANTHROPIC_API_KEY en .env"
        )

    return clean_post_text(response, prompt_text=prompt_text)


# ==============================
# CLI
# ==============================

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera el caption comercial para redes sociales con Anthropic Claude."
    )
    parser.add_argument(
        "--prompt-file",
        default=str(DEFAULT_PROMPT_FILE),
        help="Archivo que contiene el prompt visual actual.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_FILE),
        help="Archivo donde se guardara el caption generado.",
    )
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="Imprime el caption y no escribe archivo.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="(Ignorado, mantenido por compatibilidad).",
    )
    parser.add_argument(
        "--webhook-url",
        default=None,
        help="(Ignorado, mantenido por compatibilidad).",
    )
    parser.add_argument(
        "--run-id",
        default=str(os.getenv("PUBLICIDAD_RUN_ID", "")).strip(),
        help="Run ID para versionado en SQLite.",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="No guarda versionado en SQLite.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prompt_file = Path(args.prompt_file).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    prompt_text = read_prompt(prompt_file)
    with progress_bar("Generando caption con Anthropic Claude..."):
        post_text = generate_post_text(prompt_text)

    if args.stdout_only:
        print(post_text)
        return 0

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(post_text, encoding="utf-8")
    print(f"POST_TEXT_FILE={output_file}")

    if not args.no_db:
        run_id = new_run(
            "generate_post_text",
            {"source": "anthropic_claude", "prompt_file": str(prompt_file)},
            run_id=str(args.run_id or "").strip() or None,
            status="ok",
        )
        add_artifact(
            run_id=run_id,
            artifact_type="post_text",
            content=post_text,
            file_path=str(output_file),
            meta={"prompt_text": prompt_text},
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
