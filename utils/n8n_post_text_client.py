import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from logger import progress_bar  # noqa: E402


DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_OUTPUT_FILE = PROJECT_ROOT / "utils" / "post_text.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-post-fb-text"
DEFAULT_WEBSITE = "noyecode.com"
DEFAULT_WHATSAPP = "+57 301 385 9952"


class N8NPostTextError(RuntimeError):
    pass


def read_prompt(prompt_file: Path) -> str:
    if not prompt_file.exists():
        raise FileNotFoundError(f"No existe el archivo de prompt: {prompt_file}")
    text = prompt_file.read_text(encoding="utf-8", errors="ignore").strip()
    if not text:
        raise ValueError(f"El archivo de prompt esta vacio: {prompt_file}")
    return text


def clean_post_text(text: str, prompt_text: str = "") -> str:
    normalized = "\n".join(line.rstrip() for line in str(text).strip().splitlines()).strip()
    if not normalized:
        raise N8NPostTextError("n8n devolvio un caption vacio")
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
        raise N8NPostTextError("No se pudo normalizar el caption de n8n")
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


def _read_json_response(resp: Any) -> dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace").strip()
    if not raw:
        raise N8NPostTextError("n8n respondio vacio")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise N8NPostTextError(f"n8n no devolvio JSON valido: {raw[:300]}") from exc
    if not isinstance(data, dict):
        raise N8NPostTextError("n8n devolvio un JSON inesperado")
    return data


def generate_post_text(
    prompt_text: str,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    timeout: int = 60,
) -> str:
    payload = json.dumps({"prompt_text": prompt_text}, ensure_ascii=False).encode("utf-8")
    req = Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-n8n-post-text-client/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=timeout) as resp:
            data = _read_json_response(resp)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise N8NPostTextError(f"n8n devolvio HTTP {exc.code}: {body[:300]}") from exc
    except URLError as exc:
        raise N8NPostTextError(f"No se pudo conectar con n8n: {exc}") from exc

    output = str(data.get("output", "")).strip()
    if not output:
        raise N8NPostTextError(f"n8n no devolvio el campo output: {json.dumps(data, ensure_ascii=False)}")
    return clean_post_text(output, prompt_text=prompt_text)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Genera el caption comercial de Facebook en n8n.")
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
        "--webhook-url",
        default=DEFAULT_WEBHOOK_URL,
        help="Webhook de n8n que genera el caption.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Timeout en segundos para la llamada a n8n.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prompt_file = Path(args.prompt_file).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    prompt_text = read_prompt(prompt_file)
    with progress_bar("Generando caption con IA de n8n..."):
        post_text = generate_post_text(prompt_text, webhook_url=args.webhook_url, timeout=args.timeout)

    if args.stdout_only:
        print(post_text)
        return 0

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(post_text, encoding="utf-8")
    print(f"POST_TEXT_FILE={output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
