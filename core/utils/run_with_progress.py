import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

from core.utils.logger import progress_bar


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print("Uso: run_with_progress.py <descripcion> <comando> [args...]", file=sys.stderr)
        return 1

    description = args[0]
    command = args[1:]

    with progress_bar(description):
        result = subprocess.run(command, cwd=str(PROJECT_ROOT))

    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
