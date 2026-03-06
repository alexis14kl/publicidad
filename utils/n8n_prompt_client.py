import argparse
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/py-prompt-imgs"


class N8NPromptError(RuntimeError):
    pass


def _read_json_response(resp: Any) -> dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace").strip()
    if not raw:
        raise N8NPromptError("n8n respondio vacio")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise N8NPromptError(f"n8n no devolvio JSON valido: {raw[:200]}") from exc
    if not isinstance(data, dict):
        raise N8NPromptError("n8n devolvio un JSON inesperado")
    return data


def generate_prompt(
    idea: str,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    timeout: int = 60,
) -> str:
    idea = idea.strip()
    if not idea:
        raise ValueError("La idea base no puede estar vacia")

    payload = json.dumps({"text": idea}, ensure_ascii=False).encode("utf-8")
    req = Request(
        webhook_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "publicidad-n8n-client/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=timeout) as resp:
            data = _read_json_response(resp)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise N8NPromptError(f"n8n devolvio HTTP {exc.code}: {body[:300]}") from exc
    except URLError as exc:
        raise N8NPromptError(f"No se pudo conectar con n8n: {exc}") from exc

    prompt = str(data.get("output", "")).strip()
    if not prompt:
        raise N8NPromptError(f"n8n no devolvio el campo output: {json.dumps(data, ensure_ascii=False)}")
    return prompt


def save_prompt(prompt: str, path: Path = DEFAULT_PROMPT_FILE) -> Path:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("El prompt generado esta vacio")
    path.write_text(prompt + "\n", encoding="utf-8")
    return path


def generate_and_save(
    idea: str,
    output_path: Path = DEFAULT_PROMPT_FILE,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    timeout: int = 60,
) -> str:
    prompt = generate_prompt(idea=idea, webhook_url=webhook_url, timeout=timeout)
    save_prompt(prompt, path=output_path)
    return prompt


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera un prompt usando n8n y opcionalmente lo guarda en utils/prontm.txt",
    )
    parser.add_argument(
        "idea",
        nargs="?",
        help="Idea base para que la IA la convierta en prompt completo",
    )
    parser.add_argument(
        "--idea-file",
        help="Archivo de texto cuyo contenido se usa como idea base",
    )
    parser.add_argument(
        "--webhook-url",
        default=DEFAULT_WEBHOOK_URL,
        help=f"Webhook de n8n. Default: {DEFAULT_WEBHOOK_URL}",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_PROMPT_FILE),
        help=f"Archivo destino. Default: {DEFAULT_PROMPT_FILE}",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Timeout en segundos para la llamada HTTP",
    )
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="Solo imprime el prompt generado y no lo guarda en archivo",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        idea = args.idea
        if args.idea_file:
            idea = Path(args.idea_file).read_text(encoding="utf-8").strip()
        if not idea:
            raise ValueError("Debes enviar una idea o usar --idea-file")

        if args.stdout_only:
            prompt = generate_prompt(
                idea=idea,
                webhook_url=args.webhook_url,
                timeout=args.timeout,
            )
            print(prompt)
            return 0

        output_path = Path(args.output)
        prompt = generate_and_save(
            idea=idea,
            output_path=output_path,
            webhook_url=args.webhook_url,
            timeout=args.timeout,
        )
        print(prompt)
        print(f"PROMPT_GUARDADO={output_path}")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
