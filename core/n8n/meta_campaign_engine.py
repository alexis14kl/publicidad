"""
Meta Campaign Engine v4 — Motor autónomo SIN hardcodes.

El LLM (via n8n) es el cerebro que analiza y decide:
- Audiencias, segmentación, ciudades, edades, intereses
- Copy de anuncios, headlines, CTAs
- Distribución de presupuesto
- Calendario óptimo

Los únicos datos fijos son: credenciales API, IDs de cuenta, endpoints.
Todo lo demás es resultado del análisis del modelo de IA.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

# Fix SSL certificates on macOS
try:
    import certifi
    _ctx = ssl.create_default_context(cafile=certifi.where())
    urllib.request.install_opener(
        urllib.request.build_opener(urllib.request.HTTPSHandler(context=_ctx))
    )
except ImportError:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# Load .env so ANTHROPIC_API_KEY and other vars are available
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass


# Load .env so ANTHROPIC_API_KEY and other vars are available
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

from core.utils.logger import log_info, log_ok, log_warn, log_error
from core.utils.claude_client import ask_claude

# ---------------------------------------------------------------------------
# Config — SOLO credenciales y endpoints, nada de estrategia
# ---------------------------------------------------------------------------
GRAPH_API_VERSION = "v22.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
DEFAULT_AD_ACCOUNT = "act_438871067037500"
DEFAULT_PAGE_ID = "115406607722279"
DEFAULT_LOCALE = "es_LA"

# ---------------------------------------------------------------------------
# Anthropic Claude — importado de core.utils.claude_client
# ---------------------------------------------------------------------------
# ask_claude() se importa de core.utils.claude_client (línea 48)


def _load_skills_knowledge() -> str:
    """Lee los skills de marketing y los agentes para inyectar su conocimiento al LLM."""
    skills_dir = PROJECT_ROOT / ".claude" / "skills"
    agents_dir = PROJECT_ROOT / "core" / "utils" / "AgenteMarketing"
    knowledge = []

    # Skills relevantes para campañas
    skill_files = ["paid-ads.md", "ad-creative.md", "copywriting.md", "marketing-psychology.md"]
    for fname in skill_files:
        fpath = skills_dir / fname
        if fpath.exists():
            content = fpath.read_text("utf-8").strip()
            # Extract only the content after the frontmatter
            if "---" in content:
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    content = parts[2].strip()
            knowledge.append(f"[SKILL: {fname.replace('.md','')}]\n{content}")

    # Agentes relevantes
    agent_files = ["ads-analyst.md", "image-creator.md", "marketing.md", "video-scene-creator.md"]
    for fname in agent_files:
        fpath = agents_dir / fname
        if fpath.exists():
            content = fpath.read_text("utf-8").strip()
            # video-scene-creator necesita más contexto para generar escenas de calidad
            limit = 6000 if "video-scene" in fname else 2000
            content = content[:limit]
            knowledge.append(f"[AGENTE: {fname.replace('.md','')}]\n{content}")

    return "\n\n".join(knowledge)


def ai_generate_strategy(user_request: str, budget: str, webhook_url: str = "", content_type: str = "campaign", user_language: str = "es") -> dict[str, Any]:
    """
    Envía el preprompt del usuario + conocimiento de skills/agentes a Claude.
    Claude razona con la expertise de los multiagentes para generar la estrategia.
    """
    skills_knowledge = _load_skills_knowledge()

    system_prompt = f"""Eres un equipo de agentes expertos en marketing digital, media buying y creación de contenido publicitario.

Tienes el conocimiento combinado de estos agentes especialistas:
- ads-analyst: análisis competitivo, segmentación, briefs publicitarios
- image-creator: dirección visual, prompts para generación de imágenes con IA
- marketing: copy persuasivo, compliance, ejecución de campañas
- video-scene-creator: narrativa visual, escenas de video para redes
- paid-ads: estrategia de medios pagados, presupuesto, plataformas
- ad-creative: ángulos creativos, formatos por plataforma
- copywriting: principios de copy (claridad > creatividad, beneficios > features)
- marketing-psychology: modelos mentales, Cialdini, behavioral triggers

BASE DE CONOCIMIENTO DE LOS AGENTES:
{skills_knowledge}

INSTRUCCIONES:
Analiza la solicitud del usuario como lo haría un equipo de agentes expertos.
Cada decisión debe tener una razón basada en los frameworks de los agentes.

IMPORTANTE: Genera EXACTAMENTE 1 audiencia y 1 anuncio. NO crear múltiples audiencias ni múltiples ads. Una sola audiencia con budget_pct=1.0 y un solo ad con audience_index=0.

