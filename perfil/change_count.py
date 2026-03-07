import argparse
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.logger import log_info, log_warn  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Placeholder para cambio de cuenta/perfil cuando una cuenta se queda sin tokens de imagen."
    )
    parser.add_argument(
        "--reason",
        default="manual",
        help="Motivo del cambio de cuenta. Ejemplo: no_image_tokens",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_warn(f"[{timestamp}] cambiando de cuenta")
    log_info(f"reason={args.reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
