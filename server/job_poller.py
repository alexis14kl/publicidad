from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import socket
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from bot_runner import BotRunnerError, execute_action, get_status, is_busy  # noqa: E402
from utils.logger import log_info, log_ok, log_warn, log_error, progress_bar  # noqa: E402
STATE_FILE = PROJECT_ROOT / ".job_poller_state.json"
DEFAULT_POLL_INTERVAL_SEC = 15
DEFAULT_TIMEOUT_SEC = 60
DEFAULT_RUN_TIMEOUT_SEC = 7200
DEFAULT_N8N_BASE_URL = "https://n8n-dev.noyecode.com"
DEFAULT_PROJECT_ID = "bkrM241Q8UeW2zme"
DEFAULT_TABLE_ID = "LFM69EeeF7pa8yiO"
DEFAULT_EXECUTION_WORKFLOW_ID = "5zKqthFIw2-FhYBIkCKnu"
DEFAULT_EXECUTION_FETCH_LIMIT = 50


class JobPollerError(RuntimeError):
    pass


def utc_now_iso(offset_sec: int = 0) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + offset_sec))


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _read_json_response(resp: Any) -> dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise JobPollerError(f"Respuesta JSON invalida: {raw[:300]}") from exc
    if isinstance(data, dict):
        return data
    raise JobPollerError("La API devolvio un JSON inesperado")


def post_json(url: str, payload: dict[str, Any], timeout_sec: int, secret: str = "") -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "publicidad-job-poller/1.0",
    }
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    req = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            data = _read_json_response(resp)
            data.setdefault("http_status", getattr(resp, "status", 200))
            return data
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise JobPollerError(f"HTTP {exc.code} desde {url}: {body[:300]}") from exc
    except URLError as exc:
        raise JobPollerError(f"No se pudo conectar con {url}: {exc}") from exc


def make_n8n_opener(base_url: str, email: str, password: str) -> tuple[Any, str]:
    if not email or not password:
        raise JobPollerError("Faltan credenciales de n8n para usar modo Data Table")
    cookies = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookies))
    browser_id = _env("N8N_BOT_BROWSER_ID", socket.gethostname())
    login_payload = {
        "emailOrLdapLoginId": email,
        "password": password,
    }
    req = Request(
        f"{base_url.rstrip('/')}/rest/login",
        data=json.dumps(login_payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-job-poller/1.0",
        },
        method="POST",
    )
    try:
        with opener.open(req, timeout=DEFAULT_TIMEOUT_SEC) as resp:
            _read_json_response(resp)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise JobPollerError(f"Login n8n fallo ({exc.code}): {body[:300]}") from exc
    except URLError as exc:
        raise JobPollerError(f"No se pudo conectar con n8n: {exc}") from exc
    return opener, browser_id


def n8n_request(
    opener: Any,
    browser_id: str,
    method: str,
    url: str,
    timeout_sec: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "publicidad-job-poller/1.0",
        "browser-id": browser_id,
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=timeout_sec) as resp:
            body = _read_json_response(resp)
            body.setdefault("http_status", getattr(resp, "status", 200))
            return body
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise JobPollerError(f"HTTP {exc.code} desde {url}: {body[:300]}") from exc
    except URLError as exc:
        raise JobPollerError(f"No se pudo conectar con {url}: {exc}") from exc


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(data: dict[str, Any]) -> None:
    payload = dict(data)
    payload["updated_at"] = int(time.time())
    STATE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_job(data: dict[str, Any]) -> dict[str, Any] | None:
    if not data:
        return None
    job = data.get("job") if isinstance(data.get("job"), dict) else data
    if not isinstance(job, dict):
        return None
    job_id = str(job.get("job_id") or job.get("id") or "").strip()
    action = str(job.get("action") or "").strip()
    if not job_id or not action:
        return None
    payload = job.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    return {
        "job_id": job_id,
        "action": action,
        "payload": payload,
        "row_id": job.get("row_id"),
        "raw": job,
    }


