import sys
from contextlib import contextmanager

import typer


def _safe_echo(message: str, *, fg=None, bold: bool = False, dim: bool = False) -> None:
    try:
        typer.echo(typer.style(message, fg=fg, bold=bold, dim=dim))
    except UnicodeEncodeError:
        sanitized = (
            message.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
            .decode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
        )
        typer.echo(typer.style(sanitized, fg=fg, bold=bold, dim=dim))


def log_info(msg: str) -> None:
    _safe_echo(f"[INFO] {msg}", fg=typer.colors.CYAN)


def log_ok(msg: str) -> None:
    _safe_echo(f"[OK] {msg}", fg=typer.colors.GREEN, bold=True)


def log_warn(msg: str) -> None:
    _safe_echo(f"[WARN] {msg}", fg=typer.colors.YELLOW)


def log_error(msg: str) -> None:
    _safe_echo(f"[ERROR] {msg}", fg=typer.colors.RED, bold=True)


def log_step(step: str, msg: str) -> None:
    label = typer.style(f"[{step}]", fg=typer.colors.BLUE, bold=True)
    try:
        typer.echo(f"{label} {msg}")
    except UnicodeEncodeError:
        sanitized = msg.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore").decode(
            getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore"
        )
        typer.echo(f"{label} {sanitized}")


def log_debug(msg: str) -> None:
    _safe_echo(f"[DEBUG] {msg}", dim=True)


@contextmanager
def progress_bar(description: str):
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
