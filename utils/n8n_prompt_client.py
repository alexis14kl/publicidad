import argparse
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from service_rotation import rotate_service
from logger import log_error, progress_bar


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_IDEA_FILE = PROJECT_ROOT / "utils" / "prompt_seed.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"
DEFAULT_BRAND_HINT = (
    "Anuncio de OFERTA visualmente EXPLOSIVO para NoyeCode. Estilo: diseno grafico de agencia premium, NO fotografia. "
    "TITULO BOLD gigante con efecto de profundidad (sombra o resplandor naranja). "
    "Mockup de dispositivo GRANDE en angulo 3/4 flotando con sombra de elevacion y halo de luz detras. "
    "CTA como BOTON naranja #fd9102 clicable con texto blanco. "
    "Fondo gradiente ultra oscuro #0d0d1a a #1a1a2e. Destellos, particulas luminosas y lineas de energia. "
    "Contraste alto: naranja vibrante + cyan electrico #00d4ff sobre oscuro. "
    "Pie: noyecode.com y +57 301 385 9952."
)


class N8NPromptError(RuntimeError):
    pass


SERVICE_HASHTAGS = {
    "desarrollo a la medida": "#NoyeCode #DesarrolloALaMedida #SoftwareEmpresarial #Colombia",
    "automatizaciones empresariales": "#NoyeCode #AutomatizacionEmpresarial #Productividad #SoftwareEmpresarial",
    "modernizacion de software legacy": "#NoyeCode #ModernizacionLegacy #TransformacionDigital #SoftwareEmpresarial",
    "rpas nativos": "#NoyeCode #RPAsNativos #Automatizacion #EficienciaOperativa",
    "desarrollo android": "#NoyeCode #DesarrolloAndroid #AppsEmpresariales #TransformacionDigital",
    "desarrollo desktop": "#NoyeCode #DesarrolloDesktop #SoftwareEmpresarial #Productividad",
}

