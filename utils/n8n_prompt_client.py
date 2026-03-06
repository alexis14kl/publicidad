import argparse
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_IDEA_FILE = PROJECT_ROOT / "utils" / "prompt_seed.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"
DEFAULT_BRAND_HINT = (
    "Pieza publicitaria para NoyeCode enfocada en captar clientes reales de software. "
    "Debe verse premium, moderna, comercial, confiable y lista para campanas digitales. "
    "El texto dentro de la imagen si es importante porque estas piezas son para redes sociales y captacion comercial. "
    "Incluir copy comercial claro, CTA, web, WhatsApp y el servicio protagonista cuando el formato lo permita. "
    "Evitar imagenes genericas, pantallas gigantes irreales, cascos VR innecesarios, slogans confusos o logos invasivos dentro de la imagen. "
    "Bogota y Kennedy pueden existir como contexto sutil, pero nunca como protagonista visual principal."
)


class N8NPromptError(RuntimeError):
    pass


def clean_generated_prompt(prompt: str) -> str:
    text = " ".join(str(prompt).strip().split())
    lower = text.lower()

    markers = ["prompt:", "prompt final:", "prompt para imagen:"]
    for marker in markers:
        idx = lower.find(marker)
        if idx != -1:
            text = text[idx + len(marker):].strip()
            break

    return text.strip(" -\n\r\t")


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
    return "desarrollo a la medida"


def enrich_idea(idea: str) -> str:
    base = " ".join(idea.strip().split())
    lower = base.lower()
    primary_service = detect_primary_service(base)
    hints: list[str] = [DEFAULT_BRAND_HINT]

    hints.append(
        f"Servicio principal obligatorio de esta pieza: {primary_service}. "
        "No cambiarlo por otro servicio y no mezclar el protagonismo con otro producto."
    )
    hints.append(
        "La imagen debe vender un servicio concreto de NoyeCode, no una postal de ciudad. "
        "El sujeto principal debe ser el producto, el servicio o el resultado de negocio."
    )
    hints.append(
        "No centrar la composicion en la ciudad de Bogota, edificios urbanos o calles, salvo que el usuario lo pida de forma explicita."
    )
    hints.append(
        "No usar como recurso repetitivo pantallas gigantes en fachadas, codigo flotando en edificios ni escenas futuristas poco creibles."
    )
    hints.append(
        "Priorizar escenas comerciales creibles: reuniones con clientes, demo de producto, dashboards reales, software en uso, automatizacion operativa, modernizacion tecnológica y resultados empresariales."
    )
    hints.append(
        "La pieza debe sentirse como arte publicitario para redes sociales de NoyeCode, orientado a conversion y captacion de clientes."
    )
    hints.append(
        "Incluir dentro de la imagen un bloque de texto publicitario corto y bien jerarquizado con: nombre del servicio, beneficio principal, CTA, sitio web noyecode.com y WhatsApp +57 301 385 9952."
    )
    hints.append(
        f"El nombre del servicio destacado dentro del arte debe ser exactamente: {primary_service}."
    )
    hints.append(
        "Cuando encaje con formato de redes, incluir hashtags comerciales discretos como #NoyeCode #DesarrolloALaMedida #AutomatizacionEmpresarial #SoftwareEmpresarial #Bogota #Colombia."
    )
    hints.append(
        "Si se listan servicios complementarios, deben ir en segundo nivel visual y nunca opacar el servicio principal."
    )

    if "desarrollo a la medida" in lower or "a la medida" in lower:
        hints.append(
            "Servicio clave: desarrollo a la medida. "
            "Mostrar una solucion de software creada especificamente para una empresa: "
            "equipo de trabajo profesional, reunion de descubrimiento o entrega de producto, "
            "interfaces UI/UX limpias en laptops o pantallas reales, dashboards elegantes, "
            "colaboracion entre negocio y tecnologia, sensacion de software personalizado, escalable y de alto valor."
        )
        hints.append(
            "Composicion recomendada: escena corporativa moderna, personas reales o semi-realistas, "
            "producto digital visible, ambiente premium, iluminacion cinematica suave, profundidad de campo, "
            "4K, con texto publicitario integrado de forma elegante en el arte."
        )
        hints.append(
            "Evitar monitores desproporcionados, hologramas exagerados, interfaces imposibles o recursos visuales caricaturescos. "
            "Preferir escenas creibles de venta consultiva, demostracion de producto y confianza empresarial."
        )
        hints.append(
            "El texto recomendado dentro del arte debe resaltar ideas como: desarrollo a la medida, software personalizado, escalable, soporte experto, contactanos por WhatsApp, visita noyecode.com."
        )

    if "automatiza" in lower or "automatizacion" in lower or "automatizaciones" in lower:
        hints.append(
            "Si la pieza es sobre automatizaciones, reflejar eficiencia operativa, integraciones entre sistemas, "
            "flujos conectados, paneles de control y ahorro de tiempo para empresas."
        )

    if "android" in lower:
        hints.append(
            "Si la pieza es sobre desarrollo Android, mostrar app movil profesional en uso real, "
            "interfaz pulida, experiencia de usuario clara y contexto comercial."
        )

    if "desktop" in lower or "desk" in lower:
        hints.append(
            "Si la pieza es sobre desarrollo desktop, mostrar una aplicacion empresarial robusta en escritorio, "
            "paneles limpios, productividad, control operativo y entorno profesional."
        )

    if "legacy" in lower or "sistema legacy" in lower or "modernizacion" in lower or "actualizacion de sistema" in lower:
        hints.append(
            "Si la pieza trata de modernizacion legacy, representar evolucion tecnologica: "
            "antes y despues sutil, software antiguo transformandose en plataforma moderna, "
            "sin verse caotico ni demasiado tecnico."
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
        idea = args.idea
        if args.idea_file:
            idea = Path(args.idea_file).read_text(encoding="utf-8").strip()
        if not idea:
            raise ValueError("Debes enviar una idea o usar --idea-file")

        if args.stdout_only:
            prompt = generate_prompt(
                idea=idea,
                webhook_url=args.webhook_url,
                timeout=args.timeout,
            )
            print(prompt)
            return 0

        output_path = Path(args.output)
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
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
