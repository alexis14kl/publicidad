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
    "Pieza publicitaria de OFERTA para NoyeCode enfocada en captar clientes reales de software. "
    "Debe verse como DISENO GRAFICO PREMIUM de oferta para redes sociales, NO como fotografia realista. "
    "NO usar personas reales, manos, rostros, oficinas, escritorios ni escenas fotograficas. "
    "Usar fondo limpio con gradiente elegante y composicion minimalista con dispositivos (laptop, smartphone, tablet). "
    "IMPORTANTE: El texto comercial debe incluir un GANCHO DE OFERTA claro (cotizacion gratis, descuento, demo sin costo, precio desde, cupos limitados). "
    "Incluir CTA urgente, web noyecode.com y WhatsApp +57 301 385 9952. "
    "La composicion debe sentirse como arte publicitario de agencia para Meta Ads orientado a CONVERSION y captacion de clientes."
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
    elif lower.startswith("imagina una escena"):
        body = "una escena" + text[len("Imagina una escena"):]
    elif lower.startswith("imagina una imagen"):
        body = text[len("Imagina una imagen"):].lstrip(" :;,-")
    elif lower.startswith("imagina "):
        body = text[len("Imagina "):].lstrip(" :;,-")
    elif lower.startswith("una imagen "):
        body = text[len("una imagen "):].lstrip(" :;,-")
    elif lower.startswith("la imagen "):
        body = text[len("La imagen "):].lstrip(" :;,-")
    else:
        body = text

    advisory_prefixes = [
        "aqui tienes",
        "te sugiero",
        "te propongo",
        "puedes usar",
        "este prompt",
        "prompt final",
        "prompt para imagen",
    ]
    lowered_body = body.lower()
    for prefix in advisory_prefixes:
        if lowered_body.startswith(prefix):
            body = body[len(prefix):].lstrip(" :;,-")
            lowered_body = body.lower()

    body = body.strip(" ;:-")
    return (
        "CREAME UNA IMAGEN DE ALTA DEFINICION GRAFICA DE OFERTA PUBLICITARIA. "
        f"CONTEXTO PUBLICITARIO: {body}. "
        "ZONA DE LOGO: El 15 por ciento superior de la imagen debe ser COMPLETAMENTE VACIO, solo el gradiente oscuro del fondo visible. "
        "Ningun texto, icono, grafico ni elemento en esa zona. Todo el contenido del anuncio empieza DEBAJO del 15 por ciento superior. "
        "FULL BLEED: El fondo con gradiente debe llenar el 100 por ciento del lienzo de borde a borde, sin margenes internos, sin bordes negros, sin espacios vacios. "
        "ESTILO: Diseno grafico publicitario premium de OFERTA, NO fotografia realista. NO personas, NO oficinas, NO rostros. "
        "Mockups de dispositivos con interfaces limpias sobre fondo con gradiente elegante que llega hasta los bordes. "
        "Incluir texto de oferta visible: gancho comercial, CTA urgente, web y WhatsApp. "
        "NO escribir NoyeCode ni ninguna variacion del nombre de la marca dentro de la imagen. "
        "GENERA LA IMAGEN DIRECTAMENTE EN CALIDAD 4K, FORMATO VERTICAL 4:5 OPTIMIZADO PARA FEED DE FACEBOOK E INSTAGRAM, "
        "FULL BLEED SIN MARGENES INTERNOS, ALTA CLARIDAD GRAFICA. "
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
    hints: list[str] = [DEFAULT_BRAND_HINT]

    hints.append(
        f"Servicio principal obligatorio de esta pieza: {primary_service}. "
        "No cambiarlo por otro servicio y no mezclar el protagonismo con otro producto."
    )
    hints.append(
        "REGLA CRITICA DE COMPOSICION - ZONA DE LOGO: El 15% superior de la imagen debe ser COMPLETAMENTE VACIO, "
        "solo el gradiente oscuro del fondo (#1a1a2e) visible ahi. NINGUN texto, icono, grafico ni elemento puede aparecer en esa zona. "
        "El logo real de la empresa se superpone ahi despues programaticamente. "
        "Todo el contenido del anuncio (titulos, mockups, CTA, contacto) debe empezar DEBAJO del 15% superior."
    )
    hints.append(
        "REGLA CRITICA - FULL BLEED: La imagen debe llenar el 100% del lienzo de BORDE A BORDE. "
        "El fondo con gradiente debe extenderse hasta los 4 bordes sin margenes internos, sin bordes negros, sin espacios vacios en los laterales. "
        "La imagen debe verse perfecta en el contenedor de Facebook e Instagram sin barras negras ni areas vacias."
    )
    hints.append(
        "ESTILO OBLIGATORIO: La imagen debe parecer DISENO GRAFICO publicitario de OFERTA para social media, NO fotografia realista. "
        "NO incluir personas reales, manos, rostros humanos, oficinas, escritorios ni escenas fotograficas. "
        "Usar composicion minimalista con gradientes elegantes y mockups de dispositivos (laptop, smartphone, tablet) con interfaces SaaS limpias en pantalla."
    )
    hints.append(
        "La imagen debe vender un servicio concreto de NoyeCode con ENFOQUE EN OFERTA Y CONVERSION. "
        "Incluir un gancho comercial visible: cotizacion gratis, descuento, demo sin costo, precio desde, cupos limitados. "
        "El sujeto principal debe ser el mockup del producto digital con interfaz creible."
    )
    hints.append(
        "No centrar la composicion en la ciudad de Bogota, edificios urbanos o calles."
    )
    hints.append(
        "No usar como recurso repetitivo pantallas gigantes en fachadas, codigo flotando en edificios ni escenas futuristas poco creibles."
    )
    hints.append(
        "Priorizar mockups de dispositivos con dashboards, graficos, metricas y tablas segun el servicio. "
        "La interfaz en pantalla debe apoyar el mensaje comercial."
    )
    hints.append(
        "La pieza debe sentirse como arte publicitario de OFERTA de NoyeCode para redes sociales, "
        "orientado a conversion y captacion de clientes con gancho comercial claro y CTA urgente."
    )
    hints.append(
        "Formato obligatorio: vertical 4:5 (1080x1350px logico) optimizado para feed de Facebook e Instagram. "
        "El diseno debe ser FULL BLEED: fondo de borde a borde, sin margenes internos ni bordes negros. "
        "El texto y elementos importantes deben tener un pequeno margen del borde para no cortarse, pero el fondo debe llegar hasta el borde."
    )
    hints.append(
        "Direccion de arte: look de diseno grafico premium de OFERTA, paleta elegante (naranja #fd9102, fondo oscuro gradiente de #1a1a2e a #16213e). "
        "El gradiente superior debe fluir suavemente hacia #1a1a2e para que el area del logo se integre sin cortes. "
        "Mejor jerarquia tipografica, composicion minimalista y acabado limpio de agencia."
    )
    hints.append(
        "El resultado debe parecer un anuncio de oferta de agencia para Meta Ads: limpio, moderno, minimalista y orientado a conversion. "
        "NO debe parecer foto de stock ni fotografia realista."
    )
    hints.append(
        "Incluir dentro de la imagen un bloque de texto publicitario corto y bien jerarquizado con: "
        "gancho de oferta (ej: 'Cotizacion GRATIS', 'Demo sin costo', 'Desde $XXX'), "
        "nombre del servicio, beneficio principal, CTA urgente, sitio web noyecode.com y WhatsApp +57 301 385 9952."
    )
    hints.append(
        f"El nombre del servicio destacado dentro del arte debe ser exactamente: {primary_service}."
    )
    hints.append(
        "NO incluir hashtags ni simbolos # dentro de la imagen. Los hashtags se agregan despues en el caption de Facebook. La imagen debe quedar limpia sin texto tipo hashtag."
    )
    hints.append(
        "Si se listan servicios complementarios, deben ir en segundo nivel visual y nunca opacar el servicio principal."
    )
    hints.append(
        "Salida obligatoria: devolver una sola instruccion final lista para pegar en ChatGPT y generar la imagen de inmediato."
    )
    hints.append(
        "La generacion debe producir exactamente una sola imagen final. Prohibido devolver variantes, comparativas, opciones A/B o preguntas de seleccion."
    )
    hints.append(
        "La respuesta debe empezar como una orden directa y operativa para generar imagen, no como una sugerencia."
    )
    hints.append(
        "Prohibido empezar con frases como 'Imagina', 'Visualiza', 'Una imagen de', 'La imagen debe', 'Aqui tienes', 'Te sugiero' o cualquier explicacion."
    )
    hints.append(
        "No responder como asesor de prompts. No dar sugerencias. No explicar. No listar opciones. Solo entregar la instruccion final de generacion."
    )
    hints.append(
        "Cada respuesta debe variar el contexto visual para evitar escenas repetidas. Alternar entre: "
        "laptop en angulo 3/4 con dashboard, smartphone con app de campo, laptop y tablet mostrando la misma plataforma, "
        "laptop con workflow de automatizacion, composicion hero con laptop y smartphone, monitor con analytics en tiempo real. "
        "Siempre mockups de dispositivos, nunca personas ni oficinas."
    )
    hints.append(
        "No repetir siempre la misma composicion. Cambiar encuadre del dispositivo, angulo, tipo de interfaz en pantalla y estilo de gradiente del fondo."
    )

    if primary_service == "desarrollo a la medida":
        hints.append(
            "Servicio clave: desarrollo a la medida. "
            "Mostrar un mockup de laptop o tablet con interfaz UI/UX limpia, dashboards elegantes y "
            "sensacion de software personalizado, escalable y de alto valor."
        )
        hints.append(
            "Composicion recomendada: fondo con gradiente oscuro elegante, mockup de dispositivo con producto digital visible, "
            "tipografia bold moderna, 4K, con texto publicitario integrado de forma elegante."
        )
        hints.append(
            "Evitar monitores desproporcionados, hologramas exagerados, interfaces imposibles o recursos visuales caricaturescos."
        )
        hints.append(
            "El texto dentro del arte debe resaltar: desarrollo a la medida, software personalizado, CTA corto, noyecode.com y WhatsApp."
        )

    if primary_service == "automatizaciones empresariales":
        hints.append(
            "Si la pieza es sobre automatizaciones, mostrar mockup de laptop con workflow de automatizacion limpio y profesional, "
            "flujos conectados, paneles de control y visualizacion de eficiencia operativa."
        )
        hints.append(
            "Variar entre mockups de workflows, diagramas de integracion en pantalla, dashboards de procesos y tableros de productividad."
        )

    if primary_service == "desarrollo android":
        hints.append(
            "Si la pieza es sobre desarrollo Android, mostrar mockup de smartphone con app movil profesional, "
            "interfaz pulida con metricas, mapas o tareas segun el servicio."
        )
        hints.append(
            "NO mostrar manos ni personas. Solo el dispositivo como mockup limpio sobre fondo con gradiente."
        )
        hints.append(
            "Cuidar que la interfaz del movil no quede demasiado pegada al borde ni recortada. Mantener el celular y el copy dentro de la zona segura central."
        )

    if primary_service == "desarrollo desktop":
        hints.append(
            "Si la pieza es sobre desarrollo desktop, mostrar mockup de laptop o monitor con aplicacion empresarial robusta, "
            "paneles limpios, dashboards de productividad y control operativo."
        )
        hints.append(
            "Usar composicion de mockup de dispositivo sobre fondo gradiente, sin personas ni oficinas."
        )

    if primary_service == "modernizacion de software legacy":
        hints.append(
            "Si la pieza trata de modernizacion legacy, representar evolucion tecnologica: "
            "antes y despues sutil, software antiguo transformandose en plataforma moderna, "
            "sin verse caotico ni demasiado tecnico."
        )
        hints.append(
            "Enfatizar migracion, actualizacion, continuidad operativa y modernizacion visual del sistema."
        )
        hints.append(
            "Usar composicion comparativa o de transformacion, pero sin partir la imagen de forma brusca ni empujar el contenido importante a los extremos."
        )

    if primary_service == "rpas nativos":
        hints.append(
            "Si la pieza es sobre RPAs nativos, mostrar automatizacion de tareas repetitivas en flujos empresariales reales, con tableros claros, procesos conectados y sensacion de eficiencia operativa."
        )
        hints.append(
            "Evitar robots humanoides. Representar el RPA como inteligencia operativa aplicada al negocio."
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
