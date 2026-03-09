from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_warn  # noqa: E402

MEMORY_DIR = PROJECT_ROOT / "memory" / "profile"
MEMORY_FILE = MEMORY_DIR / "memory_profile_change.json"
DEFAULT_TTL_SEC = 24 * 60 * 60  # 24 horas


def _ensure_dir() -> None:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)


def _load() -> dict:
    if not MEMORY_FILE.exists():
        return {"profiles": {}}
    try:
        data = json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"profiles": {}}
    if not isinstance(data, dict):
        return {"profiles": {}}
    data.setdefault("profiles", {})
    if not isinstance(data["profiles"], dict):
        data["profiles"] = {}
    return data


def _save(data: dict) -> None:
    _ensure_dir()
    MEMORY_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _cleanup_expired(data: dict, ttl_sec: int = DEFAULT_TTL_SEC) -> dict:
    now = datetime.now(timezone.utc)
    cleaned = {}
    for name, entry in data.get("profiles", {}).items():
        if not isinstance(entry, dict):
            continue
        date_str = entry.get("date", "")
        if not date_str:
            continue
        try:
            marked_at = datetime.fromisoformat(date_str)
            if marked_at.tzinfo is None:
                marked_at = marked_at.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        age_sec = (now - marked_at).total_seconds()
        if age_sec < ttl_sec:
            cleaned[name] = entry
        else:
            log_info(f"Perfil '{name}' expirado hace {int(age_sec)}s, limpiado automaticamente.")
    data["profiles"] = cleaned
    return data


def get_expired_profiles() -> dict[str, dict]:
    data = _cleanup_expired(_load())
    _save(data)
    return {
        name: entry
        for name, entry in data.get("profiles", {}).items()
        if entry.get("status") == "vencido"
    }


def is_profile_expired(name: str) -> bool:
    return name in get_expired_profiles()


def mark_profile_expired(name: str, reason: str = "session_expired") -> None:
    data = _cleanup_expired(_load())
    data["profiles"][name] = {
        "status": "vencido",
        "date": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
    }
    _save(data)
    log_warn(f"Perfil marcado como vencido: '{name}' (reason={reason})")


def clear_profile_expired(name: str) -> None:
    data = _load()
    if name in data.get("profiles", {}):
        del data["profiles"][name]
        _save(data)
        log_info(f"Perfil restaurado como activo: '{name}'")


def clear_all_expired() -> int:
    data = _load()
    count = len(data.get("profiles", {}))
    data["profiles"] = {}
    _save(data)
    if count:
        log_info(f"Todos los perfiles limpiados ({count} entradas).")
    return count


def get_active_profiles(all_profiles: list[str]) -> list[str]:
    expired = get_expired_profiles()
    active = []
    for name in all_profiles:
        if name in expired:
            log_info(f"Perfil '{name}' omitido (vencido desde {expired[name].get('date', '?')})")
        else:
            active.append(name)
    return active


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Memoria de perfiles DiCloak")
    parser.add_argument("--status", action="store_true", help="Mostrar estado de perfiles")
    parser.add_argument("--clear-all", action="store_true", help="Limpiar todos los vencidos")
    parser.add_argument("--clear", type=str, help="Limpiar un perfil especifico")
    args = parser.parse_args()

    if args.clear_all:
        n = clear_all_expired()
        print(f"Limpiados: {n} perfiles")
    elif args.clear:
        clear_profile_expired(args.clear)
        print(f"Perfil restaurado: {args.clear}")
    else:
        expired = get_expired_profiles()
        if not expired:
            print("No hay perfiles vencidos.")
        else:
            print(f"Perfiles vencidos ({len(expired)}):")
            for name, entry in expired.items():
                print(f"  - {name} | {entry.get('date', '?')} | {entry.get('reason', '?')}")
