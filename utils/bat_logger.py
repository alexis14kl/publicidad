import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_ok, log_warn, log_error, log_step, log_debug  # noqa: E402

LEVEL_MAP = {
    "info": log_info,
    "ok": log_ok,
    "warn": log_warn,
    "error": log_error,
    "debug": log_debug,
}


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        log_error("Uso: bat_logger.py <level> <mensaje>  |  bat_logger.py step <N/M> <mensaje>")
        return 1

    level = args[0].lower()

    if level == "step" and len(args) >= 3:
        log_step(args[1], " ".join(args[2:]))
        return 0

    fn = LEVEL_MAP.get(level)
    if not fn:
        log_error(f"Nivel desconocido: {level}. Validos: {', '.join(LEVEL_MAP.keys())}, step")
        return 1

    fn(" ".join(args[1:]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
