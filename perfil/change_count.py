import argparse
import sys
from datetime import datetime


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
    print(f"[{timestamp}] cambiando de cuenta")
    print(f"[INFO] reason={args.reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
