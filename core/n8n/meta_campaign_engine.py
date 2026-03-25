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
from core.utils.logger import log_info, log_ok, log_warn, log_error

# ---------------------------------------------------------------------------
# Config — SOLO credenciales y endpoints, nada de estrategia
# ---------------------------------------------------------------------------
GRAPH_API_VERSION = "v22.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
DEFAULT_AD_ACCOUNT = "act_438871067037500"
DEFAULT_PAGE_ID = "115406607722279"
DEFAULT_LOCALE = "es_LA"
WHATSAPP_NUMBER = "+573013859952"
WEBSITE = "https://www.noyecode.com"
PRIVACY_URL = "https://www.noyecode.com/privacidad"

# ---------------------------------------------------------------------------
# n8n AI — el cerebro que razona
# ---------------------------------------------------------------------------

def ask_ai(prompt: str, webhook_url: str, timeout: int = 90) -> str:
    """Envía un prompt al webhook de n8n y devuelve la respuesta del modelo de IA."""
    payload = json.dumps({"text": prompt}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            # n8n puede devolver en "output", "text", "response", o el root
            return str(
                data.get("output") or data.get("text") or data.get("response") or json.dumps(data)
            ).strip()
    except Exception as exc:
        log_error(f"n8n AI error: {exc}")
        return ""


def ai_generate_strategy(user_request: str, budget: str, webhook_url: str) -> dict[str, Any]:
    """
    Envía la solicitud del usuario al LLM y recibe la estrategia completa.
    El LLM decide TODO: audiencias, copies, targeting, calendario.
    """
    prompt = f"""Eres un experto en Meta Ads B2B con experiencia en el mercado colombiano.

El usuario quiere crear esta campaña:
"{user_request}"

Presupuesto diario: ${budget} COP

Responde SOLO en JSON válido (sin explicaciones, sin markdown, sin backticks).
Analiza la solicitud y genera la estrategia óptima:

{{
  "campaign_name": "nombre descriptivo de la campaña",
  "analysis": "tu análisis de por qué elegiste esta estrategia (2-3 oraciones)",
  "calendar": {{
    "recommended_days": número de días recomendados,
    "start_day": "mejor día de la semana para lanzar",
    "reasoning": "por qué este calendario"
  }},
  "audiences": [
    {{
      "name": "nombre del segmento",
      "budget_pct": porcentaje del presupuesto (0.0-1.0),
      "age_min": edad mínima,
      "age_max": edad máxima,
      "cities": ["ciudad1", "ciudad2"],
      "city_radius_km": radio en km,
      "interests_search_terms": ["término1", "término2", "término3"],
      "destination": "whatsapp" o "lead_form" o "website",
      "cta": "SIGN_UP" o "LEARN_MORE" o "GET_QUOTE" o "WHATSAPP_MESSAGE" o "CONTACT_US",
      "reasoning": "por qué esta audiencia"
    }}
  ],
  "ads": [
    {{
      "audience_index": 0,
      "angle": "nombre del ángulo (ej: dolor, resultado, autoridad)",
      "primary_text": "texto principal del anuncio (max 500 chars, en español)",
      "headline": "titular (max 40 chars)",
      "description": "descripción corta (max 30 chars)",
      "reasoning": "por qué este ángulo funciona"
    }}
  ],
  "image_prompt": "prompt detallado en inglés para generar la imagen promocional con IA. Debe reflejar exactamente lo que el usuario pidió, NO una persona genérica con laptop.",
  "warnings": ["alerta1", "alerta2"]
}}

Reglas:
1. SOLO JSON válido. Sin texto antes ni después.
2. Mínimo 2 anuncios, máximo 5.
3. Mínimo 1 audiencia, máximo 5 (según presupuesto).
4. Los copies deben ser en español colombiano, persuasivos, específicos al concepto.
5. Si el presupuesto es bajo (<$10,000/día), concentra en 1-2 audiencias.
6. Las ciudades deben ser las más relevantes para el concepto (no siempre las 4 principales).
7. Los interests_search_terms deben ser palabras que existan como intereses en Meta Ads.
8. El image_prompt debe ser literal sobre lo que el usuario pidió. Si pidió vacas con sombrero, genera vacas con sombrero.
9. Siempre incluye el análisis de por qué tomaste cada decisión."""

    response = ask_ai(prompt, webhook_url, timeout=120)
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
    return int(amount * 100)


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
    budget = float(re.sub(r"[^\d.]", "", str(user_input.get("budget", "50000"))) or "50000")
    raw_account = user_input.get("ad_account_id", DEFAULT_AD_ACCOUNT)
    ad_account_id = raw_account if raw_account.startswith("act_") else f"act_{raw_account}"
    page_id = user_input.get("page_id", DEFAULT_PAGE_ID)
    website = user_input.get("website", WEBSITE)
    calendar = strategy.get("calendar", {})
    audiences = strategy.get("audiences", [])
    ads = strategy.get("ads", [])

    # Calculate dates
    from datetime import timedelta
    today = datetime.now()
    days = calendar.get("recommended_days", 14)
    start = today + timedelta(days=1)
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
            "privacy_policy": {"url": PRIVACY_URL, "link_text": "Política de privacidad"},
            "thank_you_page": {
                "title": "¡Gracias por tu interés!",
                "body": "Te contactaremos pronto.",
                "button_text": "Visitar sitio web",
                "website_url": website,
            },
        }

    # Build adsets from AI audiences
    for i, audience in enumerate(audiences):
        pct = audience.get("budget_pct", 1.0 / max(len(audiences), 1))
        daily = max(budget * pct, 3708)  # Meta minimum

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

        dest = audience.get("destination", "whatsapp")
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
                    "whatsapp_number": WHATSAPP_NUMBER
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

def execute_campaign(spec: dict[str, Any], access_token: str) -> dict[str, Any]:
    results: dict[str, Any] = {"ok": False, "campaign": None, "adsets": [], "lead_form": None, "errors": []}
    acct = spec["ad_account_id"]

    try:
        log_info("Creando campaña en Meta...")
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
            log_info("Creando formulario...")
            fs = spec["lead_form"]
            try:
                fr = _meta_request("POST", f"{spec['page_id']}/leadgen_forms", access_token, {
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
                log_info(f"Creando adset: {adset_spec['name']}...")
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
                        cs = ad["creative"]
                        if lfid:
                            cs = json.loads(json.dumps(cs).replace("{{LEAD_FORM_ID}}", str(lfid)))
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
    budget = user_input.get("budget", "50000")
    access_token = user_input.get("access_token") or os.environ.get("FB_ACCESS_TOKEN", "")
    webhook_url = user_input.get("webhook_url") or os.environ.get(
        "N8N_WEBHOOK_PROMPT_IMGS", "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"
    )

    log_info(f"Enviando solicitud al AI para análisis estratégico...")
    strategy = ai_generate_strategy(description, budget, webhook_url)

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
    args = parser.parse_args()

    raw = sys.stdin.read() if args.stdin else (
        Path(args.input).read_text("utf-8") if args.input else sys.stdin.read()
    )
    try:
        user_input = json.loads(raw)
    except json.JSONDecodeError as e:
        log_error(f"JSON inválido: {e}")
        return 1

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
