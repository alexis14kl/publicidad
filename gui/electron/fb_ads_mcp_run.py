import contextlib
import importlib.util
import io
import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_TARGETING = {
    "geo_locations": {"countries": ["CO"]},
    "age_min": 24,
    "age_max": 54,
    "targeting_automation": {"advantage_audience": 0},
}
DEFAULT_REQUIRED_FIELDS = ["full_name", "email", "phone_number"]
REQUIRED_FIELD_ALIASES = {
    "name": "full_name",
    "full_name": "full_name",
    "nombre_completo": "full_name",
    "nombre": "first_name",
    "first_name": "first_name",
    "last_name": "last_name",
    "apellido": "last_name",
    "apellidos": "last_name",
    "email": "email",
    "correo": "email",
    "correo_electronico": "email",
    "mail": "email",
    "phone": "phone_number",
    "telefono": "phone_number",
    "telefono_movil": "phone_number",
    "celular": "phone_number",
    "mobile_phone": "phone_number",
    "phone_number": "phone_number",
}


def _string(value: Any) -> str:
    return str(value or "").strip()


def _dict(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _list_of_strings(value: Any) -> List[str]:
    if isinstance(value, (tuple, set)):
        value = list(value)
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "si"}


def _truncate(value: Any, limit: int = 120) -> str:
    text = _string(value)
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _targeting_summary(targeting: Dict[str, Any]) -> str:
    geo = _dict(targeting.get("geo_locations"))
    countries = geo.get("countries") or []
    countries_text = ",".join(str(country).strip() for country in countries if str(country).strip()) or "sin pais"
    age_min = targeting.get("age_min") or "?"
    age_max = targeting.get("age_max") or "?"
    return f"{countries_text}, edades {age_min}-{age_max}"


def _int_or_none(value: Any) -> Optional[int]:
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _normalize_required_field_key(value: Any) -> str:
    text = _string(value).lower().replace("-", "_").replace("/", "_").replace(" ", "_")
    while "__" in text:
        text = text.replace("__", "_")
    return REQUIRED_FIELD_ALIASES.get(text, "")


def _normalize_required_fields(value: Any) -> List[str]:
    seen = set()
    normalized: List[str] = []
    for item in _list_of_strings(value):
        key = _normalize_required_field_key(item)
        if key and key not in seen:
            normalized.append(key)
            seen.add(key)
    return normalized


def _resolve_string(candidates: List[Tuple[str, Any]], default: str, default_source: str) -> Tuple[str, str, bool]:
    for source, value in candidates:
        text = _string(value)
        if text:
            return text, source, source == default_source
    return default, default_source, True


def _resolve_string_list(
    candidates: List[Tuple[str, Any]],
    default: List[str],
    default_source: str,
    normalizer=None,
) -> Tuple[List[str], str, bool]:
    list_normalizer = normalizer or _list_of_strings
    for source, value in candidates:
        items = list_normalizer(value)
        if items:
            return items, source, source == default_source
    return deepcopy(default), default_source, True


def _build_named_fallback(prefix: str, segment_label: str, start_date: str, end_date: str, budget: str = "") -> str:
    parts = [_string(prefix)]
    if segment_label:
        parts.append(segment_label)
    if start_date or end_date:
        parts.append(f"{start_date or '?'} -> {end_date or '?'}")
    if budget:
        parts.append(budget)
    return " | ".join(part for part in parts if part)


def _resolve_targeting(adset_targeting: Dict[str, Any], segment: Dict[str, Any]) -> Tuple[Dict[str, Any], str, bool]:
    explicit_targeting = _dict(adset_targeting)
    if explicit_targeting:
        return explicit_targeting, "adset.targeting", False

    country_code = _string(segment.get("countryCode")) or "CO"
    age_min = _int_or_none(segment.get("ageMin")) or DEFAULT_TARGETING["age_min"]
    age_max = _int_or_none(segment.get("ageMax")) or DEFAULT_TARGETING["age_max"]
    if _string(segment.get("country")) or _string(segment.get("role")) or _string(segment.get("industry")):
        return {
            "geo_locations": {"countries": [country_code]},
            "age_min": age_min,
            "age_max": age_max,
        }, "runner_context.segment", True

    return deepcopy(DEFAULT_TARGETING), "runner.default.targeting", True


