import os
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

import typer

_FILE_LOCK = Lock()


def _append_to_log_file(message: str) -> None:
    """Optionally mirror logs to a file when PUBLICIDAD_LOG_FILE is set.

    This is useful for GUI scenarios where stdout is not visible, but the app
    tails a log file (e.g. Electron log watcher).
    """
    path_raw = (os.getenv("PUBLICIDAD_LOG_FILE") or "").strip()
    if not path_raw:
        return
    try:
        path = Path(path_raw)
        path.parent.mkdir(parents=True, exist_ok=True)
        with _FILE_LOCK:
            with path.open("a", encoding="utf-8") as f:
                f.write(message + "\n")
    except Exception:
        # Never let logging crash the bot.
        return


def _is_tty() -> bool:
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def _safe_echo(message: str, *, fg=None, bold: bool = False, dim: bool = False) -> None:
    try:
        # Skip ANSI styling when stdout is piped (GUI, file, etc.)
        if _is_tty():
            typer.echo(typer.style(message, fg=fg, bold=bold, dim=dim))
        else:
            print(message, flush=True)
        _append_to_log_file(message)
    except UnicodeEncodeError:
        sanitized = (
            message.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
            .decode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
        )
        if _is_tty():
            typer.echo(typer.style(sanitized, fg=fg, bold=bold, dim=dim))
        else:
            print(sanitized, flush=True)
        _append_to_log_file(sanitized)


def log_info(msg: str) -> None:
    _safe_echo(f"[INFO] {msg}", fg=typer.colors.CYAN)


def log_ok(msg: str) -> None:
    _safe_echo(f"[OK] {msg}", fg=typer.colors.GREEN, bold=True)


def log_warn(msg: str) -> None:
    _safe_echo(f"[WARN] {msg}", fg=typer.colors.YELLOW)


def log_error(msg: str) -> None:
    _safe_echo(f"[ERROR] {msg}", fg=typer.colors.RED, bold=True)


def log_step(step: str, msg: str) -> None:
    plain = f"[{step}] {msg}"
    if _is_tty():
        label = typer.style(f"[{step}]", fg=typer.colors.BLUE, bold=True)
        try:
            typer.echo(f"{label} {msg}")
            _append_to_log_file(plain)
        except UnicodeEncodeError:
            sanitized = msg.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore").decode(
                getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore"
            )
            typer.echo(f"{label} {sanitized}")
            _append_to_log_file(f"[{step}] {sanitized}")
    else:
        print(plain, flush=True)
        _append_to_log_file(plain)


def log_debug(msg: str) -> None:
    _safe_echo(f"[DEBUG] {msg}", dim=True)


@contextmanager
def progress_bar(description: str):
    # Skip rich animations when stdout is piped (e.g. from GUI)
    # Rich spinners/bars produce garbage in non-TTY output
    if not sys.stdout.isatty():
        log_info(description)
        yield
        return

    encoding = (getattr(sys.stdout, "encoding", "") or "").lower()
    if "utf" not in encoding:
        log_info(description)
        yield
        return

    from rich.progress import (
        BarColumn,
        Progress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
    )

    with Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}"),
        BarColumn(pulse_style="cyan"),
        TimeElapsedColumn(),
    ) as progress:
        progress.add_task(description, total=None)
        yield
