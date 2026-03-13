import argparse
import json
import io
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

from service_rotation import rotate_service
from logger import log_error, progress_bar


PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_IDEA_FILE = PROJECT_ROOT / "utils" / "prompt_seed.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"

LOGO_URL = "https://www.noyecode.com/assets/logo-google-ads-square.png"

DEFAULT_BRAND_HINT = (
    "Imagen publicitaria estilo FOTOGRAFIA REALISTA para marketing de software empresarial. "
    "Persona joven real trabajando con laptop o computador moderno en ambiente profesional. "
    "Expresion positiva, actitud de exito o celebracion mientras usa tecnologia. "

    "Composicion tipo anuncio publicitario para redes sociales. "
    "Diseño limpio con bloques de texto corporativos alrededor de la persona. "
    "Titular grande en un lado de la imagen. "
    "Badge o boton con CTA en color naranja. "
    "Caja de texto destacada con beneficios del servicio. "
    "Banner inferior con contacto o llamada a la accion. "

    "Elementos visuales tecnologicos como dashboards, interfaces digitales flotantes o pantallas con graficos. "

    "Estilo visual: fotografia profesional de marketing SaaS. "
    "NO caricaturas, NO ilustracion, NO vector. "
    "Solo fotografia realista de alta calidad. "

    "Fondo limpio blanco o gris claro #f0f0f5 con estilo minimalista corporativo. "

    "Colores de marca: "
    "morado #3469ED, "
    "naranja #fd9102, "
    "cyan #00bcd4. "

    "Composicion similar a anuncios modernos de tecnologia para Facebook o Instagram Ads. "
)

DEFAULT_FEATURES_HINT = (
    "BENEFICIOS (en la caja de beneficios, sin inventar otros; max 7 bullets): "
    "Versionado en SQLite (en carpeta del proyecto); "
    "Publica en Instagram; Publica en TikTok; Publica en LinkedIn; "
    "Campañas Google; Campañas Facebook; Campañas LinkedIn."
)


class N8NPromptError(RuntimeError):
    pass


# ==============================
# FUNCION PARA INSERTAR LOGO
# ==============================

def add_logo_to_footer(image_path: str, output_path: str, logo_url: str):
    """Inserta el logo centrado en el pie del anuncio"""

    base_image = Image.open(image_path).convert("RGBA")
    width, height = base_image.size

    with urllib.request.urlopen(logo_url) as response:
        logo_data = response.read()

    logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")

    # escalar logo al 20% del ancho
    logo_width = int(width * 0.20)
    ratio = logo_width / logo.width
    logo_height = int(logo.height * ratio)

    logo = logo.resize((logo_width, logo_height), Image.LANCZOS)

    x = (width - logo_width) // 2
    y = height - logo_height - 40

    # fondo blanco semi transparente
    footer_bg = Image.new("RGBA", (logo_width + 40, logo_height + 20), (255, 255, 255, 220))

    base_image.paste(footer_bg, (x - 20, y - 10), footer_bg)
    base_image.paste(logo, (x, y), logo)

    base_image.save(output_path)


# ==============================
# LOGICA ORIGINAL DEL PROMPT
# ==============================
# ==============================
# FUNCION PARA INSERTAR LOGO
# ==============================

def add_logo_to_footer(image_path: str, output_path: str, logo_url: str):
    """Inserta el logo centrado en el pie del anuncio"""

    base_image = Image.open(image_path).convert("RGBA")
    width, height = base_image.size

    with urllib.request.urlopen(logo_url) as response:
        logo_data = response.read()

    logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")

    # escalar logo al 20% del ancho
    logo_width = int(width * 0.20)
    ratio = logo_width / logo.width
    logo_height = int(logo.height * ratio)

    logo = logo.resize((logo_width, logo_height), Image.LANCZOS)

    x = (width - logo_width) // 2
    y = height - logo_height - 40

    # fondo blanco semi transparente
    footer_bg = Image.new("RGBA", (logo_width + 40, logo_height + 20), (255, 255, 255, 220))

    base_image.paste(footer_bg, (x - 20, y - 10), footer_bg)
    base_image.paste(logo, (x, y), logo)

    base_image.save(output_path)