def _build_object_story_spec(
    existing: Dict[str, Any],
    page_id: str,
    link: str,
    message: str,
    headline: str,
    description: str,
    cta_type: str,
    lead_form_id: str,
) -> Tuple[Dict[str, Any], str]:
    object_story_spec = _dict(existing)
    source = "creative.object_story_spec"
    if not object_story_spec and page_id:
        source = "runner.generated_object_story_spec"
        object_story_spec = {
            "page_id": page_id,
            "link_data": {
                "link": link,
                "message": message,
                "name": headline,
                "description": description,
                "call_to_action": {
                    "type": cta_type,
                    "value": {
                        "lead_gen_form_id": lead_form_id,
                    },
                },
            },
        }

    if object_story_spec:
        link_data = _dict(object_story_spec.get("link_data"))
        if message and not _string(link_data.get("message")):
            link_data["message"] = message
        if headline and not _string(link_data.get("name")):
            link_data["name"] = headline
        if description and not _string(link_data.get("description")):
            link_data["description"] = description
        if link and not _string(link_data.get("link")):
            link_data["link"] = link
        link_data["call_to_action"] = {
            "type": cta_type,
            "value": {
                "lead_gen_form_id": lead_form_id,
            },
        }
        object_story_spec["page_id"] = _string(object_story_spec.get("page_id")) or page_id
        object_story_spec["link_data"] = link_data

    return object_story_spec, source


def _emit_rule(progress, rules: List[Dict[str, str]], step: int, total: int, field: str, detail: str) -> None:
    line = f"[RUNNER][{step}/{total}] {field}: {detail}"
    rules.append({"step": f"{step}/{total}", "field": field, "detail": detail})
    progress(line)


