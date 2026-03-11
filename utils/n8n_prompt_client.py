import argparse
import json
from contextlib import contextmanager
from pathlib import Path
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from utils.logger import log_error, progress_bar
except ModuleNotFoundError:
    def log_error(message: str) -> None:
        print(f"[ERROR] {message}", file=sys.stderr)

    @contextmanager
    def progress_bar(description: str):
        print(f"[INFO] {description}")
        yield

from utils.service_rotation import rotate_service


DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_IDEA_FILE = PROJECT_ROOT / "utils" / "prompt_seed.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"
DEFAULT_BRAND_HINT = (
    "Pieza publicitaria para NoyeCode enfocada en captar clientes reales de software. "
    "Debe verse premium, moderna, comercial, confiable y lista para campanas digitales. "
    "El texto dentro de la imagen si es importante porque estas piezas son para redes sociales y captacion comercial. "
    "Incluir copy comercial claro, CTA, web, WhatsApp y el servicio protagonista cuando el formato lo permita. "
    "Evitar imagenes genericas, pantallas gigantes irreales, cascos VR innecesarios, slogans confusos o logos invasivos dentro de la imagen. "
    "Bogota y Kennedy pueden existir como contexto sutil, pero nunca como protagonista visual principal. "
    "La composicion debe sentirse como una campana corporativa de alta gama, con jerarquia visual limpia, menos ruido y mejor direccion de arte."
)


