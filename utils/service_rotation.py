import json
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = PROJECT_ROOT / ".service_rotation_state.json"
SERVICE_SEQUENCE = [
    "desarrollo a la medida",
    "automatizaciones empresariales",
    "modernizacion de software legacy",
    "rpas nativos",
    "desarrollo android",
    "desarrollo desktop",
]


def load_rotation_state(state_file: Path = STATE_FILE) -> dict:
    if not state_file.exists():
        return {}
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def save_rotation_state(state: dict, state_file: Path = STATE_FILE) -> None:
    payload = dict(state)
    payload["updated_at"] = int(time.time())
    state_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def rotate_service(state_file: Path = STATE_FILE) -> str:
    state = load_rotation_state(state_file)
    last_service = str(state.get("last_service", "")).strip().lower()

    if last_service in SERVICE_SEQUENCE:
        next_index = (SERVICE_SEQUENCE.index(last_service) + 1) % len(SERVICE_SEQUENCE)
    else:
        next_index = 0

    selected = SERVICE_SEQUENCE[next_index]
    save_rotation_state({"last_service": selected}, state_file=state_file)
    return selected