# ==============================
# LOGICA ORIGINAL DEL PROMPT
# ==============================

def looks_like_generic_service_seed(text: str) -> bool:
    lower = text.lower()
    markers = [
        "servicios que si se deben promocionar",
        "preferencia de enfoque",
        "elegir una de estas lineas para la pieza visual",
    ]
    service_hits = sum(
        1
        for token in (
            "desarrollo a la medida",
            "automatizaciones empresariales",
            "software legacy",
            "rpas nativos",
            "desarrollo android",
            "desarrollo desktop",
        )
        if token in lower
    )
    return any(marker in lower for marker in markers) or service_hits >= 3


def clean_generated_prompt(prompt: str) -> str:
    text = " ".join(str(prompt).strip().split())
    lower = text.lower()

    markers = ["prompt:", "prompt final:", "prompt para imagen:"]
    for marker in markers:
        idx = lower.find(marker)
        if idx != -1:
            text = text[idx + len(marker):].strip()
            lower = text.lower()
            break

    text = text.strip(" ;:-\n\r\t")

    return (
        f"Generate this image now: {text} "
        "CRITICAL: The top 15% of the image must be completely empty dark gradient only - "
        "no text, no icons, no elements of any kind. Logo is added programmatically later. "
        "Full-bleed, no black bars, no margins. "
        "Deliver exactly ONE final image, vertical 4:5, 4K resolution."
    ).strip()

def add_logo_to_footer_from_url(image_url: str, output_path: str, logo_url: str):
    """Descarga la imagen desde URL y agrega el logo centrado en el pie."""

    # Descargar imagen principal
    with urllib.request.urlopen(image_url) as response:
        image_data = response.read()

    base_image = Image.open(io.BytesIO(image_data)).convert("RGBA")
    width, height = base_image.size

    # Descargar logo
    with urllib.request.urlopen(logo_url) as response:
        logo_data = response.read()

    logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")

    # Escalar logo proporcionalmente (20% del ancho)
    logo_width = int(width * 0.20)
    ratio = logo_width / logo.width
    logo_height = int(logo.height * ratio)

    logo = logo.resize((logo_width, logo_height), Image.LANCZOS)

    # Posición centrada en el pie
    x = (width - logo_width) // 2
    y = height - logo_height - 40

    # Fondo blanco elegante para el logo
    footer_bg = Image.new("RGBA", (logo_width + 40, logo_height + 20), (255, 255, 255, 220))

    base_image.paste(footer_bg, (x - 20, y - 10), footer_bg)
    base_image.paste(logo, (x, y), logo)

    base_image.convert("RGB").save(output_path)

def detect_primary_service(text: str) -> str:
    lower = text.lower()

    if "desarrollo a la medida" in lower:

    if "desarrollo a la medida" in lower:
        return "desarrollo a la medida"

    if "rpa" in lower:

    if "rpa" in lower:
        return "rpas nativos"

    if "legacy" in lower:

    if "legacy" in lower:
        return "modernizacion de software legacy"

    if "android" in lower:
        return "desarrollo android"

    if "desktop" in lower:

    if "desktop" in lower:
        return "desarrollo desktop"

    if "automatizacion" in lower:

    if "automatizacion" in lower:
        return "automatizaciones empresariales"


    return ""


def select_primary_service(text: str) -> str:


    if looks_like_generic_service_seed(text):
        return rotate_service()


    detected = detect_primary_service(text)


    if detected:
        return detected


    return rotate_service()


