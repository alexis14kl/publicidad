"""
Facebook Ads CDP Server — creates lead campaigns via Graph API.

Replaces the MCP server. Uses CDP (Chrome DevTools Protocol) to extract
the Facebook access token from a logged-in browser session when no explicit
token is provided. All Graph API calls remain the same.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Graph API constants
# ---------------------------------------------------------------------------
GRAPH_VERSION = "v22.0"
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_VERSION}"
DEFAULT_TIMEOUT = 30
FIELD_ALIASES = {
    "name": "full_name",
    "full_name": "full_name",
    "first_name": "first_name",
    "last_name": "last_name",
    "email": "email",
    "phone": "phone_number",
    "phone_number": "phone_number",
    "mobile_phone": "phone_number",
    "telefono": "phone_number",
    "celular": "phone_number",
}
QUESTION_TYPE_MAP = {
    "full_name": "FULL_NAME",
    "first_name": "FIRST_NAME",
    "last_name": "LAST_NAME",
    "email": "EMAIL",
    "phone_number": "PHONE",
}


# ---------------------------------------------------------------------------
# CDP — token extraction from browser
# ---------------------------------------------------------------------------

def _cdp_get_targets(port: int) -> list:
    """Get CDP targets from a browser listening on the given port."""
    url = f"http://127.0.0.1:{port}/json"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    except Exception:
        return []


def _cdp_ws_evaluate(ws_url: str, expression: str, timeout: int = 10) -> Any:
    """Evaluate JS in a browser page via CDP WebSocket."""
    import asyncio

    try:
        import websockets
    except ImportError:
        import subprocess
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "websockets", "-q"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        import websockets

    async def _run():
        async with websockets.connect(ws_url, max_size=2**22) as ws:
            msg = json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "returnByValue": True,
                },
            })
            await ws.send(msg)
            resp = await asyncio.wait_for(ws.recv(), timeout=timeout)
            data = json.loads(resp)
            result = data.get("result", {}).get("result", {})
            return result.get("value")

    return asyncio.run(_run())


def _find_facebook_target(targets: list) -> Optional[dict]:
    """Find a Facebook page target among CDP targets."""
    for t in targets:
        url = str(t.get("url", "")).lower()
        if t.get("type") == "page" and ("facebook.com" in url or "fb.com" in url):
            return t
    return None


def _extract_token_from_page(ws_url: str) -> str:
    """Extract Facebook access token from a logged-in Ads Manager page."""
    # Facebook stores the token in several places; try common approaches
    js_extract = r"""
    (() => {
        // Method 1: window.__accessToken (most common in Ads Manager)
        if (window.__accessToken) return window.__accessToken;
        // Method 2: DTSGInitData or similar
        if (window.__comet_req && window.__comet_req.access_token)
            return window.__comet_req.access_token;
        // Method 3: scan meta tags
        const metas = document.querySelectorAll('meta[name]');
        for (const m of metas) {
            const content = m.getAttribute('content') || '';
            if (content.startsWith('EAA') && content.length > 50)
                return content;
        }
        // Method 4: check cookies for access token patterns
        const cookies = document.cookie || '';
        const match = cookies.match(/access_token=(EAA[A-Za-z0-9]+)/);
        if (match) return match[1];
        // Method 5: look in require('DTSGInitData')
        try {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
                const text = s.textContent || '';
                const tokenMatch = text.match(/"accessToken"\s*:\s*"(EAA[A-Za-z0-9]+)"/);
                if (tokenMatch) return tokenMatch[1];
                const tokenMatch2 = text.match(/"access_token"\s*:\s*"(EAA[A-Za-z0-9]+)"/);
                if (tokenMatch2) return tokenMatch2[1];
            }
        } catch(e) {}
        return '';
    })()
    """
    try:
        result = _cdp_ws_evaluate(ws_url, js_extract, timeout=10)
        return str(result or "").strip()
    except Exception:
        return ""


def extract_token_via_cdp(cdp_port: int = 0, progress_callback=None) -> str:
    """
    Try to extract a Facebook access token from a browser via CDP.

    Searches for a Facebook page target and extracts the token from the
    page's JavaScript context.

    Args:
        cdp_port: CDP port to connect to. If 0, tries common ports.
        progress_callback: optional callback for progress messages.

    Returns:
        Access token string, or empty string if not found.
    """
    def _progress(msg):
        if progress_callback:
            progress_callback(msg)

    ports_to_try = [cdp_port] if cdp_port else [9225, 9222, 9333]

    for port in ports_to_try:
        if not port:
            continue
        targets = _cdp_get_targets(port)
        if not targets:
            continue

        _progress(f"[CDP] Encontrados {len(targets)} targets en puerto {port}")

        fb_target = _find_facebook_target(targets)
        if not fb_target:
            # Try all page targets
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    token = _extract_token_from_page(t["webSocketDebuggerUrl"])
                    if token and token.startswith("EAA"):
                        _progress(f"[CDP] Token extraido de target: {t.get('title', 'unknown')[:50]}")
                        return token
            continue

        ws_url = fb_target.get("webSocketDebuggerUrl", "")
        if not ws_url:
            continue

        _progress(f"[CDP] Conectando a Facebook target: {fb_target.get('title', '')[:60]}")
        token = _extract_token_from_page(ws_url)
        if token and token.startswith("EAA"):
            _progress(f"[CDP] Token de Facebook extraido exitosamente via CDP (longitud: {len(token)})")
            return token

    return ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _string(value: Any) -> str:
    return str(value or "").strip()


def _dict(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _list(value: Any) -> List[Any]:
    return list(value) if isinstance(value, list) else []


def _normalize_field(value: Any) -> str:
    text = _string(value).lower().replace("-", "_").replace(" ", "_")
    while "__" in text:
        text = text.replace("__", "_")
    return FIELD_ALIASES.get(text, "")


def _normalize_fields(value: Any) -> List[str]:
    seen = set()
    normalized: List[str] = []
    for item in _list(value):
        key = _normalize_field(item)
        if key and key not in seen:
            normalized.append(key)
            seen.add(key)
    return normalized


def _progress(callback, line: str) -> None:
    if callback:
        callback(line)


# ---------------------------------------------------------------------------
# Graph API — HTTP requests (no external deps, uses urllib)
# ---------------------------------------------------------------------------

def _graph_request(
    method: str,
    path_name: str,
    token: str,
    params: Optional[Dict[str, Any]] = None,
    files: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute a Facebook Graph API request using urllib (no requests dependency)."""
    url = f"{GRAPH_BASE_URL}/{path_name.lstrip('/')}"
    payload: Dict[str, str] = {}
    for key, value in (params or {}).items():
        if value is None or value == "":
            continue
        payload[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
    payload["access_token"] = token

    if files:
        # Multipart upload for images
        return _graph_multipart_request(url, payload, files)

    encoded = urllib.parse.urlencode(payload).encode("utf-8")

    if method.upper() == "GET":
        full_url = f"{url}?{encoded.decode('utf-8')}"
        req = urllib.request.Request(full_url, method="GET")
    else:
        req = urllib.request.Request(url, data=encoded, method=method.upper())
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            data = json.loads(body) if body else {}
        except Exception:
            data = {}
        error = data.get("error", {})
        message = error.get("message") or body or f"HTTP {e.code}"
        subcode = error.get("error_subcode")
        detail = f"{message} | subcode={subcode}" if subcode else message
        raise RuntimeError(detail) from e

    if data.get("error"):
        error = data["error"]
        message = error.get("message", str(error))
        subcode = error.get("error_subcode")
        detail = f"{message} | subcode={subcode}" if subcode else message
        raise RuntimeError(detail)

    return data


def _graph_multipart_request(url: str, fields: Dict[str, str], files: Dict[str, Any]) -> Dict[str, Any]:
    """Multipart form-data upload for Graph API (image upload)."""
    import io

    boundary = f"----CDPBoundary{int(time.time() * 1000)}"
    body_parts = []

    for key, value in fields.items():
        body_parts.append(f"--{boundary}\r\n".encode())
        body_parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        body_parts.append(f"{value}\r\n".encode())

    for key, file_obj in files.items():
        file_data = file_obj.read() if hasattr(file_obj, "read") else file_obj
        filename = getattr(file_obj, "name", "image.png")
        if isinstance(filename, str) and "/" in filename:
            filename = filename.rsplit("/", 1)[-1]
        body_parts.append(f"--{boundary}\r\n".encode())
        body_parts.append(f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
        body_parts.append(file_data if isinstance(file_data, bytes) else file_data.encode())
        body_parts.append(b"\r\n")

    body_parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(body_parts)

    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        try:
            data = json.loads(body_text) if body_text else {}
        except Exception:
            data = {}
        error = data.get("error", {})
        message = error.get("message") or body_text or f"HTTP {e.code}"
        raise RuntimeError(message) from e


# ---------------------------------------------------------------------------
# Form helpers
# ---------------------------------------------------------------------------

def _question_signature(questions: List[Dict[str, Any]]) -> Dict[str, bool]:
    keys = {_normalize_field(question.get("key") or question.get("type")) for question in questions}
    return {
        "full_name": "full_name" in keys,
        "first_name": "first_name" in keys,
        "last_name": "last_name" in keys,
        "email": "email" in keys,
        "phone_number": "phone_number" in keys,
    }


def _matches_required_fields(signature: Dict[str, bool], required_fields: List[str]) -> Dict[str, bool]:
    required = set(required_fields or [])
    exact = True
    for field in required:
        if field == "full_name":
            if not signature.get("full_name"):
                exact = False
        elif not signature.get(field):
            exact = False
    acceptable = (
        "full_name" not in required
        or signature.get("full_name")
        or (signature.get("first_name") and signature.get("last_name"))
    )
    acceptable = acceptable and all(
        signature.get(field) for field in required if field not in {"full_name"}
    )
    return {
        "exactMatch": exact,
        "acceptableMatch": acceptable,
    }


# ---------------------------------------------------------------------------
# Facebook Graph API operations
# ---------------------------------------------------------------------------

def list_leadgen_forms(page_id: str, token: str) -> List[Dict[str, Any]]:
    result = _graph_request("GET", f"{page_id}/leadgen_forms", token, {
        "fields": "id,name,status",
        "limit": 50,
    })
    forms = _list(result.get("data"))
    return [
        {
            "id": _string(item.get("id")),
            "name": _string(item.get("name")) or "Sin nombre",
            "status": _string(item.get("status")) or "UNKNOWN",
        }
        for item in forms
        if _string(item.get("id"))
    ]


def get_leadgen_form_questions(form_id: str, token: str) -> List[Dict[str, Any]]:
    result = _graph_request("GET", form_id, token, {"fields": "id,name,questions"})
    questions = _list(result.get("questions"))
    return [
        {
            "key": _normalize_field(item.get("key") or item.get("type")),
            "label": _string(item.get("label") or item.get("key") or item.get("type")),
            "type": _string(item.get("type")),
        }
        for item in questions
    ]


def enrich_forms(forms: List[Dict[str, Any]], token: str, required_fields: List[str]) -> List[Dict[str, Any]]:
    enriched: List[Dict[str, Any]] = []
    for form in forms:
        try:
            questions = get_leadgen_form_questions(_string(form.get("id")), token)
            signature = _question_signature(questions)
            matches = _matches_required_fields(signature, required_fields)
            enriched.append({
                **form,
                "questions": questions,
                "requirements": {
                    **signature,
                    **matches,
                },
            })
        except Exception as error:
            enriched.append({
                **form,
                "questions": [],
                "requirements": {},
                "questionsError": str(error),
            })
    return enriched


def select_best_form(forms: List[Dict[str, Any]], required_fields: List[str]) -> Dict[str, Any]:
    explicit = next((form for form in forms if _string(form.get("id")) and form.get("requirements", {}).get("exactMatch")), None)
    if explicit:
        return {
            "id": explicit["id"],
            "name": explicit["name"],
            "selectionReason": f"Seleccionado automaticamente por cumplir con {required_fields}.",
            "matchType": "exact",
        }
    acceptable = next((form for form in forms if _string(form.get("id")) and form.get("requirements", {}).get("acceptableMatch")), None)
    if acceptable:
        return {
            "id": acceptable["id"],
            "name": acceptable["name"],
            "selectionReason": f"No hubo match exacto; se reutilizara un formulario aceptable para {required_fields}.",
            "matchType": "acceptable",
        }
    return {
        "id": "",
        "name": "",
        "selectionReason": "No se encontro un formulario que cumpla con los campos requeridos.",
        "matchType": "none",
    }


def build_form_questions(required_fields: List[str]) -> List[Dict[str, str]]:
    fields = list(required_fields or [])
    questions: List[Dict[str, str]] = []
    if "full_name" in fields:
        questions.append({"type": QUESTION_TYPE_MAP["full_name"]})
    else:
        if "first_name" in fields:
            questions.append({"type": QUESTION_TYPE_MAP["first_name"]})
        if "last_name" in fields:
            questions.append({"type": QUESTION_TYPE_MAP["last_name"]})
    for field in fields:
        if field in {"full_name", "first_name", "last_name"}:
            continue
        question_type = QUESTION_TYPE_MAP.get(field)
        if question_type:
            questions.append({"type": question_type})
    return questions


def create_leadgen_form(spec: Dict[str, Any], token: str) -> Dict[str, Any]:
    required_fields = _normalize_fields(spec.get("required_fields")) or ["full_name", "email", "phone_number"]
    questions = build_form_questions(required_fields)
    privacy_url = _string(spec.get("privacy_policy_url"))
    payload = {
        "name": _string(spec.get("name")) or "Formulario Lead Ads",
        "locale": _string(spec.get("locale")) or "es_LA",
        "follow_up_action_url": _string(spec.get("follow_up_action_url")),
        "privacy_policy_url": privacy_url,
        "privacy_policy": {
            "url": privacy_url,
            "link_text": _string(spec.get("privacy_policy_link_text")) or "Politica de privacidad",
        } if privacy_url else None,
        "questions": questions,
    }
    result = _graph_request("POST", f"{_string(spec.get('page_id'))}/leadgen_forms", token, payload)
    return {
        "id": _string(result.get("id")),
        "name": payload["name"],
        "selectionReason": f"Formulario creado automaticamente via CDP con campos {required_fields}.",
        "matchType": "created",
    }


def create_campaign(spec: Dict[str, Any], token: str) -> Dict[str, Any]:
    campaign = _dict(spec.get("campaign"))
    result = _graph_request("POST", f"{_string(spec.get('ad_account_id'))}/campaigns", token, {
        "name": _string(campaign.get("name")),
        "objective": _string(campaign.get("objective")) or "OUTCOME_LEADS",
        "status": _string(campaign.get("status")) or "PAUSED",
        "special_ad_categories": _list(campaign.get("special_ad_categories")),
        "is_adset_budget_sharing_enabled": "true" if bool(campaign.get("is_adset_budget_sharing_enabled")) else "false",
    })
    return {
        "id": _string(result.get("id")),
        "name": _string(campaign.get("name")),
    }


def create_adset(spec: Dict[str, Any], token: str, campaign_id: str) -> Dict[str, Any]:
    adset = deepcopy(_dict(spec.get("adset")))
    adset["campaign_id"] = campaign_id
    adset["name"] = _string(adset.get("name"))
    adset["daily_budget"] = _string(adset.get("daily_budget"))
    adset["lifetime_budget"] = _string(adset.get("lifetime_budget"))
    if adset.get("daily_budget"):
        adset.pop("lifetime_budget", None)
    adset["billing_event"] = _string(adset.get("billing_event")) or "IMPRESSIONS"
    adset["optimization_goal"] = _string(adset.get("optimization_goal")) or "LEAD_GENERATION"
    adset["bid_strategy"] = _string(adset.get("bid_strategy")) or "LOWEST_COST_WITHOUT_CAP"
    adset["destination_type"] = _string(adset.get("destination_type")) or "ON_AD"
    adset["status"] = _string(adset.get("status")) or "PAUSED"
    result = _graph_request("POST", f"{_string(spec.get('ad_account_id'))}/adsets", token, adset)
    return {
        "id": _string(result.get("id")),
        "name": _string(adset.get("name")),
        "targeting_summary": _build_targeting_summary(_dict(adset.get("targeting"))),
        "deferred_to_ui": False,
    }


def upload_image(ad_account_id: str, image_path: str, token: str) -> str:
    if not image_path or not Path(image_path).exists():
        return ""
    with Path(image_path).open("rb") as file_handle:
        result = _graph_request("POST", f"{ad_account_id}/adimages", token, {}, files={"filename": file_handle})
    images = _dict(result.get("images"))
    if images:
        first = next(iter(images.values()))
        return _string(_dict(first).get("hash"))
    return _string(result.get("hash"))


def create_creative(spec: Dict[str, Any], token: str, leadgen_form_id: str) -> Dict[str, Any]:
    creative = _dict(spec.get("creative"))
    object_story_spec = deepcopy(_dict(creative.get("object_story_spec")))
    image_hash = upload_image(_string(spec.get("ad_account_id")), _string(creative.get("image_path")), token)
    link_data = _dict(object_story_spec.get("link_data"))
    if image_hash:
        link_data["image_hash"] = image_hash
    if leadgen_form_id:
        link_data["call_to_action"] = {
            "type": _string(creative.get("call_to_action_type")) or "SIGN_UP",
            "value": {
                "lead_gen_form_id": leadgen_form_id,
            },
        }
    object_story_spec["link_data"] = link_data
    result = _graph_request("POST", f"{_string(spec.get('ad_account_id'))}/adcreatives", token, {
        "name": _string(creative.get("name")),
        "object_story_spec": object_story_spec,
    })
    return {
        "id": _string(result.get("id")),
        "name": _string(creative.get("name")),
        "image_hash": image_hash,
    }


def create_ad(spec: Dict[str, Any], token: str, adset_id: str, creative_id: str) -> Dict[str, Any]:
    ad = _dict(spec.get("ad"))
    result = _graph_request("POST", f"{_string(spec.get('ad_account_id'))}/ads", token, {
        "name": _string(ad.get("name")),
        "adset_id": adset_id,
        "creative": {"creative_id": creative_id},
        "status": _string(ad.get("status")) or "PAUSED",
    })
    return {
        "id": _string(result.get("id")),
        "name": _string(ad.get("name")),
    }


def _build_targeting_summary(targeting: Dict[str, Any]) -> str:
    geo = _dict(targeting.get("geo_locations"))
    countries = ",".join(_string(item) for item in _list(geo.get("countries")) if _string(item)) or "sin pais"
    age_min = _string(targeting.get("age_min")) or "?"
    age_max = _string(targeting.get("age_max")) or "?"
    return f"{countries}, edades {age_min}-{age_max}"


# ---------------------------------------------------------------------------
# Main bundle execution
# ---------------------------------------------------------------------------

def execute_lead_campaign_bundle(spec: Dict[str, Any], progress_callback=None) -> Dict[str, Any]:
    """
    Create a full lead campaign bundle on Facebook via Graph API.

    Token resolution order:
    1. Explicit access_token in spec
    2. Environment variable FB_ACCESS_TOKEN / FACEBOOK_ACCESS_TOKEN
    3. CDP extraction from browser (if cdp_port is provided in spec)
    """
    token = _string(
        spec.get("access_token")
        or os.getenv("FB_ACCESS_TOKEN")
        or os.getenv("FACEBOOK_ACCESS_TOKEN")
    )

    # Try CDP token extraction if no explicit token
    cdp_port = int(spec.get("cdp_port", 0) or 0)
    if not token and cdp_port:
        _progress(progress_callback, f"[CDP] No hay token explicito. Intentando extraer via CDP en puerto {cdp_port}...")
        token = extract_token_via_cdp(cdp_port, progress_callback)

    if not token:
        raise RuntimeError("No existe token de Facebook. Configure FB_ACCESS_TOKEN en .env o asegure que el navegador tenga Facebook abierto para extraccion via CDP.")

    page_id = _string(spec.get("page_id"))
    lead_form = _dict(spec.get("lead_form"))
    page_token = _string(lead_form.get("page_access_token")) or token
    required_fields = _normalize_fields(lead_form.get("required_fields")) or ["full_name", "email", "phone_number"]

    result: Dict[str, Any] = {
        "ok": True,
        "account": {
            "id": _string(spec.get("ad_account_id")),
            "account_id": _string(spec.get("ad_account_id")).replace("act_", ""),
            "name": _string(spec.get("account_name")) or _string(spec.get("ad_account_id")),
        },
        "leadgen_forms": [],
        "selected_leadgen_form": {},
        "campaign": {},
        "adset": {},
        "creative": {},
        "ad": {},
        "lead_form_plan": {
            "page_id": page_id,
            "required_fields": required_fields,
            "ui_field_labels": _list(lead_form.get("ui_field_labels")),
            "form_type": _string(lead_form.get("form_type")) or "higher_intent",
            "intro_headline": _string(lead_form.get("intro_headline")),
            "intro_body": _string(lead_form.get("intro_body")),
            "thank_you_title": _string(lead_form.get("thank_you_title")),
            "thank_you_body": _string(lead_form.get("thank_you_body")),
            "thank_you_button_text": _string(lead_form.get("thank_you_button_text")),
        },
    }

    selected_form = {"id": "", "name": "", "selectionReason": "", "matchType": "none"}
    if _string(spec.get("contact_mode")) != "whatsapp" and page_id:
        _progress(progress_callback, f"[CDP] Consultando formularios Instant Form en la pagina {page_id}...")
        try:
            forms = list_leadgen_forms(page_id, page_token)
            enriched_forms = enrich_forms(forms, page_token, required_fields)
            selected_form = select_best_form(enriched_forms, required_fields)
            result["leadgen_forms"] = enriched_forms
            result["selected_leadgen_form"] = selected_form
            if not _string(selected_form.get("id")) and bool(lead_form.get("create_if_missing")):
                _progress(progress_callback, "[CDP] No existe un Instant Form exacto. Intentando crear uno nuevo...")
                created_form = create_leadgen_form(lead_form, page_token)
                selected_form = created_form
                result["selected_leadgen_form"] = created_form
                result["leadgen_forms"] = result["leadgen_forms"] + [{
                    "id": created_form["id"],
                    "name": created_form["name"],
                    "status": "ACTIVE",
                    "questions": [{"key": field, "label": field, "type": QUESTION_TYPE_MAP.get(field, field)} for field in required_fields],
                    "requirements": {
                        **{field: True for field in required_fields},
                        "exactMatch": True,
                        "acceptableMatch": True,
                    },
                }]
        except Exception as error:
            result["leadgen_forms_error"] = str(error)
            _progress(progress_callback, f"[CDP] No se pudieron consultar/crear formularios: {error}")

    _progress(progress_callback, f"[CDP] Creando campaign en {_string(spec.get('ad_account_id'))}...")
    campaign = create_campaign(spec, token)
    result["campaign"] = campaign

    _progress(progress_callback, f"[CDP] Creando adset para campaign {campaign['id']}...")
    try:
        adset = create_adset(spec, token, campaign["id"])
        result["adset"] = adset
    except Exception as error:
        error_text = str(error)
        deferred = "promoted_object" in error_text or "page id" in error_text.lower()
        result["adset"] = {
            "id": "",
            "name": _string(_dict(spec.get("adset")).get("name")),
            "targeting_summary": _build_targeting_summary(_dict(_dict(spec.get("adset")).get("targeting"))),
            "deferred_to_ui": deferred,
            "error": error_text,
        }
        if deferred:
            _progress(progress_callback, f"[CDP] Meta exige un objeto promocionado valido para Lead Ads. Se continuara por la UI. Detalle: {error_text}")
        else:
            _progress(progress_callback, f"[CDP] No se pudo crear el adset: {error_text}")

    adset_id = _string(_dict(result.get("adset")).get("id"))
    leadgen_form_id = _string(selected_form.get("id"))
    image_path = _string(_dict(spec.get("creative")).get("image_path"))
    if adset_id and leadgen_form_id and image_path:
        try:
            _progress(progress_callback, f"[CDP] Creando creative para adset {adset_id} con leadgen_form_id {leadgen_form_id}...")
            creative = create_creative(spec, token, leadgen_form_id)
            result["creative"] = creative
            _progress(progress_callback, f"[CDP] Creando anuncio final en adset {adset_id}...")
            result["ad"] = create_ad(spec, token, adset_id, _string(creative.get("id")))
        except Exception as error:
            result["creative_error"] = str(error)
            _progress(progress_callback, f"[CDP] No se pudo crear creative/ad: {error}")
    else:
        _progress(progress_callback, "[CDP] Saltando creative/ad porque falta image_path, adset_id o leadgen_form_id utilizable.")

    return result


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _main() -> int:
    payload = sys.stdin.read().strip()
    if not payload:
        return 0
    try:
        spec = json.loads(payload)
        result = execute_lead_campaign_bundle(spec, progress_callback=lambda line: print(line, file=sys.stderr, flush=True))
        print(json.dumps(result), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