# Hints especificos por servicio: breves y enfocados en la escena visual
_SERVICE_SCENE_HINTS = {
    "desarrollo a la medida": (
        "Laptop grande en perspectiva 3/4 flotando con sombra de elevacion, pantalla mostrando dashboard UI moderno "
        "con graficos de barras coloridos y metricas en cyan y naranja. Halo de luz naranja detras del dispositivo. "
        "Particulas brillantes flotando alrededor. Titulo bold gigante sobre el mockup."
    ),
    "automatizaciones empresariales": (
        "Laptop en angulo dinamico mostrando workflow de automatizacion con nodos conectados por lineas brillantes cyan. "
        "Flechas de flujo luminosas saliendo de la pantalla. Iconos de engranajes y rayos flotando con efecto de brillo. "
        "Lineas de velocidad sutiles para transmitir eficiencia y movimiento."
    ),
    "desarrollo android": (
        "Smartphone grande inclinado en angulo dramatico mostrando app profesional con interfaz moderna, "
        "metricas en tiempo real y graficos interactivos. Reflejos de luz en los bordes del telefono. "
        "Elementos UI flotando fuera de la pantalla con efecto parallax y destellos."
    ),
    "desarrollo desktop": (
        "Monitor widescreen en perspectiva 3/4 mostrando aplicacion empresarial con multiples paneles, "
        "tablas de datos y graficos de rendimiento. Efecto de luz volumetrica saliendo de la pantalla. "
        "Composicion diagonal con el monitor dominando la escena."
    ),
    "modernizacion de software legacy": (
        "Transicion visual dramatica: lado izquierdo interfaz opaca y vieja desintegrando en pixeles, "
        "lado derecho plataforma moderna brillante con UI limpia emergiendo con destellos de luz. "
        "Flecha o flujo de energia naranja conectando la transformacion. Efecto cinematico."
    ),
    "rpas nativos": (
        "Laptop mostrando panel de control con flujos de automatizacion, iconos de tareas conectados "
        "por lineas de energia brillantes cyan. Engranajes estilizados y circuitos luminosos flotando alrededor. "
        "Transmitir velocidad y precision operativa. Evitar robots humanoides."
    ),
}


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
    """Limpia el prompt de n8n y lo prepara para ChatGPT/DALL-E.

    Estrategia: el prompt de n8n ya viene en ingles y bien formado.
    Solo necesitamos:
    1. Limpiar prefijos conversacionales que la IA de n8n pueda agregar
    2. Agregar un wrapper MINIMO en ingles (no espanol) para ChatGPT
    3. Reforzar las 2 reglas criticas: zona de logo y full bleed
    """
    text = " ".join(str(prompt).strip().split())
    lower = text.lower()

    # Quitar prefijos tipo "Prompt:", "Prompt final:", etc.
    markers = ["prompt:", "prompt final:", "prompt para imagen:"]
    for marker in markers:
        idx = lower.find(marker)
        if idx != -1:
            text = text[idx + len(marker):].strip()
            lower = text.lower()
            break

    # Quitar prefijos conversacionales en espanol
    conversational_prefixes = [
        "aqui tienes", "te sugiero", "te propongo", "puedes usar",
        "este prompt", "prompt final", "prompt para imagen",
        "creame una imagen de alta definicion grafica: contexto:",
        "creame una imagen de alta definicion grafica:",
        "genera una imagen; contexto:",
        "genera una imagen:", "genera una imagen",
        "crea una imagen", "imagina una escena",
        "imagina una imagen", "imagina ",
        "una imagen ", "la imagen ",
    ]
    # Ordenar por longitud descendente para que los prefijos mas largos se prueben primero
    conversational_prefixes.sort(key=len, reverse=True)
    changed = True
    while changed:
        changed = False
        lowered = text.lower()
        for prefix in conversational_prefixes:
            if lowered.startswith(prefix):
                text = text[len(prefix):].lstrip(" :;,-")
                changed = True
                break

    text = text.strip(" ;:-\n\r\t")

    # Wrapper minimo en INGLES para ChatGPT - no duplicar lo que n8n ya dijo
    return (
        f"Generate this image now: {text} "
        "CRITICAL: The top 15% of the image must be completely empty dark gradient only - "
        "no text, no icons, no elements of any kind. Logo is added programmatically later. "
        "Full-bleed, no black bars, no margins. "
        "Deliver exactly ONE final image, vertical 4:5, 4K resolution."
    ).strip()