def enrich_idea(idea: str) -> str:

    base = " ".join(idea.strip().split())


    primary_service = select_primary_service(base)


    hints: list[str] = []

    hints.append(DEFAULT_BRAND_HINT)

    hints.append(
        f"Servicio protagonista de esta pieza: {primary_service}. "
        "No cambiarlo ni mezclar con otros servicios."
    )

    hints.append(
        "ZONA DE LOGO: 15% superior de la imagen COMPLETAMENTE VACIO (solo gradiente oscuro). "
        "Todo el contenido empieza debajo de esa zona."
    )

    hints.append(
        "ESTILO PUBLICIDAD PROFESIONAL: fotografia realista tipo anuncio de marketing digital. "
        "Persona real con laptop o tecnologia. "
        "Layout publicitario con titular, badge, caja de texto y banner inferior."
    )

        "ESTILO PUBLICIDAD PROFESIONAL: fotografia realista tipo anuncio de marketing digital. "
        "Persona real con laptop o tecnologia. "
        "Layout publicitario con titular, badge, caja de texto y banner inferior."
    )

    hints.append(
        "NO incluir ilustraciones ni caricaturas. "
        "SI incluir interfaces digitales flotantes, dashboards y tecnologia."
    )

    return f"{base}\n\nDirectrices:\n- " + "\n- ".join(hints), primary_service


def _read_json_response(resp: Any) -> dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace").strip()


    if not raw:
        raise N8NPromptError("n8n respondio vacio")


    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise N8NPromptError(f"n8n no devolvio JSON valido: {raw[:200]}") from exc


    if not isinstance(data, dict):
        raise N8NPromptError("n8n devolvio un JSON inesperado")


    return data


def generate_prompt(
    idea: str,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    timeout: int = 60,
    *,
    enriched_idea: str | None = None,
) -> str:


    idea = idea.strip()


    if not idea:
        raise ValueError("La idea base no puede estar vacia")

    enriched_idea = enrich_idea(idea)

    payload = json.dumps({"text": enriched_idea}, ensure_ascii=False).encode("utf-8")


    req = Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-n8n-client/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=timeout) as resp:
            data = _read_json_response(resp)


    except HTTPError as exc:


        body = exc.read().decode("utf-8", errors="replace").strip()


        raise N8NPromptError(f"n8n devolvio HTTP {exc.code}: {body[:300]}") from exc


    except URLError as exc:


        raise N8NPromptError(f"No se pudo conectar con n8n: {exc}") from exc

    prompt = str(data.get("output", "")).strip()


    if not prompt:
        raise N8NPromptError("n8n no devolvio el campo output")

        raise N8NPromptError("n8n no devolvio el campo output")

    return clean_generated_prompt(prompt)


def save_prompt(prompt: str, path: Path = DEFAULT_PROMPT_FILE) -> Path:


    prompt = prompt.strip()


    if not prompt:
        raise ValueError("El prompt generado esta vacio")


    path.write_text(prompt + "\n", encoding="utf-8")


    return path


def main() -> int:

    parser = argparse.ArgumentParser()

    parser.add_argument("idea", nargs="?")

    args = parser.parse_args()

    try:
image_url = data.get("image_url")

if image_url:

    final_image = PROJECT_ROOT / "imagen_final.png"

    add_logo_to_footer_from_url(
        image_url,
        str(final_image),
        LOGO_URL
    )

    print("Logo agregado en pie del anuncio")
        idea = args.idea or Path(DEFAULT_IDEA_FILE).read_text().strip()

        with progress_bar("Generando prompt con IA de n8n..."):

            prompt = generate_prompt(idea)

        save_prompt(prompt)

        print(prompt)

        print(f"PROMPT_GUARDADO={DEFAULT_PROMPT_FILE}")

        # Si existe una imagen generada, insertar logo
        generated_image = PROJECT_ROOT / "generated_image.png"

        if generated_image.exists():

            final_image = PROJECT_ROOT / "imagen_final.png"

            add_logo_to_footer(
                str(generated_image),
                str(final_image),
                LOGO_URL
            )

            print("Logo agregado en pie del anuncio")

        return 0


    except Exception as exc:


        log_error(str(exc))


        return 1


if __name__ == "__main__":
    raise SystemExit(main())