def normalize_table_job(row: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    row_id = row.get("id")
    job_id = str(row.get("job_id") or "").strip()
    action = str(row.get("action") or "").strip()
    if row_id in (None, "") or not job_id or not action:
        return None
    payload_raw = row.get("payload_json") or "{}"
    try:
        payload = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
    except json.JSONDecodeError:
        payload = {}
    return {
        "job_id": job_id,
        "action": action,
        "payload": payload if isinstance(payload, dict) else {},
        "row_id": row_id,
        "raw": row,
    }


def _decode_flat_ref(value: Any, pool: list[Any], memo: dict[int, Any], stack: set[int]) -> Any:
    if isinstance(value, str) and value.isdigit():
        index = int(value)
        if 0 <= index < len(pool):
            if index in memo:
                return memo[index]
            if index in stack:
                return pool[index]
            stack.add(index)
            decoded = _decode_flat_ref(pool[index], pool, memo, stack)
            stack.remove(index)
            memo[index] = decoded
            return decoded
    if isinstance(value, list):
        return [_decode_flat_ref(item, pool, memo, stack) for item in value]
    if isinstance(value, dict):
        return {key: _decode_flat_ref(item, pool, memo, stack) for key, item in value.items()}
    return value


def decode_execution_payload(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        pool = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(pool, list) or not pool:
        return None
    decoded = _decode_flat_ref(pool[0], pool, {}, set())
    return decoded if isinstance(decoded, dict) else None


def extract_job_from_execution(detail: dict[str, Any]) -> dict[str, Any] | None:
    payload = detail.get("data", {}).get("data")
    decoded = decode_execution_payload(payload) if isinstance(payload, str) else None
    if not decoded:
        return None
    run_data = decoded.get("resultData", {}).get("runData", {})
    if not isinstance(run_data, dict):
        return None
    process_runs = run_data.get("Process Telegram Message") or run_data.get("Process Telegram Message1")
    if not isinstance(process_runs, list) or not process_runs:
        return None
    first_run = process_runs[0]
    if not isinstance(first_run, dict):
        return None
    items = first_run.get("data", {}).get("main", [[None]])
    try:
        item = items[0][0]
    except Exception:
        return None
    if not isinstance(item, dict):
        return None
    item_json = item.get("json", {})
    if not isinstance(item_json, dict) or not item_json.get("isBotCommand"):
        return None
    execution_id = str(detail.get("data", {}).get("id") or detail.get("id") or "").strip()
    if not execution_id:
        return None
    payload_json = item_json.get("payload")
    return {
        "job_id": f"exec_{execution_id}",
        "action": str(item_json.get("action") or "run_full_cycle").strip() or "run_full_cycle",
        "payload": payload_json if isinstance(payload_json, dict) else {},
        "execution_id": execution_id,
        "raw": item_json,
    }


def fetch_next_job(next_job_url: str, secret: str, worker_id: str, timeout_sec: int) -> dict[str, Any] | None:
    data = post_json(
        next_job_url,
        {
            "worker_id": worker_id,
            "host": socket.gethostname(),
            "capabilities": ["run_full_cycle", "status"],
            "busy": is_busy(),
        },
        timeout_sec=timeout_sec,
        secret=secret,
    )
    return normalize_job(data)


def update_job(update_url: str, secret: str, worker_id: str, job_id: str, status: str, extra: dict[str, Any], timeout_sec: int) -> dict[str, Any]:
    payload = {
        "worker_id": worker_id,
        "job_id": job_id,
        "status": status,
    }
    payload.update(extra)
    return post_json(update_url, payload, timeout_sec=timeout_sec, secret=secret)


def fetch_next_table_job(args: argparse.Namespace, timeout_sec: int) -> dict[str, Any] | None:
    opener, browser_id = make_n8n_opener(args.n8n_base_url, args.n8n_login_email, args.n8n_login_password)
    rows_url = (
        f"{args.n8n_base_url.rstrip('/')}/rest/projects/{args.n8n_project_id}"
        f"/data-tables/{args.n8n_table_id}/rows"
    )
    data = n8n_request(opener, browser_id, "GET", rows_url, timeout_sec=timeout_sec)
    rows = data.get("data", {}).get("data", [])
    if not isinstance(rows, list):
        return None
    pending = [row for row in rows if str(row.get("status") or "").strip().lower() == "pending"]
    if not pending:
        return None
    pending.sort(key=lambda item: (str(item.get("created_at") or ""), int(item.get("id") or 0)))
    row = pending[0]
    row_id = row.get("id")
    attempts = int(row.get("attempts") or 0) + 1
    lease_expires_at = utc_now_iso(5 * 60)
    claim_payload = {
        "filter": {
            "type": "and",
            "filters": [
                {
                    "columnName": "id",
                    "condition": "eq",
                    "value": row_id,
                },
                {
                    "columnName": "status",
                    "condition": "eq",
                    "value": "pending",
                }
            ],
        },
        "data": {
            "status": "running",
            "worker_id": args.worker_id,
            "attempts": attempts,
            "lease_expires_at": lease_expires_at,
            "updated_at": utc_now_iso(),
        },
    }
    n8n_request(opener, browser_id, "PATCH", rows_url, timeout_sec=timeout_sec, payload=claim_payload)
    return normalize_table_job({**row, "status": "running", "worker_id": args.worker_id, "attempts": attempts, "lease_expires_at": lease_expires_at})


def fetch_execution_detail(args: argparse.Namespace, execution_id: str, timeout_sec: int) -> dict[str, Any]:
    opener, browser_id = make_n8n_opener(args.n8n_base_url, args.n8n_login_email, args.n8n_login_password)
    url = f"{args.n8n_base_url.rstrip('/')}/rest/executions/{execution_id}"
    return n8n_request(opener, browser_id, "GET", url, timeout_sec=timeout_sec)


def fetch_next_execution_job(args: argparse.Namespace, timeout_sec: int) -> dict[str, Any] | None:
    opener, browser_id = make_n8n_opener(args.n8n_base_url, args.n8n_login_email, args.n8n_login_password)
    list_url = f"{args.n8n_base_url.rstrip('/')}/rest/executions?limit={args.execution_fetch_limit}"
    data = n8n_request(opener, browser_id, "GET", list_url, timeout_sec=timeout_sec)
    results = data.get("data", {}).get("results", [])
    if not isinstance(results, list):
        return None
    state = load_state()
    last_execution_id = int(state.get("last_execution_id") or 0)
    candidates = []
    for item in results:
        if not isinstance(item, dict):
            continue
        workflow_id = str(item.get("workflowId") or "").strip()
        execution_id_raw = str(item.get("id") or "").strip()
        if workflow_id != args.n8n_execution_workflow_id or not execution_id_raw.isdigit():
            continue
        execution_id = int(execution_id_raw)
        if execution_id <= last_execution_id:
            continue
        candidates.append((execution_id, item))
    candidates.sort(key=lambda pair: pair[0])
    for execution_id, _item in candidates:
        detail = fetch_execution_detail(args, str(execution_id), timeout_sec)
        job = extract_job_from_execution(detail)
        if job:
            return job
        save_state({"last_execution_id": execution_id, "queue_mode": "executions"})
    return None


def update_table_job(args: argparse.Namespace, job: dict[str, Any], status: str, extra: dict[str, Any], timeout_sec: int) -> dict[str, Any]:
    row_id = job.get("row_id")
    if row_id in (None, ""):
        raise JobPollerError("El job de Data Table no trae row_id")
    opener, browser_id = make_n8n_opener(args.n8n_base_url, args.n8n_login_email, args.n8n_login_password)
    rows_url = (
        f"{args.n8n_base_url.rstrip('/')}/rest/projects/{args.n8n_project_id}"
        f"/data-tables/{args.n8n_table_id}/rows"
    )
    row_data = {
        "status": status,
        "worker_id": args.worker_id,
        "updated_at": utc_now_iso(),
    }
    if "result" in extra:
        row_data["result_json"] = json.dumps(extra["result"], ensure_ascii=False)
        row_data["error_text"] = ""
    if "error" in extra:
        row_data["error_text"] = str(extra["error"])
    if status in {"success", "error", "cancelled"}:
        row_data["lease_expires_at"] = ""
    payload = {
        "filter": {
            "type": "and",
            "filters": [
                {
                    "columnName": "id",
                    "condition": "eq",
                    "value": row_id,
                }
            ],
        },
        "data": row_data,
    }
    return n8n_request(opener, browser_id, "PATCH", rows_url, timeout_sec=timeout_sec, payload=payload)


def process_job(job: dict[str, Any], update_url: str, secret: str, worker_id: str, timeout_sec: int, run_timeout_sec: int) -> dict[str, Any]:
    job_id = job["job_id"]
    action = job["action"]
    payload = job.get("payload") or {}

    update_job(
        update_url,
        secret,
        worker_id,
        job_id,
        "running",
        {"runner_status": get_status(), "action": action},
        timeout_sec=timeout_sec,
    )

    try:
        result = execute_action(action, payload=payload, timeout_sec=run_timeout_sec)
    except BotRunnerError as exc:
        update_job(
            update_url,
            secret,
            worker_id,
            job_id,
            "error",
            {"error": str(exc), "action": action},
            timeout_sec=timeout_sec,
        )
        raise

    final_status = "success" if result.success else "error"
    response = update_job(
        update_url,
        secret,
        worker_id,
        job_id,
        final_status,
        {
            "action": action,
            "result": result.to_dict(),
        },
        timeout_sec=timeout_sec,
    )
    save_state(
        {
            "last_job_id": job_id,
            "last_action": action,
            "last_status": final_status,
            "last_http_status": response.get("http_status", 200),
        }
    )
    return {"job_id": job_id, "status": final_status, "result": result.to_dict()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Polling worker local para consumir jobs desde n8n.")
    parser.add_argument("--next-job-url", default=_env("N8N_BOT_NEXT_JOB_URL"))
    parser.add_argument("--update-job-url", default=_env("N8N_BOT_UPDATE_JOB_URL"))
    parser.add_argument("--secret", default=_env("N8N_BOT_SECRET"))
    parser.add_argument("--n8n-base-url", default=_env("N8N_BASE_URL", DEFAULT_N8N_BASE_URL))
    parser.add_argument("--n8n-login-email", default=_env("N8N_LOGIN_EMAIL", ""))
    parser.add_argument("--n8n-login-password", default=_env("N8N_LOGIN_PASSWORD", ""))
    parser.add_argument("--n8n-project-id", default=_env("N8N_PROJECT_ID", DEFAULT_PROJECT_ID))
    parser.add_argument("--n8n-table-id", default=_env("N8N_BOT_TABLE_ID", DEFAULT_TABLE_ID))
    parser.add_argument("--n8n-execution-workflow-id", default=_env("N8N_BOT_EXECUTION_WORKFLOW_ID", DEFAULT_EXECUTION_WORKFLOW_ID))
    parser.add_argument("--execution-fetch-limit", type=int, default=int(_env("N8N_BOT_EXECUTION_FETCH_LIMIT", str(DEFAULT_EXECUTION_FETCH_LIMIT)) or DEFAULT_EXECUTION_FETCH_LIMIT))
    parser.add_argument("--poll-interval", type=int, default=int(_env("N8N_BOT_POLL_INTERVAL", str(DEFAULT_POLL_INTERVAL_SEC)) or DEFAULT_POLL_INTERVAL_SEC))
    parser.add_argument("--timeout", type=int, default=int(_env("N8N_BOT_TIMEOUT", str(DEFAULT_TIMEOUT_SEC)) or DEFAULT_TIMEOUT_SEC))
    parser.add_argument("--run-timeout", type=int, default=int(_env("N8N_BOT_RUN_TIMEOUT", str(DEFAULT_RUN_TIMEOUT_SEC)) or DEFAULT_RUN_TIMEOUT_SEC))
    parser.add_argument("--worker-id", default=_env("N8N_BOT_WORKER_ID", socket.gethostname()))
    parser.add_argument("--queue-mode", choices=["webhook", "datatable", "executions"], default=_env("N8N_BOT_QUEUE_MODE", "executions") or "executions")
    parser.add_argument("--once", action="store_true", help="Hace un solo ciclo de polling.")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if args.queue_mode == "webhook":
        if not args.next_job_url:
            raise JobPollerError("Falta --next-job-url o N8N_BOT_NEXT_JOB_URL")
        if not args.update_job_url:
            raise JobPollerError("Falta --update-job-url o N8N_BOT_UPDATE_JOB_URL")
        return
    if not args.n8n_login_email:
        raise JobPollerError("Falta N8N_LOGIN_EMAIL para usar Data Table")
    if not args.n8n_login_password:
        raise JobPollerError("Falta N8N_LOGIN_PASSWORD para usar Data Table")
    if args.queue_mode == "datatable" and (not args.n8n_project_id or not args.n8n_table_id):
        raise JobPollerError("Faltan N8N_PROJECT_ID o N8N_BOT_TABLE_ID para usar Data Table")
    if args.queue_mode == "executions" and not args.n8n_execution_workflow_id:
        raise JobPollerError("Falta N8N_BOT_EXECUTION_WORKFLOW_ID para usar modo executions")


def run_once(args: argparse.Namespace) -> int:
    if is_busy():
        status = get_status()
        log_warn(f"Bot ocupado: {status.get('action', 'unknown')}")
        return 0

    with progress_bar(f"Polling n8n ({args.queue_mode})..."):
        if args.queue_mode == "datatable":
            job = fetch_next_table_job(args, args.timeout)
        elif args.queue_mode == "executions":
            job = fetch_next_execution_job(args, args.timeout)
        else:
            job = fetch_next_job(args.next_job_url, args.secret, args.worker_id, args.timeout)

    if not job:
        log_info("Sin jobs pendientes. Esperando...")
        return 0

    log_ok(f"Job recibido: {job['job_id']} -> {job['action']}")

    if args.queue_mode == "datatable":
        try:
            with progress_bar(f"Ejecutando {job['action']}..."):
                result = execute_action(job["action"], payload=job.get("payload") or {}, timeout_sec=args.run_timeout)
        except BotRunnerError as exc:
            log_error(f"Job fallo: {exc}")
            update_table_job(args, job, "error", {"error": str(exc)}, args.timeout)
            save_state(
                {
                    "last_job_id": job["job_id"],
                    "last_action": job["action"],
                    "last_status": "error",
                    "last_error": str(exc),
                    "queue_mode": "datatable",
                }
            )
            raise
        final_status = "success" if result.success else "error"
        update_table_job(args, job, final_status, {"result": result.to_dict()}, args.timeout)
        outcome = {"job_id": job["job_id"], "status": final_status, "result": result.to_dict()}
        save_state(
            {
                "last_job_id": job["job_id"],
                "last_action": job["action"],
                "last_status": final_status,
                "queue_mode": "datatable",
            }
        )
    elif args.queue_mode == "executions":
        execution_id = int(job.get("execution_id") or 0)
        try:
            with progress_bar(f"Ejecutando {job['action']}..."):
                result = execute_action(job["action"], payload=job.get("payload") or {}, timeout_sec=args.run_timeout)
        except BotRunnerError as exc:
            log_error(f"Job fallo: {exc}")
            save_state(
                {
                    "last_execution_id": execution_id,
                    "last_job_id": job["job_id"],
                    "last_action": job["action"],
                    "last_status": "error",
                    "last_error": str(exc),
                    "queue_mode": "executions",
                }
            )
            raise
        final_status = "success" if result.success else "error"
        outcome = {"job_id": job["job_id"], "status": final_status, "result": result.to_dict()}
        save_state(
            {
                "last_execution_id": execution_id,
                "last_job_id": job["job_id"],
                "last_action": job["action"],
                "last_status": final_status,
                "queue_mode": "executions",
            }
        )
    else:
        with progress_bar(f"Ejecutando {job['action']}..."):
            outcome = process_job(
                job,
                update_url=args.update_job_url,
                secret=args.secret,
                worker_id=args.worker_id,
                timeout_sec=args.timeout,
                run_timeout_sec=args.run_timeout,
            )

    if outcome.get("status") == "success":
        log_ok(f"Job completado: {outcome.get('job_id', '')}")
    else:
        log_warn(f"Job termino con estado: {outcome.get('status', 'unknown')}")
    return 0


def main() -> int:
    try:
        args = parse_args()
        validate_args(args)
        log_ok(f"Worker iniciado [{args.worker_id}] modo={args.queue_mode} intervalo={args.poll_interval}s")

        if args.once:
            return run_once(args)

        cycle = 0
        while True:
            cycle += 1
            try:
                run_once(args)
            except Exception as exc:
                log_error(str(exc))
            time.sleep(max(3, args.poll_interval))
    except KeyboardInterrupt:
        log_warn("Worker detenido por el usuario.")
        return 0
    except Exception as exc:
        log_error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