IDIOMA OBLIGATORIO: TODOS los campos del JSON DEBEN estar en ESPAÑOL COLOMBIANO.
La ÚNICA excepción es "image_prompt" que debe estar en inglés (es para el generador de IA).
Campos como campaign_name, analysis, primary_text, headline, description, reasoning, post_caption, post_hashtags, voiceover, warnings — TODO en español.

Responde SOLO en JSON válido (sin markdown, sin backticks, sin texto extra):

{{
  "campaign_name": "nombre creativo y descriptivo EN ESPAÑOL",
  "analysis": "análisis estratégico: qué entendiste de la solicitud, qué oportunidad detectas, qué enfoque elegiste y por qué (usa los frameworks de los agentes)",
  "content_type": "{content_type}",
  "calendar": {{
    "recommended_days": número,
    "start_day": "día óptimo para lanzar",
    "reasoning": "justificación basada en el comportamiento de la audiencia objetivo"
  }},
  "audiences": [
    {{
      "name": "nombre del segmento",
      "budget_pct": 0.0 a 1.0,
      "age_min": número,
      "age_max": número,
      "cities": ["ciudad1", "ciudad2"],
      "city_radius_km": número,
      "interests_search_terms": ["término1", "término2"],
      "destination": "lead_form",
      "cta": "SIGN_UP" | "LEARN_MORE" | "GET_QUOTE" | "CONTACT_US",
      "reasoning": "por qué esta audiencia, qué framework del agente aplica"
    }}
  ],
  "ads": [
    {{
      "audience_index": 0,
      "angle": "dolor | resultado | prueba_social | curiosidad | comparación | identidad",
      "primary_text": "copy del anuncio en español colombiano (max 500 chars). Aplica: Hook→Contexto→Valor→Prueba→CTA",
      "headline": "titular EN ESPAÑOL (max 40 chars)",
      "description": "descripción corta EN ESPAÑOL (max 30 chars)",
      "reasoning": "qué principio psicológico aplica EN ESPAÑOL (Cialdini, loss aversion, etc.)"
    }}
  ],
  "post_caption": "OBLIGATORIO. Texto completo para la publicación en redes sociales (en español colombiano). Aplica el framework del agente copywriting: Hook (primera línea impactante que detenga el scroll) → Contexto (por qué importa ahora) → Valor (qué ofrece la empresa) → Prueba (dato, testimonio o credibilidad) → CTA (acción clara: visita la web, escríbenos, agenda). Usa emojis estratégicamente. Menciona el nombre de la empresa. Máximo 300 palabras. NO repetir la solicitud del usuario literalmente — transforma la idea en copy profesional que venda.",
  "post_hashtags": "OBLIGATORIO. Array de 8-15 hashtags EN ESPAÑOL. Mezclar: 3-4 hashtags de nicho específico del servicio/producto, 3-4 hashtags de la industria o sector, 2-3 hashtags de ubicación (Colombia, ciudad), 1-2 hashtags de la marca del usuario. Sin # en el valor.",
  "image_prompt": "prompt EN INGLÉS para el generador de IA. IMPORTANTE: (1) Debe reflejar LITERALMENTE lo que el usuario pidió. (2) Todo texto visible en la imagen (slogan, headline, CTA, contacto) DEBE estar EN ESPAÑOL. Ejemplo: 'with visible Spanish text: Automatiza tu negocio'. (3) Debe parecer un anuncio profesional de redes sociales. (4) Formato: 1080x1350 vertical, zona superior 15% limpia para logo. (5) Estilo: high-quality professional advertising photography, vibrant colors.",
  "video_scenes": [
    {{
      "scene_number": 1,
      "duration_seconds": 7,
      "visual_description": "prompt visual EN INGLÉS para Veo 3 (estilo, personajes, acción, cámara, iluminación). Terminar con: No text, no logos, no brand names visible.",
      "voiceover": "diálogo o narración EN ESPAÑOL LATINO que el personaje DICE en voz alta en la escena (8-16 palabras, natural, claro). Este texto se inyecta como voz hablada en el video.",
      "camera": "tipo de toma"
    }}
  ],
  "warnings": ["alertas relevantes"]
}}

REGLAS CRÍTICAS:
1. SOLO JSON válido. Nada antes ni después.
2. Respeta el TIPO DE CONTENIDO:
   - "image": genera image_prompt + post_caption + post_hashtags. audiences y ads pueden estar vacíos [].
   - "video": genera image_prompt + video_scenes + post_caption + post_hashtags. audiences y ads pueden estar vacíos []. NO generar audiences ni ads para videos orgánicos.
   - "campaign": genera TODO: audiences + ads + image_prompt + post_caption + post_hashtags + calendar. Si la campaña se beneficia de video, incluye también video_scenes.
