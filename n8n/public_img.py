import argparse
import base64
import io
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IMG_PUBLICITARIAS_DIR = PROJECT_ROOT / "img_publicitarias"
DEFAULT_PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
DEFAULT_POST_TEXT_FILE = PROJECT_ROOT / "utils" / "post_text.txt"
DEFAULT_TIMEOUT_SEC = 60
DEFAULT_WEBHOOK_URL = "https://n8n-dev.noyecode.com/webhook/publicar-img-local-fb"
FREEIMAGE_UPLOAD_URL = "https://freeimage.host/api/1/upload"
FREEIMAGE_API_KEY = "6d207e02198a847aa98d0a2a901485a5"
DEFAULT_BRAND_LOGO_PATH = IMG_PUBLICITARIAS_DIR / "Black and White Illustrated Letter M Initial Logo.png"


class PublicImageError(RuntimeError):
    pass


def find_latest_image(image_dir: Path) -> Path:
    if not image_dir.exists():
        raise PublicImageError(f"No existe el directorio de imagenes: {image_dir}")

    candidates = [
        path
        for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        and not path.stem.endswith("_logo")
    ]
    if not candidates:
        raise PublicImageError(f"No hay imagenes publicitarias en {image_dir}")

    return max(candidates, key=lambda path: path.stat().st_mtime)


def read_text_if_exists(path: Optional[Path]) -> str:
    if path is None or not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore").strip()


def infer_generated_at(image_path: Path) -> str:
    match = re.match(r"(?P<date>\d{8})_(?P<time>\d{6})_", image_path.name)
    if not match:
        return datetime.fromtimestamp(image_path.stat().st_mtime).isoformat(timespec="seconds")

    raw_value = f"{match.group('date')}_{match.group('time')}"
    try:
        dt = datetime.strptime(raw_value, "%Y%m%d_%H%M%S")
        return dt.isoformat(timespec="seconds")
    except ValueError:
        return datetime.fromtimestamp(image_path.stat().st_mtime).isoformat(timespec="seconds")


def infer_asset_id(image_path: Path) -> str:
    match = re.match(r"\d{8}_\d{6}_(?P<asset>.+?)\.[^.]+$", image_path.name)
    if match:
        return match.group("asset")
    return image_path.stem


def build_metadata(
    image_path: Path,
    category: str,
    post_text: str,
    prompt_text: str,
    image_base64: Optional[str] = None,
) -> dict[str, str]:
    if not image_base64:
        image_base64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "source": "chatgpt_local_bot",
        "filename": image_path.name,
        "asset_id": infer_asset_id(image_path),
        "generated_at": infer_generated_at(image_path),
        "category": category.strip(),
        "post_text": post_text.strip(),
        "prompt_text": prompt_text.strip(),
        "imageBase64": image_base64,
    }


def add_brand_logo_overlay(
    image_path: Path,
    logo_path: Path,
) -> str:
    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover
        raise PublicImageError("Pillow no esta disponible para insertar el logo de marca") from exc

    if not logo_path.exists():
        raise PublicImageError(f"No existe el logo configurado: {logo_path}")

    with Image.open(image_path).convert("RGBA") as base_img, Image.open(logo_path).convert("RGBA") as logo_img:
        # Convierte fondo negro/gris muy oscuro del logo en transparencia.
        px = logo_img.load()
        for yy in range(logo_img.height):
            for xx in range(logo_img.width):
                r, g, b, a = px[xx, yy]
                if a == 0:
                    continue
                if r < 30 and g < 30 and b < 30:
                    px[xx, yy] = (r, g, b, 0)

        # Recorta al contenido real para evitar "cuadro negro" residual.
        alpha = logo_img.split()[-1]
        bbox = alpha.getbbox()
        if bbox:
            logo_img = logo_img.crop(bbox)

        target_logo_width = max(1, int(base_img.width * 0.34))
        scale = target_logo_width / max(1, logo_img.width)
        target_logo_height = max(1, int(logo_img.height * scale))
        logo_resized = logo_img.resize((target_logo_width, target_logo_height), Image.LANCZOS)

        x = (base_img.width - target_logo_width) // 2
        y = max(0, int(base_img.height * 0.005))
        base_img.alpha_composite(logo_resized, (x, y))

        output = io.BytesIO()
        base_img.save(output, format="PNG", optimize=True)
        return base64.b64encode(output.getvalue()).decode("ascii")