def load_server_module(server_path: str):
    module_path = Path(server_path).resolve()
    spec = importlib.util.spec_from_file_location("fb_ads_mcp_server_module", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"No pude cargar el MCP desde {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize_bundle_spec(payload: Dict[str, Any], progress) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    source = dict(payload or {})
    rules: List[Dict[str, str]] = []
    total_steps = 17

    runner_context = _dict(source.get("runner_context"))
    preview_context = _dict(runner_context.get("preview"))
    execution_context = _dict(runner_context.get("execution"))
    segment_context = _dict(runner_context.get("segment"))
    agents_context = _dict(runner_context.get("agents"))
    ui_flow_context = _dict(runner_context.get("uiFlow"))
    ads_analyst = _dict(agents_context.get("adsAnalyst"))
    marketing = _dict(agents_context.get("marketing"))

    _emit_rule(
        progress,
        rules,
        1,
        total_steps,
        "runner.context",
        (
            "Contexto cargado con "
            f"segment='{_string(segment_context.get('shortLabel')) or 'sin segmento'}', "
            f"ads_analyst={'si' if ads_analyst else 'no'}, "
            f"marketing={'si' if marketing else 'no'}."
        ),
    )

    ad_account_id, ad_account_source, _ = _resolve_string(
        [
            ("ad_account_id", source.get("ad_account_id")),
            ("runner_context.execution.accountHint", execution_context.get("accountHint")),
        ],
        "",
        "runner.default.missing_account",
    )
    if not ad_account_id:
        raise RuntimeError("Regla del runner: ad_account_id es obligatorio para crear la campaña.")
    account_name, account_name_source, _ = _resolve_string(
        [
            ("account_name", source.get("account_name")),
            ("runner_context.execution.accountHint", execution_context.get("accountHint")),
        ],
        ad_account_id,
        "runner.default.account_name",
    )
    page_id, page_id_source, page_id_fallback = _resolve_string(
        [
            ("page_id", source.get("page_id")),
            ("lead_form.page_id", _dict(source.get("lead_form")).get("page_id")),
            ("runner_context.execution.pageId", execution_context.get("pageId")),
        ],
        "",
        "runner.default.page_id",
    )

    contact_mode = _string(source.get("contact_mode")) or "lead_form"
    is_whatsapp = contact_mode == "whatsapp"

    campaign = _dict(source.get("campaign"))
    adset = _dict(source.get("adset"))
    lead_form = _dict(source.get("lead_form")) if not is_whatsapp else {}
    creative = _dict(source.get("creative"))
    ad = _dict(source.get("ad"))

    normalized: Dict[str, Any] = {
        "ad_account_id": ad_account_id,
        "account_name": account_name,
        "page_id": page_id,
        "contact_mode": contact_mode,
    }

    _emit_rule(
        progress,
        rules,
        2,
        total_steps,
        "ad_account_id",
        f"Usando cuenta publicitaria {ad_account_id} desde {ad_account_source}; account_name='{account_name}' desde {account_name_source}.",
    )
    _emit_rule(
        progress,
        rules,
        3,
        total_steps,
        "page_id",
        (
            f"Usando page_id {page_id} desde {page_id_source} para formulario y promoted_object."
            if page_id
            else (
                f"Sin page_id utilizable; fuente revisada={page_id_source}. "
                "El runner dejara formulario/promoted_object en modo fallback."
                if page_id_fallback
                else "Sin page_id utilizable."
            )
        ),
    )

    preview_budget = _string(preview_context.get("budget"))
    preview_start = _string(preview_context.get("startDate"))
    preview_end = _string(preview_context.get("endDate"))
    segment_label = _string(segment_context.get("shortLabel"))

    campaign_name, campaign_name_source, campaign_name_fallback = _resolve_string(
        [
            ("campaign.name", campaign.get("name")),
            ("runner_context.uiFlow.campaignName", ui_flow_context.get("campaignName")),
            ("runner_context.execution.campaignName", execution_context.get("campaignName")),
        ],
        _build_named_fallback("Lead Gen", segment_label, preview_start, preview_end, preview_budget) or "Lead Gen Draft",
        "runner.default.campaign_name",
    )
    ui_objective_label, ui_objective_source, ui_objective_fallback = _resolve_string(
        [
            ("campaign.ui_objective_label", campaign.get("ui_objective_label")),
            ("runner_context.uiFlow.campaignObjectiveLabel", ui_flow_context.get("campaignObjectiveLabel")),
            ("runner_context.execution.objectiveUiLabel", execution_context.get("objectiveUiLabel")),
        ],
        "Clientes potenciales",
        "runner.default.ui_objective_label",
    )
    special_ad_categories, categories_source, categories_fallback = _resolve_string_list(
        [
            ("campaign.special_ad_categories", campaign.get("special_ad_categories")),
            ("runner_context.agents.marketing.specialAdCategories", marketing.get("specialAdCategories")),
        ],
        [],
        "runner.default.special_ad_categories",
    )
    normalized["campaign"] = {
        "name": campaign_name,
        "objective": _string(campaign.get("objective")) or "OUTCOME_LEADS",
        "ui_objective_label": ui_objective_label,
        "status": _string(campaign.get("status")) or "PAUSED",
        "is_adset_budget_sharing_enabled": _bool(campaign.get("is_adset_budget_sharing_enabled"), False),
        "special_ad_categories": special_ad_categories,
    }
    _emit_rule(
        progress,
        rules,
        4,
        total_steps,
        "campaign",
        (
            f"name='{campaign_name}' desde {campaign_name_source}"
            f"{' (fallback)' if campaign_name_fallback else ''}, "
            f"objective='{normalized['campaign']['objective']}', ui_objective_label='{ui_objective_label}' desde {ui_objective_source}"
            f"{' (fallback)' if ui_objective_fallback else ''}, status='{normalized['campaign']['status']}', "
            f"special_ad_categories={special_ad_categories} desde {categories_source}"
            f"{' (fallback)' if categories_fallback else ''}."
        ),
    )

    adset_name, adset_name_source, adset_name_fallback = _resolve_string(
        [
            ("adset.name", adset.get("name")),
            ("runner_context.uiFlow.adsetName", ui_flow_context.get("adsetName")),
            ("runner_context.execution.adsetName", execution_context.get("adsetName")),
        ],
        _build_named_fallback("Ad Set", segment_label, preview_start, preview_end) or "Ad Set Borrador",
        "runner.default.adset_name",
    )
    ui_budget_mode, ui_budget_mode_source, ui_budget_mode_fallback = _resolve_string(
        [
            ("adset.ui_budget_mode_label", adset.get("ui_budget_mode_label")),
            ("runner_context.uiFlow.budgetModeLabel", ui_flow_context.get("budgetModeLabel")),
            ("runner_context.execution.budgetModeUiLabel", execution_context.get("budgetModeUiLabel")),
        ],
        "Presupuesto total",
        "runner.default.ui_budget_mode_label",
    )
    ui_conversion_location, ui_conversion_source, ui_conversion_fallback = _resolve_string(
        [
            ("adset.ui_conversion_location_label", adset.get("ui_conversion_location_label")),
            ("runner_context.uiFlow.conversionLocationLabel", ui_flow_context.get("conversionLocationLabel")),
            ("runner_context.execution.conversionLocationUiLabel", execution_context.get("conversionLocationUiLabel")),
        ],
        "Formularios instantáneos",
        "runner.default.ui_conversion_location_label",
    )
    ui_performance_goal, ui_performance_goal_source, ui_performance_goal_fallback = _resolve_string(
        [
            ("adset.ui_performance_goal_label", adset.get("ui_performance_goal_label")),
            ("runner_context.uiFlow.performanceGoalLabel", ui_flow_context.get("performanceGoalLabel")),
            ("runner_context.execution.performanceGoalUiLabel", execution_context.get("performanceGoalUiLabel")),
        ],
        "Maximizar el número de clientes potenciales",
        "runner.default.ui_performance_goal_label",
    )
    targeting, targeting_source, targeting_fallback = _resolve_targeting(_dict(adset.get("targeting")), segment_context)
    normalized["adset"] = {
        "name": adset_name,
        "lifetime_budget": _string(adset.get("lifetime_budget")),
        "billing_event": _string(adset.get("billing_event")) or "IMPRESSIONS",
        "optimization_goal": _string(adset.get("optimization_goal")) or "LEAD_GENERATION",
        "bid_strategy": _string(adset.get("bid_strategy")) or "LOWEST_COST_WITHOUT_CAP",
        "destination_type": _string(adset.get("destination_type")) or "ON_AD",
        "status": _string(adset.get("status")) or "PAUSED",
        "start_time": _string(adset.get("start_time")),
        "end_time": _string(adset.get("end_time")),
        "targeting": targeting,
        "ui_budget_mode_label": ui_budget_mode,
        "ui_conversion_location_label": ui_conversion_location,
        "ui_performance_goal_label": ui_performance_goal,
    }
    _emit_rule(
        progress,
        rules,
        5,
        total_steps,
        "adset.base",
        (
            f"name='{normalized['adset']['name']}' desde {adset_name_source}"
            f"{' (fallback)' if adset_name_fallback else ''}, "
            f"budget='{normalized['adset']['lifetime_budget']}', "
            f"start='{normalized['adset']['start_time']}', end='{normalized['adset']['end_time']}', "
            f"optimization='{normalized['adset']['optimization_goal']}', status='{normalized['adset']['status']}'."
        ),
    )
    _emit_rule(
        progress,
        rules,
        6,
        total_steps,
        "adset.targeting",
        f"Aplicando targeting base desde {targeting_source}{' (fallback)' if targeting_fallback else ''}: {_targeting_summary(targeting)}.",
    )
    _emit_rule(
        progress,
        rules,
        7,
        total_steps,
        "adset.ui_flow",
        (
            f"UI del ad set: budget_mode='{ui_budget_mode}' desde {ui_budget_mode_source}"
            f"{' (fallback)' if ui_budget_mode_fallback else ''}, "
            f"conversion_location='{ui_conversion_location}' desde {ui_conversion_source}"
            f"{' (fallback)' if ui_conversion_fallback else ''}, "
            f"performance_goal='{ui_performance_goal}' desde {ui_performance_goal_source}"
            f"{' (fallback)' if ui_performance_goal_fallback else ''}."
        ),
    )

    promoted_object = _dict(adset.get("promoted_object"))
    if not promoted_object and page_id:
        promoted_object = {"page_id": page_id}
    if promoted_object:
        normalized["adset"]["promoted_object"] = promoted_object
    _emit_rule(
        progress,
        rules,
        8,
        total_steps,
        "adset.promoted_object",
        f"Usando promoted_object={json.dumps(promoted_object, ensure_ascii=False)}." if promoted_object else "Sin promoted_object; si Meta lo exige, el flujo visual completara ese paso.",
    )

    if is_whatsapp:
        normalized["lead_form"] = None
        _emit_rule(progress, rules, 9, total_steps, "lead_form", "Modo WhatsApp: no se requiere formulario de leads.")
        _emit_rule(progress, rules, 10, total_steps, "lead_form.required_fields", "Modo WhatsApp: sin campos de formulario.")
    else:
        required_fields, required_fields_source, required_fields_fallback = _resolve_string_list(
            [
                ("lead_form.required_fields", lead_form.get("required_fields")),
                ("runner_context.uiFlow.leadFormRequiredKeys", ui_flow_context.get("leadFormRequiredKeys")),
                ("runner_context.execution.leadFormRequiredKeys", execution_context.get("leadFormRequiredKeys")),
                ("runner_context.execution.formFields", execution_context.get("formFields")),
                ("runner_context.preview.formFields", preview_context.get("formFields")),
            ],
            DEFAULT_REQUIRED_FIELDS,
            "runner.default.required_fields",
            normalizer=_normalize_required_fields,
        )
        lead_form_page_id, lead_form_page_id_source, lead_form_page_id_fallback = _resolve_string(
            [
                ("lead_form.page_id", lead_form.get("page_id")),
                (f"resolved.{page_id_source}", page_id),
            ],
            page_id,
            "runner.default.lead_form_page_id",
        )
        lead_form_name, lead_form_name_source, lead_form_name_fallback = _resolve_string(
            [("lead_form.name", lead_form.get("name"))],
            _build_named_fallback("Formulario", segment_label, preview_start, preview_end) or "Formulario Lead Ads",
            "runner.default.lead_form_name",
        )
        normalized["lead_form"] = {
            "page_id": lead_form_page_id,
            "form_id": _string(lead_form.get("form_id")),
            "discover": _bool(lead_form.get("discover"), True),
            "create_if_missing": _bool(lead_form.get("create_if_missing"), True),
            "name": lead_form_name,
            "locale": _string(lead_form.get("locale")) or "es_LA",
            "privacy_policy_url": _string(lead_form.get("privacy_policy_url")),
            "privacy_policy_link_text": _string(lead_form.get("privacy_policy_link_text")) or "Politica de privacidad",
            "follow_up_action_url": _string(lead_form.get("follow_up_action_url")),
            "required_fields": required_fields,
        }
        _emit_rule(
            progress,
            rules,
            9,
            total_steps,
            "lead_form",
            (
                f"page_id='{lead_form_page_id}' desde {lead_form_page_id_source}"
                f"{' (fallback)' if lead_form_page_id_fallback else ''}, "
                f"form_id='{normalized['lead_form']['form_id'] or 'auto'}', discover={normalized['lead_form']['discover']}, "
                f"create_if_missing={normalized['lead_form']['create_if_missing']}, "
                f"name='{lead_form_name}' desde {lead_form_name_source}"
                f"{' (fallback)' if lead_form_name_fallback else ''}."
            ),
        )
        _emit_rule(
            progress,
            rules,
            10,
            total_steps,
            "lead_form.required_fields",
            (
                f"required_fields={required_fields} desde {required_fields_source}"
                f"{' (fallback)' if required_fields_fallback else ''}, "
                f"locale='{normalized['lead_form']['locale']}', privacy_policy_url='{_truncate(normalized['lead_form']['privacy_policy_url'], 80)}', "
                f"follow_up_action_url='{_truncate(normalized['lead_form']['follow_up_action_url'], 80)}'."
            ),
        )

    headline, headline_source, headline_fallback = _resolve_string(
        [
            ("creative.headline", creative.get("headline")),
            ("runner_context.agents.adsAnalyst.hook", ads_analyst.get("hook")),
            ("runner_context.segment.hook", segment_context.get("hook")),
        ],
        "Lead Gen Draft",
        "runner.default.creative_headline",
    )
    message, message_source, message_fallback = _resolve_string(
        [
            ("creative.message", creative.get("message")),
            ("runner_context.agents.adsAnalyst.copy", ads_analyst.get("copy")),
            ("runner_context.segment.strategicAngle", segment_context.get("strategicAngle")),
        ],
        "",
        "runner.default.creative_message",
    )
    description, description_source, description_fallback = _resolve_string(
        [
            ("creative.description", creative.get("description")),
            ("runner_context.agents.adsAnalyst.strategicAngle", ads_analyst.get("strategicAngle")),
            ("runner_context.agents.marketing.categoryStatement", marketing.get("categoryStatement")),
            ("runner_context.segment.strategicAngle", segment_context.get("strategicAngle")),
        ],
        "",
        "runner.default.creative_description",
    )
    link, link_source, link_fallback = _resolve_string(
        [
            ("creative.link", creative.get("link")),
            ("runner_context.preview.url", preview_context.get("url")),
        ],
        "",
        "runner.default.creative_link",
    )
    cta_type = _string(creative.get("call_to_action_type")) or "SIGN_UP"
    image_path = _string(creative.get("image_path"))
    creative_name, creative_name_source, creative_name_fallback = _resolve_string(
        [("creative.name", creative.get("name"))],
        _build_named_fallback("Creative", segment_label, preview_start, preview_end) or "Creative Borrador",
        "runner.default.creative_name",
    )
    object_story_spec, object_story_spec_source = _build_object_story_spec(
        _dict(creative.get("object_story_spec")),
        page_id,
        link,
        message,
        headline,
        description,
        cta_type,
        _string(_dict(normalized.get("lead_form")).get("form_id")),
    )
    normalized["creative"] = {
        "name": creative_name,
        "message": message,
        "headline": headline,
        "description": description,
        "link": link,
        "call_to_action_type": cta_type,
        "image_path": image_path,
        "object_story_spec": object_story_spec or None,
    }
    _emit_rule(
        progress,
        rules,
        11,
        total_steps,
        "creative.headline",
        (
            f"headline='{_truncate(headline)}' desde {headline_source}"
            f"{' (fallback)' if headline_fallback else ''}."
        ),
    )
    _emit_rule(
        progress,
        rules,
        12,
        total_steps,
        "creative.message",
        f"message='{_truncate(message)}' desde {message_source}{' (fallback)' if message_fallback else ''}.",
    )
    _emit_rule(
        progress,
        rules,
        13,
        total_steps,
        "creative.detail",
        (
            f"description='{_truncate(description)}' desde {description_source}"
            f"{' (fallback)' if description_fallback else ''}, "
            f"link='{_truncate(link)}' desde {link_source}"
            f"{' (fallback)' if link_fallback else ''}, "
            f"cta='{cta_type}', creative.name='{creative_name}' desde {creative_name_source}"
            f"{' (fallback)' if creative_name_fallback else ''}, "
            f"object_story_spec desde {object_story_spec_source}."
        ),
    )
    _emit_rule(
        progress,
        rules,
        14,
        total_steps,
        "creative.asset",
        f"Usando image_path='{image_path}'." if image_path else "Sin image_path; el servidor omitira creative/ad si no hay imagen.",
    )

    ad_name, ad_name_source, ad_name_fallback = _resolve_string(
        [("ad.name", ad.get("name"))],
        _build_named_fallback("Ad", segment_label, preview_start, preview_end) or "Ad Borrador",
        "runner.default.ad_name",
    )
    normalized["ad"] = {
        "name": ad_name,
        "status": _string(ad.get("status")) or "PAUSED",
    }
    _emit_rule(
        progress,
        rules,
        15,
        total_steps,
        "ad",
        f"name='{normalized['ad']['name']}' desde {ad_name_source}{' (fallback)' if ad_name_fallback else ''}, status='{normalized['ad']['status']}'.",
    )
    _emit_rule(
        progress,
        rules,
        16,
        total_steps,
        "ui_flow.summary",
        (
            f"Regla operativa de UI: modal='{normalized['campaign'].get('ui_objective_label', 'Clientes potenciales')}', editor de campaña con "
            f"'{ui_budget_mode}', ad set con '{ui_conversion_location}'"
            f"{', formulario con ' + str(_dict(normalized.get('lead_form')).get('required_fields', [])) if not is_whatsapp else ', canal WhatsApp'}."
        ),
    )
    _emit_rule(
        progress,
        rules,
        17,
        total_steps,
        "runner.summary",
        "Payload normalizado con reglas de fuente/fallback; el siguiente paso es ejecutar create_lead_campaign_bundle en el servidor MCP.",
    )

    return normalized, rules


def build_runner_summary(spec: Dict[str, Any]) -> Dict[str, Any]:
    adset = _dict(spec.get("adset"))
    creative = _dict(spec.get("creative"))
    lead_form = _dict(spec.get("lead_form"))
    contact_mode = _string(spec.get("contact_mode")) or "lead_form"
    summary: Dict[str, Any] = {
        "ad_account_id": _string(spec.get("ad_account_id")),
        "page_id": _string(spec.get("page_id")),
        "contact_mode": contact_mode,
        "campaign_name": _string(_dict(spec.get("campaign")).get("name")),
        "campaign_ui_objective_label": _string(_dict(spec.get("campaign")).get("ui_objective_label")),
        "adset_name": _string(adset.get("name")),
        "adset_ui_budget_mode": _string(adset.get("ui_budget_mode_label")),
        "adset_ui_conversion_location": _string(adset.get("ui_conversion_location_label")),
        "adset_ui_performance_goal": _string(adset.get("ui_performance_goal_label")),
        "targeting_summary": _targeting_summary(_dict(adset.get("targeting"))),
        "creative_name": _string(creative.get("name")),
        "creative_headline": _string(creative.get("headline")),
        "creative_message_preview": _truncate(creative.get("message"), 80),
        "creative_description_preview": _truncate(creative.get("description"), 80),
        "creative_has_image": bool(_string(creative.get("image_path"))),
        "ad_name": _string(_dict(spec.get("ad")).get("name")),
    }
    if contact_mode != "whatsapp" and lead_form:
        summary["lead_form_id"] = _string(lead_form.get("form_id"))
        summary["lead_form_name"] = _string(lead_form.get("name"))
        summary["lead_form_create_if_missing"] = bool(lead_form.get("create_if_missing"))
        summary["lead_form_required_fields"] = list(lead_form.get("required_fields") or [])
        summary["lead_form_discover"] = bool(lead_form.get("discover"))
    return summary


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Uso: fb_ads_mcp_run.py <server.py>"}))
        return 1

    server_path = sys.argv[1]
    payload_raw = sys.stdin.read().strip()
    if not payload_raw:
        print(json.dumps({"ok": False, "error": "No recibi JSON por stdin"}))
        return 1

    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError as error:
        print(json.dumps({"ok": False, "error": f"JSON invalido: {error}"}))
        return 1

    def progress(line: str):
        print(line, file=sys.stderr, flush=True)

    try:
        progress("[RUNNER] Iniciando normalizacion del payload para el bundle de Meta Ads...")
        normalized_payload, runner_rules = normalize_bundle_spec(payload, progress)
        captured_stdout = io.StringIO()
        with contextlib.redirect_stdout(captured_stdout):
            module = load_server_module(server_path)
            result = module.execute_lead_campaign_bundle(normalized_payload, progress_callback=progress)
        noisy_output = captured_stdout.getvalue().strip()
        if noisy_output:
            print(noisy_output, file=sys.stderr, flush=True)
        if isinstance(result, dict):
            result["runner_rules"] = runner_rules
            result["runner_fill_plan"] = runner_rules
            result["runner_summary"] = build_runner_summary(normalized_payload)
        print(json.dumps(result), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