3. post_caption y post_hashtags son OBLIGATORIOS para TODOS los tipos. NUNCA dejarlos vacíos.
   - post_caption: copy profesional (Hook→Contexto→Valor→Prueba→CTA). NO repetir el prompt del usuario.
   - post_hashtags: 8-15 hashtags relevantes.
4. El image_prompt SIEMPRE debe ser una pieza PUBLICITARIA profesional:
   - Incluir texto visible en español: slogan, headline, call-to-action
   - Incluir el NOMBRE REAL de la empresa si se menciona en la solicitud (NO inventar nombres)
   - Incluir número de WhatsApp o web de la empresa si se proporcionaron
   - Reflejar EXACTAMENTE lo que el usuario pidió visualmente
   - NO generar fotos genéricas sin texto publicitario
5. Los copies deben aplicar Hook→Contexto→Valor→Prueba→CTA del agente copywriting.
6. Cada ángulo de anuncio debe usar un principio psicológico diferente.
7. Presupuesto bajo (<$10,000/día): 1-2 audiencias. Medio ($10K-50K): 2-3. Alto (>$50K): 3-5.
8. Las ciudades deben ser relevantes al concepto.
9. IMPORTANTE para tipo "video": El image_prompt se usa para generar el video en Veo 3. Reglas ESTRICTAS para video:
   - Describir SOLO la escena visual, acciones y ambiente. NO incluir texto en pantalla.
   - PROHIBIDO poner texto, logos, nombres de empresa, slogans, titulares, numeros de telefono, URLs o cualquier texto visible en el prompt de video.
   - PROHIBIDO describir pantallas de computador que muestren nombres de software, dashboards con titulos, o cualquier UI con texto legible. Si hay pantallas, deben mostrar graficos abstractos sin texto.
   - Razon: la IA de video NO puede renderizar texto correctamente — SIEMPRE genera errores ortograficos, logos inventados (como "LOGCOX", "TECHFLOW", etc.) y marcas ficticias que dañan el branding real.
   - El texto, logo e info de contacto se agregan DESPUES como overlay profesional sobre el video con ffmpeg.
   - Enfocarse en: actores, expresiones, objetos, ambientes, iluminacion, movimiento de camara, transiciones.
   - CADA prompt de video DEBE terminar con: "No text, no logos, no brand names, no written words visible anywhere."
   - Ejemplo CORRECTO: "Frustrated office worker slamming old CRT computer, papers flying. Cut to: modern professional smiling at sleek laptop with colorful abstract dashboard. Split screen transition, cinematic lighting, 7 seconds. No text, no logos, no brand names, no written words visible anywhere."
   - Ejemplo INCORRECTO: "Video with text 'company slogan' and company logo at top..." (esto genera texto ilegible)
   - Ejemplo INCORRECTO: "Computer screen showing 'ProductivityPro' dashboard..." (Veo 3 inventara un nombre diferente con errores)
