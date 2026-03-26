"""
Prompt Client — genera prompts publicitarios via Anthropic Claude.

Reemplaza el antiguo flujo via webhook n8n. Ahora el enriquecimiento
de la idea base y la generación del prompt final se hacen directamente
con Claude (Sonnet → Haiku fallback).
"""
import argparse
import io
import os
import urllib.request
from pathlib import Path
from typing import Tuple

from PIL import Image

from core.utils.service_rotation import rotate_service
from core.utils.logger import log_error, log_info, progress_bar
from core.utils.claude_client import ask_claude

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.cfg.platform import PROMPT_FILE, PROMPT_SEED_FILE

DEFAULT_PROMPT_FILE = PROMPT_FILE
DEFAULT_IDEA_FILE = PROMPT_SEED_FILE

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


class PromptGenerationError(RuntimeError):
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

    logo_width = int(width * 0.20)
    ratio = logo_width / logo.width
    logo_height = int(logo.height * ratio)

    logo = logo.resize((logo_width, logo_height), Image.LANCZOS)

    x = (width - logo_width) // 2
    y = height - logo_height - 40

    footer_bg = Image.new("RGBA", (logo_width + 40, logo_height + 20), (255, 255, 255, 220))

    base_image.paste(footer_bg, (x - 20, y - 10), footer_bg)
    base_image.paste(logo, (x, y), logo)

    base_image.save(output_path)


def add_logo_to_footer_from_url(image_url: str, output_path: str, logo_url: str):
    """Descarga la imagen desde URL y agrega el logo centrado en el pie."""
    with urllib.request.urlopen(image_url) as response:
        image_data = response.read()

    base_image = Image.open(io.BytesIO(image_data)).convert("RGBA")
    width, height = base_image.size

    with urllib.request.urlopen(logo_url) as response:
        logo_data = response.read()

    logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")

    logo_width = int(width * 0.20)
    ratio = logo_width / logo.width
    logo_height = int(logo.height * ratio)

    logo = logo.resize((logo_width, logo_height), Image.LANCZOS)

    x = (width - logo_width) // 2
    y = height - logo_height - 40

    footer_bg = Image.new("RGBA", (logo_width + 40, logo_height + 20), (255, 255, 255, 220))

    base_image.paste(footer_bg, (x - 20, y - 10), footer_bg)
    base_image.paste(logo, (x, y), logo)

    base_image.convert("RGB").save(output_path)


# ==============================
# DETECCION DE SERVICIO
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


def detect_primary_service(text: str) -> str:
    lower = text.lower()
    if "desarrollo a la medida" in lower:
        return "desarrollo a la medida"
    if "rpa" in lower:
        return "rpas nativos"
    if "legacy" in lower:
        return "modernizacion de software legacy"
    if "android" in lower:
        return "desarrollo android"
    if "desktop" in lower:
        return "desarrollo desktop"
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


# ==============================
# ENRIQUECIMIENTO Y GENERACION
# ==============================

def enrich_idea(idea: str) -> Tuple[str, str]:
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
    hints.append(
        "NO incluir ilustraciones ni caricaturas. "
        "SI incluir interfaces digitales flotantes, dashboards y tecnologia."
    )

    enriched = f"{base}\n\nDirectrices:\n- " + "\n- ".join(hints)
    return enriched, primary_service


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


# ==============================
# SYSTEM PROMPT PARA CLAUDE
# ==============================

_SYSTEM_PROMPT = """Eres un director creativo experto en publicidad digital para redes sociales.

Tu tarea es recibir una idea base con directrices de marca y transformarla en UN SOLO prompt
optimizado para generar una imagen publicitaria con IA (DALL-E / ChatGPT).

REGLAS:
1. Responde SOLO con el prompt final en inglés. Nada más — sin explicaciones, sin prefijos, sin markdown.
2. El prompt debe describir una PIEZA PUBLICITARIA profesional para Facebook/Instagram Ads.
3. SIEMPRE incluir:
   - Fotografía realista de alta calidad (NO ilustración, NO vector, NO caricatura)
   - Persona real en ambiente profesional usando tecnología
   - Layout publicitario: titular grande, badge CTA naranja, caja de beneficios, banner inferior
   - Elementos tech: dashboards flotantes, interfaces digitales, gráficos
   - Colores de marca: morado #3469ED, naranja #fd9102, cyan #00bcd4
   - Fondo limpio blanco/gris claro #f0f0f5
4. El top 15% de la imagen debe quedar COMPLETAMENTE VACÍO (gradiente oscuro) para el logo.
5. Formato: vertical 4:5 (1080x1350px), full-bleed, sin bordes negros.
6. Incluir texto visible en español: slogan, headline, call-to-action, info de contacto.
7. Si la idea menciona un servicio específico, enfocarse SOLO en ese servicio.
8. NO inventar nombres de empresa ni servicios que no estén en la idea.
9. Máximo 200 palabras."""

def generate_prompt(
    idea: str,
    **_kwargs,
) -> str:
    """Genera un prompt publicitario enriquecido usando Claude directamente.

    Acepta **_kwargs para compatibilidad con callers antiguos que pasaban
    webhook_url, timeout, enriched_idea, etc.
    """
    idea = idea.strip()
    if not idea:
        raise ValueError("La idea base no puede estar vacia")

    enriched_idea, primary_service = enrich_idea(idea)

    log_info(f"Generando prompt con Claude para servicio: {primary_service}")

    user_prompt = (
        f"IDEA BASE CON DIRECTRICES:\n{enriched_idea}\n\n"
        f"Genera el prompt final en inglés para la imagen publicitaria."
    )

    response = ask_claude(_SYSTEM_PROMPT, user_prompt, max_tokens=1024)

    if not response:
        raise PromptGenerationError(
            "Claude no devolvió respuesta. Verifica ANTHROPIC_API_KEY en .env"
        )

    return clean_generated_prompt(response)


def save_prompt(prompt: str, path: Path = DEFAULT_PROMPT_FILE) -> Path:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("El prompt generado esta vacio")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(prompt + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera prompt publicitario con Anthropic Claude."
    )
    parser.add_argument("idea", nargs="?", help="Idea base directa.")
    parser.add_argument(
        "--idea-file",
        default=None,
        help="Archivo con la idea base (alternativa al argumento posicional).",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_PROMPT_FILE),
        help="Archivo donde se guardará el prompt generado.",
    )
    args = parser.parse_args()

    try:
        if args.idea:
            idea = args.idea
        elif args.idea_file:
            idea = Path(args.idea_file).read_text(encoding="utf-8").strip()
        else:
            idea = Path(DEFAULT_IDEA_FILE).read_text(encoding="utf-8").strip()

        with progress_bar("Generando prompt con Anthropic Claude..."):
            prompt = generate_prompt(idea)

        output_path = Path(args.output)
        save_prompt(prompt, output_path)

        print(prompt)
        print(f"PROMPT_GUARDADO={output_path}")

        generated_image = PROJECT_ROOT / "generated_image.png"
        if generated_image.exists():
            final_image = PROJECT_ROOT / "imagen_final.png"
            add_logo_to_footer(
                str(generated_image),
                str(final_image),
                LOGO_URL,
            )
            print("Logo agregado en pie del anuncio")

        return 0

    except Exception as exc:
        log_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
