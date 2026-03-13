from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
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
        # WAL might not be supported on some network filesystems; keep default.
        pass
    conn.execute("PRAGMA synchronous=NORMAL;")
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