class N8NPromptError(RuntimeError):
    pass


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

    for marker in ("prompt:", "prompt final:", "prompt para imagen:"):
        idx = lower.find(marker)
        if idx != -1:
            text = text[idx + len(marker):].strip()
            break

    text = text.strip(" -\n\r\t")
    lower = text.lower()
    if lower.startswith("creame una imagen de alta definicion grafica: contexto:"):
        body = text[len("CREAME UNA IMAGEN DE ALTA DEFINICION GRAFICA: contexto:"):].strip()
    elif lower.startswith("creame una imagen de alta definicion grafica:"):
        body = text[len("CREAME UNA IMAGEN DE ALTA DEFINICION GRAFICA:"):].strip()
    elif lower.startswith("genera una imagen; contexto:"):
        body = text[len("Genera una imagen; contexto:"):].strip()
    elif lower.startswith("genera una imagen:"):
        body = text[len("Genera una imagen:"):].strip()
    elif lower.startswith("genera una imagen"):
        body = text[len("Genera una imagen"):].lstrip(" :;,-")
    elif lower.startswith("crea una imagen"):
        body = text[len("Crea una imagen"):].lstrip(" :;,-")
    elif lower.startswith("imagina "):
        body = text[len("Imagina "):].lstrip(" :;,-")
    else:
        body = text

    for prefix in (
        "aqui tienes",
        "te sugiero",
        "te propongo",
        "puedes usar",
        "este prompt",
        "prompt final",
        "prompt para imagen",
    ):
        lowered_body = body.lower()
        if lowered_body.startswith(prefix):
            body = body[len(prefix):].lstrip(" :;,-")

    body = body.strip(" ;:-")
    return (
        "CREAME UNA IMAGEN DE ALTA DEFINICION GRAFICA. "
        f"CONTEXTO PUBLICITARIO: {body}. "
        "GENERA LA IMAGEN DIRECTAMENTE EN CALIDAD 4K, FORMATO VERTICAL 4:5 OPTIMIZADO PARA FEED DE FACEBOOK E INSTAGRAM, "
        "ESTILO PUBLICITARIO PREMIUM, ALTA CLARIDAD GRAFICA Y RESPETANDO MARGENES DE SEGURIDAD PARA QUE NINGUN TEXTO O ELEMENTO CLAVE QUEDE CORTADO EN LOS BORDES. "
        "ENTREGA EXACTAMENTE UNA SOLA IMAGEN FINAL. NO GENERES DOS OPCIONES, NO MUESTRES VARIANTES, NO HAGAS COMPARACIONES Y NO PREGUNTES CUAL IMAGEN PREFIERO."
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
    base = " ".join(idea.strip().split())
    primary_service = select_primary_service(base)
    hints = [DEFAULT_BRAND_HINT]
    hints.append(
        f"Servicio principal obligatorio de esta pieza: {primary_service}. "
        "No cambiarlo por otro servicio y no mezclar el protagonismo con otro producto."
    )
    hints.append(
        "La imagen debe vender un servicio concreto de NoyeCode, no una postal de ciudad. "
        "El sujeto principal debe ser el producto, el servicio o el resultado de negocio."
    )
    hints.append(
        "Priorizar escenas comerciales creibles: reuniones con clientes, demo de producto, dashboards reales, software en uso, automatizacion operativa, modernizacion tecnologica y resultados empresariales."
    )
    hints.append(
        "Formato obligatorio: vertical 4:5 optimizado para feed de Facebook e Instagram, con composicion pensada para verse completa al publicarse."
    )
    hints.append(
        "Dejar margenes de seguridad amplios en todos los lados. Ningun texto, logo, CTA, rostro o elemento clave debe quedar pegado a los bordes."
    )
    hints.append(
        "Mantener todo el contenido critico dentro de una zona segura central aproximada del 80 por ciento del lienzo."
    )
    hints.append(
        "Direccion de arte mas profesional: look corporativo premium, iluminacion cinematica controlada, paleta elegante, mejor jerarquia tipografica, profundidad realista y acabado limpio."
    )
    hints.append(
        "El resultado debe parecer una pieza de agencia para Meta Ads: mas limpio, mas aspiracional, mas creible y mejor balanceado visualmente."
    )
    hints.append(
        "Incluir dentro de la imagen un bloque de texto publicitario corto y bien jerarquizado con: nombre del servicio, beneficio principal, CTA, sitio web noyecode.com y WhatsApp +57 301 385 9952."
    )
    hints.append(
        "No incluir logos, isotipos, emblemas ni marcas de agua de ningun tipo dentro de la imagen generada."
    )
    hints.append(
        "Reservar espacio limpio en la parte superior para insertar despues el logo oficial local de NoyeCode en postproceso."
    )
    hints.append(
        "Reservar una franja superior libre de al menos 18 por ciento de la altura total. "
        "No poner ningun titular ni texto importante en esa franja."
    )
    hints.append(
        "Ubicar el titular principal mas abajo: iniciar el bloque de texto desde aproximadamente 22 a 25 por ciento de la altura."
    )
    hints.append(
        "No dibujar texto que imite el logo de marca ni variantes de logotipo."
    )
    hints.append(
        f"El nombre del servicio destacado dentro del arte debe ser exactamente: {primary_service}."
    )
    hints.append(
        "NO incluir hashtags ni simbolos # dentro de la imagen. Los hashtags se agregan despues en el caption de Facebook. La imagen debe quedar limpia sin texto tipo hashtag."
    )
    hints.append(
        "La respuesta debe empezar como una orden directa y operativa para generar imagen, no como una sugerencia."
    )
    hints.append(
        "No responder como asesor de prompts. No dar sugerencias. No explicar. No listar opciones. Solo entregar la instruccion final de generacion."
    )

    if primary_service == "desarrollo desktop":
        hints.append(
            "Si la pieza es sobre desarrollo desktop, mostrar una aplicacion empresarial robusta en escritorio, paneles limpios, productividad, control operativo y entorno profesional."
        )
    elif primary_service == "desarrollo android":
        hints.append(
            "Si la pieza es sobre desarrollo Android, mostrar app movil profesional en uso real, interfaz pulida, experiencia de usuario clara y contexto comercial."
        )
    elif primary_service == "automatizaciones empresariales":
        hints.append(
            "Si la pieza es sobre automatizaciones, reflejar eficiencia operativa, integraciones entre sistemas, flujos conectados, paneles de control y ahorro de tiempo para empresas."
        )
    elif primary_service == "modernizacion de software legacy":
        hints.append(
            "Si la pieza trata de modernizacion legacy, representar evolucion tecnologica: software antiguo transformandose en plataforma moderna, sin verse caotico ni demasiado tecnico."
        )
    elif primary_service == "rpas nativos":
        hints.append(
            "Si la pieza es sobre RPAs nativos, mostrar automatizacion de tareas repetitivas en flujos empresariales reales. Evitar robots humanoides."
        )
    else:
        hints.append(
            "Si la pieza es sobre desarrollo a la medida, mostrar una solucion creada especificamente para una empresa, con sensacion de software personalizado, escalable y de alto valor."
        )

    return f"{base}\n\nDirectrices internas para enriquecer la escena:\n- " + "\n- ".join(hints)


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
    parser.add_argument("idea", nargs="?", help="Idea base para que la IA la convierta en prompt completo")
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
