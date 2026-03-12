"""Notificaciones nativas del sistema (Windows/macOS/Linux) via plyer."""
from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
APP_ICON = PROJECT_ROOT / "utils" / "logoapporange.png"


def notify(title: str, message: str, timeout: int = 8) -> None:
    """Muestra una notificacion nativa del OS."""
    try:
        from plyer import notification

        import sys

        kwargs: dict = {
            "title": title,
            "message": message,
            "timeout": timeout,
            "app_name": "NoyeCode Bot",
        }
        # Windows requiere .ico; macOS/Linux aceptan .png
        if sys.platform == "win32":
            ico_path = APP_ICON.with_suffix(".ico")
            if ico_path.exists():
                kwargs["app_icon"] = str(ico_path)
        elif APP_ICON.exists():
            kwargs["app_icon"] = str(APP_ICON)

        notification.notify(**kwargs)
    except Exception:
        pass


def notify_published() -> None:
    """Notificacion de imagen publicada exitosamente."""
    notify("NoyeCode Bot", "Imagen subida con exito a Facebook")