def detect_primary_service(text: str) -> str:
    lower = text.lower()
    if "desarrollo a la medida" in lower or "a la medida" in lower:
        return "desarrollo a la medida"
    if "rpa" in lower or "rpas" in lower:
        return "rpas nativos"
    if "legacy" in lower or "modernizacion" in lower or "actualizacion de software" in lower:
        return "modernizacion de software legacy"
    if "android" in lower:
        return "desarrollo android"
    if "desktop" in lower or "desk" in lower:
        return "desarrollo desktop"
    if "automatiza" in lower or "automatizacion" in lower or "automatizaciones" in lower:
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
    """Enriquece la idea con hints CONCISOS antes de enviar a n8n.

    Principio: maximo 6 hints cortos. Cada hint aporta informacion unica.
    No repetir conceptos. n8n ya tiene el prompt_seed.txt con las reglas base.
    """
    base = " ".join(idea.strip().split())
    primary_service = select_primary_service(base)
    hints: list[str] = []

    # Hint 1: Contexto de marca (corto)
    hints.append(DEFAULT_BRAND_HINT)

    # Hint 2: Servicio obligatorio
    hints.append(
        f"Servicio protagonista de esta pieza: {primary_service}. "
        "No cambiarlo ni mezclar con otros servicios."
    )

    # Hint 3: Escena visual especifica del servicio
    scene_hint = _SERVICE_SCENE_HINTS.get(primary_service)
    if scene_hint:
        hints.append(scene_hint)

    # Hint 4: Zona de logo (la regla mas critica, una sola vez)
    hints.append(
        "ZONA DE LOGO: 15% superior de la imagen COMPLETAMENTE VACIO (solo gradiente oscuro). "
        "Todo el contenido empieza debajo de esa zona."
    )

    # Hint 5: Impacto visual y composicion
    hints.append(
        "IMPACTO VISUAL OBLIGATORIO: titulo en tipografia BOLD gigante con efecto de profundidad. "
        "Composicion diagonal o asimetrica, NUNCA todo centrado y plano. "
        "CTA como BOTON naranja clicable. Destellos, particulas luminosas y halos de luz. "
        "Contraste extremo: naranja #fd9102 + cyan #00d4ff sobre fondo ultra oscuro. "
        "El mockup debe ser GRANDE y prominente, no pequeno y perdido."
    )

    # Hint 6: Restricciones clave (una sola vez, consolidadas)
    hints.append(
        "NO incluir: personas, oficinas, logos de marca, hashtags, fotografia realista, disenos planos o genericos. "
        "SI incluir: texto de oferta urgente en espanol, boton CTA naranja, contacto al pie, "
        "elementos de energia visual (destellos, particulas, lineas de luz)."
    )

    return f"{base}\n\nDirectrices:\n- " + "\n- ".join(hints)


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
        raise N8NPromptError(f"n8n no devolvio el campo output: {json.dumps(data, ensure_ascii=False)}")
    return clean_generated_prompt(prompt)


def save_prompt(prompt: str, path: Path = DEFAULT_PROMPT_FILE) -> Path:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("El prompt generado esta vacio")
    path.write_text(prompt + "\n", encoding="utf-8")
    return path


def generate_and_save(
    idea: str,
    output_path: Path = DEFAULT_PROMPT_FILE,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    timeout: int = 60,
) -> str:
    prompt = generate_prompt(idea=idea, webhook_url=webhook_url, timeout=timeout)
    save_prompt(prompt, path=output_path)
    return prompt


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera un prompt usando n8n y opcionalmente lo guarda en utils/prontm.txt",
    )
    parser.add_argument(
        "idea",
        nargs="?",
        help="Idea base para que la IA la convierta en prompt completo",
    )
    parser.add_argument(
        "--idea-file",
        default=str(DEFAULT_IDEA_FILE),
        help=f"Archivo de texto cuyo contenido se usa como idea base. Default: {DEFAULT_IDEA_FILE}",
    )
    parser.add_argument(
        "--webhook-url",
        default=DEFAULT_WEBHOOK_URL,
        help=f"Webhook de n8n. Default: {DEFAULT_WEBHOOK_URL}",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_PROMPT_FILE),
        help=f"Archivo destino. Default: {DEFAULT_PROMPT_FILE}",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Timeout en segundos para la llamada HTTP",
    )
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="Solo imprime el prompt generado y no lo guarda en archivo",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.idea:
            idea = args.idea.strip()
        elif args.idea_file:
            idea = Path(args.idea_file).read_text(encoding="utf-8").strip()
        else:
            idea = ""
        if not idea:
            raise ValueError("Debes enviar una idea o usar --idea-file")

        if args.stdout_only:
            with progress_bar("Generando prompt con IA de n8n..."):
                prompt = generate_prompt(
                    idea=idea,
                    webhook_url=args.webhook_url,
                    timeout=args.timeout,
                )
            print(prompt)
            return 0

        output_path = Path(args.output)
        with progress_bar("Generando prompt con IA de n8n..."):
            prompt = generate_and_save(
                idea=idea,
                output_path=output_path,
                webhook_url=args.webhook_url,
                timeout=args.timeout,
            )
        print(prompt)
        print(f"PROMPT_GUARDADO={output_path}")
        return 0
    except Exception as exc:
        log_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