10. Para tipo "image": el image_prompt SI debe incluir texto visible (slogan, headline, branding) porque la IA de imagenes maneja texto mejor.
11. PROHIBIDO generar logos en la imagen. El logo REAL de la empresa se agrega en post-procesamiento. La parte superior (top 8%) de la imagen debe quedar VACIA (solo color de fondo) para colocar el logo real despues. NO incluir ningun logo, marca o isotipo generado por IA.
12. Para tipo "video" o "campaign" con video_scenes: OBLIGATORIO usar las reglas del agente video-scene-creator:
   - Cada escena dura 7 segundos con UN solo beat narrativo.
   - Prompts visuales en INGLÉS profesional (estilo, personajes, ambiente, acción, cámara, iluminación).
   - Voiceovers en ESPAÑOL LATINO natural (8-16 palabras, claro, relacionado con la acción).
   - Mantener continuidad visual: mismos personajes, ropa, objetos, ambiente entre escenas.
   - Seguir estructura: setup → problema → consecuencia (técnico) o hook → valor → CTA (promo).
   - Terminar cada prompt visual con: "No text, no logos, no brand names, no written words visible anywhere."
   - El image_prompt para video debe ser la PRIMERA escena del video (la más impactante)."""

    lang_label = "español" if user_language == "es" else "English"
    lang_instruction = (
        f"\nIDIOMA OBLIGATORIO: {lang_label}.\n"
        f"TODOS los campos de texto en el JSON DEBEN estar en {lang_label}: "
        f"campaign_name, analysis, reasoning, primary_text, headline, description, "
        f"post_caption, post_hashtags, voiceover, warnings — TODO en {lang_label}.\n"
        f"La UNICA excepcion es image_prompt que puede estar en inglés (es para el generador de IA).\n"
        f"{'El contexto cultural debe ser Latinoamérica/Colombia.' if user_language == 'es' else ''}"
    )

    user_prompt = (
        f'SOLICITUD DEL USUARIO:\n"{user_request}"\n\n'
        f'TIPO DE CONTENIDO: {content_type}\n'
        f'PRESUPUESTO DIARIO: ${budget} COP (mercado colombiano)\n'
        f'{lang_instruction}\n\n'
        f'Genera la estrategia completa en JSON.\n'
        f'RECORDATORIO FINAL: TODOS los campos DEBEN estar en {lang_label} (campaign_name, headline, description, primary_text, post_caption, reasoning, warnings). '
        f'La ÚNICA excepción es image_prompt que va en inglés pero con textos visibles en español.'
    )

    response = ask_claude(system_prompt, user_prompt)
    if not response:
        return {}

    # Parse JSON — the model might wrap it in ```json``` or add text
    response = response.strip()
    if response.startswith("```"):
        response = re.sub(r"^```\w*\n?", "", response)
        response = re.sub(r"\n?```$", "", response)
    response = response.strip()

    try:
        return json.loads(response)
    except json.JSONDecodeError:
        # Try to extract JSON from text
        match = re.search(r"\{[\s\S]*\}", response)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        log_error(f"No se pudo parsear la respuesta del AI como JSON: {response[:200]}")
        return {}


# ---------------------------------------------------------------------------
# Meta API
# ---------------------------------------------------------------------------

def _meta_request(
    method: str, endpoint: str, access_token: str,
    data: dict[str, Any] | None = None, timeout: int = 30,
) -> dict[str, Any]:
    url = f"{GRAPH_API_BASE}/{endpoint}"
    if method == "GET":
        params = urllib.parse.urlencode({**(data or {}), "access_token": access_token})
        req = urllib.request.Request(f"{url}?{params}")
    else:
        payload = {**(data or {}), "access_token": access_token}
        req = urllib.request.Request(url, data=urllib.parse.urlencode(payload).encode(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Meta API {exc.code}: {exc.read().decode('utf-8', 'replace')}") from exc


def search_interests(query: str, access_token: str, limit: int = 5) -> list[dict[str, Any]]:
    """Busca intereses válidos en Meta."""
    try:
        result = _meta_request("GET", "search", access_token, {
            "type": "adinterest", "q": query, "limit": str(limit),
        })
        return [{"id": i["id"], "name": i["name"]} for i in result.get("data", []) if i.get("id")]
    except Exception:
        return []


def _to_meta_money(amount: float) -> int:
    """Convierte COP a formato Meta API. COP no tiene centavos, el factor es 1."""
    return int(amount)


def _to_meta_dt(date_str: str, end_of_day: bool = False) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    if end_of_day:
        dt = dt.replace(hour=23, minute=59, second=59)
    return dt.strftime("%Y-%m-%dT%H:%M:%S-0500")


# ---------------------------------------------------------------------------
# City key mapping (needed for Meta API targeting)
# ---------------------------------------------------------------------------
CITY_KEYS = {
    "bogota": "2673660", "bogotá": "2673660",
    "medellin": "2673670", "medellín": "2673670",
    "cali": "2673680",
    "barranquilla": "2673690",
    "cartagena": "2673700",
    "bucaramanga": "2673710",
    "pereira": "2673720",
    "manizales": "2673730",
    "santa marta": "2673740",
    "ibague": "2673750", "ibagué": "2673750",
    "villavicencio": "2673760",
    "pasto": "2673770",
    "cucuta": "2673780", "cúcuta": "2673780",
}


def resolve_city(name: str) -> dict[str, Any] | None:
    key = name.lower().strip()
    city_id = CITY_KEYS.get(key)
    if city_id:
        return {"key": city_id, "name": name.title()}
    return None


# ---------------------------------------------------------------------------
# Build campaign spec from AI strategy
# ---------------------------------------------------------------------------

def build_spec_from_strategy(
    strategy: dict[str, Any],
    user_input: dict[str, Any],
    access_token: str,
) -> dict[str, Any]:
    """Convierte la estrategia del AI en un spec ejecutable para Meta API."""
    budget = float(re.sub(r"[^\d.]", "", str(user_input.get("budget", "10000"))) or "10000")
    raw_account = user_input.get("ad_account_id", DEFAULT_AD_ACCOUNT)
    ad_account_id = raw_account if raw_account.startswith("act_") else f"act_{raw_account}"
    page_id = user_input.get("page_id", DEFAULT_PAGE_ID)
    website = user_input.get("website", user_input.get("company_website", ""))
    company_name = user_input.get("company_name", "")
    company_phone = user_input.get("company_phone", "")
    calendar = strategy.get("calendar", {})
    audiences = strategy.get("audiences", [])[:1]  # Solo 1 audiencia → 1 adset
    ads = strategy.get("ads", [])[:1]  # Solo 1 ad por audiencia
    # Forzar budget_pct=1.0 en la unica audiencia
    if audiences:
        audiences[0]["budget_pct"] = 1.0

    # Calculate dates — priorizar fechas del usuario sobre las de la IA
    from datetime import timedelta
    user_start = str(user_input.get("start_date", "")).strip()
    user_end = str(user_input.get("end_date", "")).strip()
    today = datetime.now()
    days = calendar.get("recommended_days", 14)

    if user_start:
        try:
            start = datetime.strptime(user_start, "%Y-%m-%d")
        except ValueError:
            start = today + timedelta(days=1)
    else:
        start = today + timedelta(days=1)

    if user_end:
        try:
            end = datetime.strptime(user_end, "%Y-%m-%d")
        except ValueError:
            end = start + timedelta(days=days)
    else:
        end = start + timedelta(days=days)

    # Resolve interests via Meta API for each audience
    for audience in audiences:
        real_interests = []
        for term in audience.get("interests_search_terms", []):
            if access_token:
                found = search_interests(term, access_token)
                real_interests.extend(found)
        # Deduplicate
        seen = set()
        audience["resolved_interests"] = []
        for i in real_interests:
            if i["id"] not in seen:
                seen.add(i["id"])
                audience["resolved_interests"].append(i)

    # Build spec
    spec = {
        "meta": {
            "engine_version": "4.0.0",
            "generated_at": datetime.now().isoformat(),
            "strategy_source": "n8n_ai_analysis",
            "ai_analysis": strategy.get("analysis", ""),
            "ai_calendar_reasoning": calendar.get("reasoning", ""),
            "ai_warnings": strategy.get("warnings", []),
            "image_prompt": strategy.get("image_prompt", ""),
            "post_caption": strategy.get("post_caption", ""),
            "post_hashtags": strategy.get("post_hashtags", []),
            "video_scenes": strategy.get("video_scenes", []),
            "company_name": company_name,
            "company_website": website,
            "company_phone": company_phone,
            "schedule": {
                "start_date": start.strftime("%Y-%m-%d"),
                "end_date": end.strftime("%Y-%m-%d"),
                "total_days": days,
                "daily_budget_cop": round(budget),
                "total_budget_cop": round(budget * days),
            },
        },
        "ad_account_id": ad_account_id,
        "page_id": page_id,
        "campaign": {
            "name": strategy.get("campaign_name", user_input.get("name", "Campaign")),
            "objective": "OUTCOME_LEADS",
            "status": "PAUSED",
            "special_ad_categories": [],
            "buying_type": "AUCTION",
            "is_adset_budget_sharing_enabled": False,
        },
        "adsets": [],
        "lead_form": None,
    }

    # Check if any audience needs a lead form
    needs_form = any(a.get("destination") == "lead_form" for a in audiences)
    if needs_form:
        spec["lead_form"] = {
            "name": f"Formulario — {spec['campaign']['name']}",
            "locale": DEFAULT_LOCALE,
            "page_id": page_id,
            "questions": [
                {"type": "FULL_NAME", "key": "full_name"},
                {"type": "EMAIL", "key": "email"},
                {"type": "PHONE", "key": "phone_number"},
            ],
            "privacy_policy": {"url": website or "https://facebook.com/privacy", "link_text": "Política de privacidad"},
            "thank_you_page": {
                "title": "¡Gracias por tu interés!",
                "body": "Te contactaremos pronto.",
                "button_type": "VIEW_WEBSITE",
                "button_text": "Visitar sitio web",
                "website_url": website,
            },
        }

    # Build adsets from AI audiences
    for i, audience in enumerate(audiences):
        META_MIN_DAILY_COP = 3708  # minimo diario de Meta para COP
        pct = audience.get("budget_pct", 1.0 / max(len(audiences), 1))
        daily = max(budget * pct, META_MIN_DAILY_COP)  # minimo de Meta por adset

        # Resolve cities
        cities = []
        for city_name in audience.get("cities", []):
            resolved = resolve_city(city_name)
            if resolved:
                radius = audience.get("city_radius_km", 40)
                cities.append({**resolved, "radius": radius, "distance_unit": "kilometer"})

        # Build targeting
        targeting = {
            "geo_locations": {"countries": ["CO"]},
            "age_min": audience.get("age_min", 25),
            "age_max": audience.get("age_max", 55),
            "targeting_automation": {"advantage_audience": 0},
            "publisher_platforms": ["facebook", "instagram"],
            "facebook_positions": ["feed"],
            "instagram_positions": ["stream", "story", "reels"],
        }
        if cities:
            targeting["geo_locations"]["cities"] = cities
        if audience.get("resolved_interests"):
            targeting["flexible_spec"] = [
                {"interests": audience["resolved_interests"]}
            ]

        dest = audience.get("destination", "lead_form")
        opt_goal = "LEAD_GENERATION" if dest == "lead_form" else "CONVERSATIONS" if dest == "whatsapp" else "LINK_CLICKS"
        dest_type = "ON_AD" if dest == "lead_form" else "WHATSAPP" if dest == "whatsapp" else "WEBSITE"

        # Build ads for this audience
        audience_ads = [a for a in ads if a.get("audience_index", 0) == i]
        if not audience_ads:
            audience_ads = ads[:2]  # Fallback: use first 2 ads

        ad_specs = []
        for j, ad in enumerate(audience_ads):
            label = chr(65 + j)
            cta_type = audience.get("cta", "LEARN_MORE")
            ad_spec = {
                "name": f"{audience['name']} — {ad.get('angle', label)}",
                "status": "PAUSED",
                "creative": {
                    "name": f"Creative — {audience['name']} — {label}",
                    "object_story_spec": {
                        "page_id": page_id,
                        "link_data": {
                            "message": ad.get("primary_text", "")[:500],
                            "name": ad.get("headline", "")[:40],
                            "description": ad.get("description", "")[:30],
                            "link": website,
                            "call_to_action": {"type": cta_type},
                        },
                    },
                },
                "angle": ad.get("angle", ""),
                "reasoning": ad.get("reasoning", ""),
            }
            if dest == "whatsapp":
                ad_spec["creative"]["object_story_spec"]["link_data"]["call_to_action"]["value"] = {
                    "whatsapp_number": company_phone or ""
                }
            elif dest == "lead_form":
                ad_spec["creative"]["object_story_spec"]["link_data"]["call_to_action"]["value"] = {
                    "lead_gen_form_id": "{{LEAD_FORM_ID}}"
                }
            ad_specs.append(ad_spec)

        adset = {
            "name": f"{spec['campaign']['name']} — {audience['name']}",
            "audience_key": audience.get("name", f"audience_{i}"),
            "daily_budget": _to_meta_money(daily),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": opt_goal,
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            "destination_type": dest_type,
            "status": "PAUSED",
            "start_time": _to_meta_dt(start.strftime("%Y-%m-%d")),
            "end_time": _to_meta_dt(end.strftime("%Y-%m-%d"), end_of_day=True),
            "promoted_object": {"page_id": page_id},
            "targeting": targeting,
            "ads": ad_specs,
            "reasoning": audience.get("reasoning", ""),
            "interests_resolved": len(audience.get("resolved_interests", [])),
        }
        spec["adsets"].append(adset)

    return spec


# ---------------------------------------------------------------------------
# Campaign executor
# ---------------------------------------------------------------------------

def get_page_token(user_token: str, page_id: str) -> str:
    """Obtiene el Page Access Token a partir del User Token (documentación oficial paso 3)."""
    # Primero intentar el FB_PAGE_ACCESS_TOKEN del .env
    page_token = os.environ.get("FB_PAGE_ACCESS_TOKEN", "").strip()
    if page_token:
        # Validar que funcione
        try:
            _meta_request("GET", page_id, page_token, {"fields": "id"})
            return page_token
        except Exception:
            log_warn("FB_PAGE_ACCESS_TOKEN expirado. Obteniendo nuevo via /me/accounts...")

    # Obtener via /me/accounts (requiere User Token con pages_manage_ads)
    try:
        result = _meta_request("GET", "me/accounts", user_token, {"fields": "id,name,access_token"})
        pages = result.get("data", [])
        log_info(f"Páginas encontradas en /me/accounts: {[p.get('id') + ' (' + p.get('name', '') + ')' for p in pages]}")
        for page in pages:
            if page.get("id") == page_id:
                token = page.get("access_token", "")
                if token:
                    log_ok(f"Page Token obtenido para {page.get('name', page_id)}")
                    return token
        log_warn(f"No se encontró página {page_id} en /me/accounts. Páginas disponibles: {[p.get('id') for p in pages]}")
    except Exception as exc:
        log_warn(f"No se pudo obtener Page Token: {exc}")

    # Fallback al user token — puede fallar en leadgen_forms
    log_warn(f"Usando User Token como fallback. Si falla leadgen_forms, genera un Page Token para {page_id}.")
    return user_token


def extend_token(short_token: str) -> str | None:
    """Extiende un token short-lived a long-lived (60 días)."""
    app_id = os.environ.get("FB_APP_ID", "").strip()
    app_secret = os.environ.get("FB_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        return None
    try:
        result = _meta_request("GET", "oauth/access_token", "", {
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": short_token,
        })
        new_token = result.get("access_token")
        if new_token:
            log_ok(f"Token extendido. Expira en {result.get('expires_in', '?')}s")
            return new_token
    except Exception as exc:
        log_warn(f"No se pudo extender token: {exc}")
    return None


def upload_image_to_meta(image_path: str, ad_account_id: str, access_token: str) -> str | None:
    """Sube imagen a Meta y devuelve image_hash. Paso 1 del flujo oficial."""
    import base64
    if not image_path or not os.path.exists(image_path):
        return None
    try:
        with open(image_path, "rb") as f:
            img_bytes = base64.b64encode(f.read()).decode("utf-8")
        result = _meta_request("POST", f"{ad_account_id}/adimages", access_token, {
            "bytes": img_bytes,
        })
        # Response: {"images": {"bytes": {"hash": "abc123", ...}}}
        images = result.get("images", {})
        for key, val in images.items():
            if isinstance(val, dict) and "hash" in val:
                log_ok(f"Imagen subida a Meta. Hash: {val['hash']}")
                return val["hash"]
        log_warn(f"Meta no devolvió image_hash: {result}")
        return None
    except Exception as exc:
        log_warn(f"No se pudo subir imagen a Meta: {exc}")
        return None


def execute_campaign(spec: dict[str, Any], access_token: str) -> dict[str, Any]:
    results: dict[str, Any] = {"ok": False, "campaign": None, "adsets": [], "lead_form": None, "image_hash": None, "errors": []}
    acct = spec["ad_account_id"]
    page_id = spec.get("page_id", DEFAULT_PAGE_ID)

    try:
        # Validate token
        log_info("Validando token de acceso...")
        try:
            _meta_request("GET", "me", access_token, {"fields": "id,name"})
            log_ok("Token válido.")
        except Exception:
            log_warn("Token podría estar expirado. Intentando extender...")
            new_token = extend_token(access_token)
            if new_token:
                access_token = new_token
            else:
                log_warn("No se pudo extender. Continuando con token actual.")

        # Get Page Token for leadgen_forms (requires Page Access Token per docs)
        page_token = get_page_token(access_token, page_id)

        # Step 0: Upload image if available
        image_path = spec.get("_image_path")
        image_hash = None
        if image_path:
            log_info(f"Paso 1/6: Subiendo imagen a Meta: {os.path.basename(image_path)}...")
            image_hash = upload_image_to_meta(image_path, acct, access_token)
            results["image_hash"] = image_hash
        else:
            log_info("Sin imagen local. Los creativos usarán link sin image_hash.")

        log_info("Paso 2/6: Creando campaña en Meta...")
        cr = _meta_request("POST", f"{acct}/campaigns", access_token, {
            "name": spec["campaign"]["name"],
            "objective": spec["campaign"]["objective"],
            "status": "PAUSED",
            "special_ad_categories": json.dumps([]),
            "is_adset_budget_sharing_enabled": "false",
        })
        cid = cr["id"]
        results["campaign"] = {"id": cid, "name": spec["campaign"]["name"]}
        log_ok(f"Campaña: {cid}")

        lfid = None
        if spec.get("lead_form"):
            log_info("Paso 3/6: Creando formulario de leads (requiere Page Token)...")
            fs = spec["lead_form"]
            try:
                # leadgen_forms requires PAGE TOKEN per Meta docs
                fr = _meta_request("POST", f"{page_id}/leadgen_forms", page_token, {
                    "name": fs["name"], "locale": fs["locale"],
                    "questions": json.dumps(fs["questions"]),
                    "privacy_policy": json.dumps(fs["privacy_policy"]),
                    "thank_you_page": json.dumps(fs["thank_you_page"]),
                })
                lfid = fr["id"]
                results["lead_form"] = {"id": lfid}
                log_ok(f"Formulario: {lfid}")
            except Exception as e:
                results["errors"].append(f"Lead form: {e}")

        for adset_spec in spec["adsets"]:
            aset_result: dict[str, Any] = {"name": adset_spec["audience_key"], "ads": [], "error": None}
            try:
                log_info(f"Paso 4/6: Creando adset: {adset_spec['name']}...")
                asd = {
                    "name": adset_spec["name"], "campaign_id": cid,
                    "daily_budget": adset_spec["daily_budget"],
                    "billing_event": adset_spec["billing_event"],
                    "optimization_goal": adset_spec["optimization_goal"],
                    "bid_strategy": adset_spec["bid_strategy"],
                    "destination_type": adset_spec["destination_type"],
                    "status": "PAUSED",
                    "start_time": adset_spec["start_time"],
                    "end_time": adset_spec["end_time"],
                    "promoted_object": json.dumps(adset_spec["promoted_object"]),
                    "targeting": json.dumps(adset_spec["targeting"]),
                }
                ar = _meta_request("POST", f"{acct}/adsets", access_token, asd)
                asid = ar["id"]
                aset_result["id"] = asid
                log_ok(f"AdSet: {asid}")

                for ad in adset_spec["ads"]:
                    try:
                        cs = json.loads(json.dumps(ad["creative"]))
                        if lfid:
                            cs = json.loads(json.dumps(cs).replace("{{LEAD_FORM_ID}}", str(lfid)))
                        # Inject image_hash into creative if we uploaded an image
                        if image_hash:
                            link_data = cs.get("object_story_spec", {}).get("link_data", {})
                            link_data["image_hash"] = image_hash
                            # Remove picture URL if present (image_hash takes priority)
                            link_data.pop("picture", None)
                        cvr = _meta_request("POST", f"{acct}/adcreatives", access_token, {
                            "name": cs["name"],
                            "object_story_spec": json.dumps(cs["object_story_spec"]),
                        })
                        adr = _meta_request("POST", f"{acct}/ads", access_token, {
                            "name": ad["name"], "adset_id": asid,
                            "creative": json.dumps({"creative_id": cvr["id"]}),
                            "status": "PAUSED",
                        })
                        aset_result["ads"].append({"id": adr["id"], "name": ad["name"]})
                        log_ok(f"  Ad: {adr['id']}")
                    except Exception as e:
                        results["errors"].append(f"Ad: {e}")
            except Exception as e:
                aset_result["error"] = str(e)
                results["errors"].append(str(e))
            results["adsets"].append(aset_result)

        results["ok"] = bool(results["campaign"] and any(a.get("id") for a in results["adsets"]))
    except Exception as e:
        log_error(f"Error fatal: {e}")
        results["errors"].append(str(e))

    return results


# ---------------------------------------------------------------------------
# Main entry points
# ---------------------------------------------------------------------------

def build_campaign_spec(user_input: dict[str, Any]) -> dict[str, Any]:
    """Entry point: analiza con AI y construye spec."""
    description = user_input.get("description") or user_input.get("name", "")
    budget = user_input.get("budget", "10000")
    access_token = user_input.get("access_token") or os.environ.get("FB_ACCESS_TOKEN", "")
    content_type = user_input.get("content_type", "campaign")

    user_language = user_input.get("user_language", "es")
    log_info(f"Enviando solicitud a Claude para análisis estratégico (tipo: {content_type})...")
    strategy = ai_generate_strategy(description, budget, content_type=content_type, user_language=user_language)

    if not strategy:
        log_error("El AI no devolvió estrategia. Verifica la conexión con n8n.")
        return {"meta": {"engine_version": "4.0.0", "error": "AI no respondió"}, "adsets": []}

    log_ok(f"Estrategia recibida: {strategy.get('campaign_name', 'N/A')}")
    log_info(f"Análisis: {strategy.get('analysis', 'N/A')}")
    log_info(f"Audiencias: {len(strategy.get('audiences', []))} | Anuncios: {len(strategy.get('ads', []))}")

    spec = build_spec_from_strategy(strategy, user_input, access_token)
    return spec


def main() -> int:
    parser = argparse.ArgumentParser(description="Meta Campaign Engine v4")
    parser.add_argument("--input", help="JSON file")
    parser.add_argument("--stdin", action="store_true", help="Read from stdin")
    parser.add_argument("--dry-run", action="store_true", help="Generate spec only")
    parser.add_argument("--execute-spec", action="store_true", help="Execute a pre-generated spec directly")
    args = parser.parse_args()

    raw = sys.stdin.read() if args.stdin else (
        Path(args.input).read_text("utf-8") if args.input else sys.stdin.read()
    )
    try:
        user_input = json.loads(raw)
    except json.JSONDecodeError as e:
        log_error(f"JSON inválido: {e}")
        return 1

    if args.execute_spec:
        # Execute a pre-generated spec directly (from chat approve flow)
        token = user_input.get("_access_token") or os.environ.get("FB_ACCESS_TOKEN", "")
        if not token:
            log_error("Sin access_token.")
            return 1
        results = execute_campaign(user_input, token)
        print(json.dumps({"results": results}, indent=2, ensure_ascii=False))
        return 0 if results["ok"] else 1

    spec = build_campaign_spec(user_input)

    if args.dry_run:
        print(json.dumps(spec, indent=2, ensure_ascii=False))
        return 0

    token = user_input.get("access_token") or os.environ.get("FB_ACCESS_TOKEN", "")
    if not token:
        log_error("Sin access_token. Usa --dry-run.")
        print(json.dumps(spec, indent=2, ensure_ascii=False))
        return 1

    results = execute_campaign(spec, token)
    print(json.dumps({"spec": spec, "results": results}, indent=2, ensure_ascii=False))
    return 0 if results["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