def upload_to_freeimage(image_base64: str, timeout_sec: int) -> str:
    payload = urlencode(
        {
            "key": FREEIMAGE_API_KEY,
            "source": image_base64,
            "format": "json",
        }
    ).encode("utf-8")
    req = Request(
        FREEIMAGE_UPLOAD_URL,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "publicidad-public-img/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise PublicImageError(f"freeimage devolvio HTTP {exc.code}: {body[:400]}") from exc
    except URLError as exc:
        raise PublicImageError(f"No se pudo conectar con freeimage: {exc}") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PublicImageError(f"freeimage no devolvio JSON valido: {raw[:400]}") from exc

    image_url = str(data.get("image", {}).get("url", "")).strip()
    if not image_url:
        raise PublicImageError(f"freeimage no devolvio image.url: {raw[:400]}")
    return image_url


def post_image_to_n8n(
    webhook_url: str,
    metadata: dict[str, str],
    timeout_sec: int,
) -> dict:
    body = json.dumps(metadata, ensure_ascii=False).encode("utf-8")
    req = Request(
        webhook_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "publicidad-public-img/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
            if not raw:
                return {"status": "ok", "http_status": resp.status, "body": ""}
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = {"status": "ok", "http_status": resp.status, "body": raw}
            if isinstance(data, dict):
                data.setdefault("http_status", resp.status)
            return data
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise PublicImageError(f"n8n devolvio HTTP {exc.code}: {body[:400]}") from exc
    except URLError as exc:
        raise PublicImageError(f"No se pudo conectar con n8n: {exc}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Envia una imagen publicitaria local a un webhook de n8n como binario real."
    )
    parser.add_argument(
        "--webhook-url",
        default=DEFAULT_WEBHOOK_URL,
        help="Webhook de n8n que recibira la imagen. Si no se indica y no hay dry-run, falla.",
    )
    parser.add_argument(
        "--image-path",
        help="Ruta de imagen a enviar. Si no se indica, toma la ultima de img_publicitarias.",
    )
    parser.add_argument(
        "--category",
        default="",
        help="Categoria del contenido publicitario.",
    )
    parser.add_argument(
        "--post-text",
        default="",
        help="Texto/caption final de la publicacion.",
    )
    parser.add_argument(
        "--post-text-file",
        default=str(DEFAULT_POST_TEXT_FILE),
        help="Archivo de texto para el caption. Tiene prioridad si no se pasa --post-text.",
    )
    parser.add_argument(
        "--prompt-file",
        default=str(DEFAULT_PROMPT_FILE),
        help="Archivo desde donde leer el prompt visual usado para generar la imagen.",
    )
    parser.add_argument(
        "--brand-logo-path",
        default=str(DEFAULT_BRAND_LOGO_PATH),
        help="Ruta del logo oficial a superponer en la parte superior antes de publicar.",
    )
    parser.add_argument(
        "--skip-brand-logo",
        action="store_true",
        help="No superpone el logo oficial local.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help="Timeout en segundos para el POST a n8n.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No envia nada; solo muestra el payload que se prepararia.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    image_path = Path(args.image_path).expanduser().resolve() if args.image_path else find_latest_image(IMG_PUBLICITARIAS_DIR)
    if not image_path.exists():
        raise PublicImageError(f"No existe la imagen indicada: {image_path}")

    post_text = args.post_text.strip()
    if not post_text and args.post_text_file:
        post_text = read_text_if_exists(Path(args.post_text_file).expanduser().resolve())

    prompt_text = read_text_if_exists(Path(args.prompt_file).expanduser().resolve()) if args.prompt_file else ""
    logo_path = Path(args.brand_logo_path).expanduser().resolve() if args.brand_logo_path else DEFAULT_BRAND_LOGO_PATH
    image_base64 = None
    if not args.skip_brand_logo:
        image_base64 = add_brand_logo_overlay(image_path=image_path, logo_path=logo_path)

    metadata = build_metadata(
        image_path=image_path,
        category=args.category,
        post_text=post_text,
        prompt_text=prompt_text,
        image_base64=image_base64,
    )
    metadata["image_url"] = upload_to_freeimage(metadata["imageBase64"], args.timeout)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "webhook_url": args.webhook_url or "",
                    "image_path": str(image_path),
                    "image_size_bytes": image_path.stat().st_size,
                    "metadata": metadata,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    webhook_url = (args.webhook_url or "").strip()
    if not webhook_url:
        raise PublicImageError("Debes indicar --webhook-url para enviar la imagen a n8n")

    response = post_image_to_n8n(
        webhook_url=webhook_url,
        metadata=metadata,
        timeout_sec=args.timeout,
    )
    print(f"PUBLIC_IMG_SENT={image_path}")
    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
