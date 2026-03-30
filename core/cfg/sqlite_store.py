from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "publicidad.sqlite3"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def get_db_path() -> Path:
    raw = str(os.getenv("PUBLICIDAD_DB_PATH", "")).strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return DEFAULT_DB_PATH


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except sqlite3.OperationalError:
        pass
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def init_db(conn: sqlite3.Connection | None = None) -> None:
    owns = conn is None
    conn = conn or connect()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
              run_id TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              action TEXT NOT NULL,
              status TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              result_json TEXT NOT NULL,
              error_text TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS artifacts (
              artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT,
              created_at TEXT NOT NULL,
              type TEXT NOT NULL,
              content TEXT NOT NULL,
              file_path TEXT NOT NULL,
              meta_json TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS artifacts_type_idx ON artifacts (type)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS job_queue (
              job_id       TEXT PRIMARY KEY,
              created_at   TEXT NOT NULL,
              updated_at   TEXT NOT NULL,
              action       TEXT NOT NULL,
              worker_type  TEXT NOT NULL,
              priority     INTEGER NOT NULL DEFAULT 50,
              status       TEXT NOT NULL DEFAULT 'queued',
              resource_key TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL DEFAULT '{}',
              run_id       TEXT,
              worker_pid   INTEGER,
              claimed_at   TEXT,
              started_at   TEXT,
              finished_at  TEXT,
              result_json  TEXT NOT NULL DEFAULT '{}',
              error_text   TEXT NOT NULL DEFAULT '',
              retry_count  INTEGER NOT NULL DEFAULT 0,
              max_retries  INTEGER NOT NULL DEFAULT 2,
              source       TEXT NOT NULL DEFAULT 'gui',
              company_name TEXT NOT NULL DEFAULT '',
              log_file     TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS job_queue_status_idx ON job_queue (status, priority, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS job_queue_worker_type_idx ON job_queue (worker_type, status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS job_queue_resource_key_idx ON job_queue (resource_key, status)"
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS resource_locks (
              resource_key TEXT PRIMARY KEY,
              job_id       TEXT NOT NULL,
              acquired_at  TEXT NOT NULL,
              expires_at   TEXT NOT NULL,
              worker_pid   INTEGER
            )
            """
        )

        conn.commit()
    finally:
        if owns:
            conn.close()


def _json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except TypeError:
        return json.dumps({"_unserializable": str(value)}, ensure_ascii=False, separators=(",", ":"))


def new_run(
    action: str,
    payload: dict[str, Any] | None = None,
    *,
    run_id: str | None = None,
    status: str = "running",
    conn: sqlite3.Connection | None = None,
) -> str:
    """Create a new run row (idempotent if run_id exists). Returns run_id."""
    init_db(conn)

    owns = conn is None
    conn = conn or connect()
    try:
        rid = (run_id or "").strip() or f"run_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        now = _now_iso()
        payload_json = _json_dumps(payload or {})
        conn.execute(
            """
            INSERT INTO runs(run_id, created_at, updated_at, action, status, payload_json, result_json, error_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO NOTHING
            """,
            (rid, now, now, str(action or "unknown"), str(status or "running"), payload_json, "{}", ""),
        )
        conn.commit()
        return rid
    finally:
        if owns:
            conn.close()


def update_run(
    run_id: str,
    *,
    status: str | None = None,
    result: dict[str, Any] | None = None,
    error_text: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> None:
    init_db(conn)
    rid = str(run_id or "").strip()
    if not rid:
        return

    owns = conn is None
    conn = conn or connect()
    try:
        now = _now_iso()
        fields: list[str] = ["updated_at=?"]
        values: list[Any] = [now]
        if status is not None:
            fields.append("status=?")
            values.append(str(status))
        if result is not None:
            fields.append("result_json=?")
            values.append(_json_dumps(result))
        if error_text is not None:
            fields.append("error_text=?")
            values.append(str(error_text))
        values.append(rid)
        conn.execute(f"UPDATE runs SET {', '.join(fields)} WHERE run_id=?", values)
        conn.commit()
    finally:
        if owns:
            conn.close()


def add_artifact(
    *,
    run_id: str = "",
    artifact_type: str,
    content: str = "",
    file_path: str = "",
    meta: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> None:
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        conn.execute(
            """
            INSERT INTO artifacts(run_id, created_at, type, content, file_path, meta_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(run_id or "").strip() or None,
                _now_iso(),
                str(artifact_type or "unknown"),
                str(content or ""),
                str(file_path or ""),
                _json_dumps(meta or {}),
            ),
        )
        conn.commit()
    finally:
        if owns:
            conn.close()


# ---------------------------------------------------------------------------
# Job queue helpers
# ---------------------------------------------------------------------------

_WORKER_TYPE_MAP: dict[str, str] = {
    "run_full_cycle": "cdp",
    "generate_video": "video",
    "generate_reel": "video",
    "generate_brochure": "brochure",
}


def classify_worker_type(action: str) -> str:
    if action in _WORKER_TYPE_MAP:
        return _WORKER_TYPE_MAP[action]
    if action.startswith("publish_"):
        return "publish"
    if "campaign" in action:
        return "api"
    return "api"


def classify_resource_key(action: str, payload: dict[str, Any] | None = None) -> str:
    wtype = classify_worker_type(action)
    payload = payload or {}
    if wtype == "cdp":
        profile = payload.get("profile_name", "default")
        return f"cdp:profile:{profile}"
    if wtype == "video":
        return "video:slot"
    if wtype == "publish":
        platform = action.replace("publish_", "") if action.startswith("publish_") else "unknown"
        return f"publish:{platform}"
    return ""


def enqueue_job(
    action: str,
    *,
    worker_type: str | None = None,
    resource_key: str | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = 50,
    source: str = "gui",
    company_name: str = "",
    max_retries: int = 2,
    conn: sqlite3.Connection | None = None,
) -> str:
    """Insert a new job into the queue. Returns job_id."""
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        wtype = worker_type or classify_worker_type(action)
        rkey = resource_key if resource_key is not None else classify_resource_key(action, payload)
        job_id = f"job_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO job_queue(
              job_id, created_at, updated_at, action, worker_type, priority,
              status, resource_key, payload_json, source, company_name, max_retries
            ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
            """,
            (
                job_id, now, now, str(action), wtype, priority,
                rkey, _json_dumps(payload or {}), source, company_name, max_retries,
            ),
        )
        conn.commit()
        return job_id
    finally:
        if owns:
            conn.close()


def claim_next_job(
    worker_type: str,
    exclude_resource_keys: list[str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Atomically claim the highest-priority queued job for a worker type."""
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        query = """
            SELECT * FROM job_queue
            WHERE status = 'queued' AND worker_type = ?
        """
        params: list[Any] = [worker_type]
        if exclude_resource_keys:
            placeholders = ",".join("?" for _ in exclude_resource_keys)
            query += f" AND resource_key NOT IN ({placeholders})"
            params.extend(exclude_resource_keys)
        query += " ORDER BY priority ASC, created_at ASC LIMIT 1"
        row = conn.execute(query, params).fetchone()
        if not row:
            return None
        now = _now_iso()
        conn.execute(
            "UPDATE job_queue SET status='claimed', claimed_at=?, updated_at=? WHERE job_id=?",
            (now, now, row["job_id"]),
        )
        conn.commit()
        return dict(row)
    finally:
        if owns:
            conn.close()


def update_job(
    job_id: str,
    *,
    status: str | None = None,
    run_id: str | None = None,
    worker_pid: int | None = None,
    started_at: str | None = None,
    finished_at: str | None = None,
    result: dict[str, Any] | None = None,
    error_text: str | None = None,
    log_file: str | None = None,
    retry_count: int | None = None,
    conn: sqlite3.Connection | None = None,
) -> None:
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        now = _now_iso()
        fields: list[str] = ["updated_at=?"]
        values: list[Any] = [now]
        if status is not None:
            fields.append("status=?"); values.append(status)
        if run_id is not None:
            fields.append("run_id=?"); values.append(run_id)
        if worker_pid is not None:
            fields.append("worker_pid=?"); values.append(worker_pid)
        if started_at is not None:
            fields.append("started_at=?"); values.append(started_at)
        if finished_at is not None:
            fields.append("finished_at=?"); values.append(finished_at)
        if result is not None:
            fields.append("result_json=?"); values.append(_json_dumps(result))
        if error_text is not None:
            fields.append("error_text=?"); values.append(error_text)
        if log_file is not None:
            fields.append("log_file=?"); values.append(log_file)
        if retry_count is not None:
            fields.append("retry_count=?"); values.append(retry_count)
        values.append(job_id)
        conn.execute(f"UPDATE job_queue SET {', '.join(fields)} WHERE job_id=?", values)
        conn.commit()
    finally:
        if owns:
            conn.close()


def list_jobs(
    status_filter: list[str] | None = None,
    limit: int = 50,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        if status_filter:
            placeholders = ",".join("?" for _ in status_filter)
            rows = conn.execute(
                f"SELECT * FROM job_queue WHERE status IN ({placeholders})"
                " ORDER BY priority ASC, created_at DESC LIMIT ?",
                (*status_filter, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM job_queue ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        if owns:
            conn.close()


def acquire_resource(
    resource_key: str,
    job_id: str,
    worker_pid: int = 0,
    ttl_seconds: int = 7200,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Try to acquire a resource lock. Returns True if acquired."""
    if not resource_key:
        return True
    init_db(conn)
    owns = conn is None
    conn = conn or connect()
    try:
        now = _now_iso()
        now_ts = time.time()
        expires = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ts + ttl_seconds))
        conn.execute("DELETE FROM resource_locks WHERE expires_at < ?", (now,))
        existing = conn.execute(
            "SELECT * FROM resource_locks WHERE resource_key = ?", (resource_key,)
        ).fetchone()
        if existing:
            conn.commit()
            return False
        conn.execute(
            "INSERT INTO resource_locks(resource_key, job_id, acquired_at, expires_at, worker_pid)"
            " VALUES (?,?,?,?,?)",
            (resource_key, job_id, now, expires, worker_pid),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        if owns:
            conn.close()


def release_resource(
    resource_key: str,
    conn: sqlite3.Connection | None = None,
) -> None:
    if not resource_key:
        return
    owns = conn is None
    conn = conn or connect()
    try:
        conn.execute("DELETE FROM resource_locks WHERE resource_key = ?", (resource_key,))
        conn.commit()
    finally:
        if owns:
            conn.close()


def cleanup_stale_resources(conn: sqlite3.Connection | None = None) -> None:
    """Remove expired resource locks."""
    owns = conn is None
    conn = conn or connect()
    try:
        now = _now_iso()
        conn.execute("DELETE FROM resource_locks WHERE expires_at < ?", (now,))
        conn.commit()
    finally:
        if owns:
            conn.close()

