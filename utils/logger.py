import sys
from contextlib import contextmanager

try:
    import typer
except ModuleNotFoundError:
    typer = None
try:
    import typer
except ModuleNotFoundError:
    typer = None


def _is_tty() -> bool:
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


def _safe_echo(message: str, *, fg=None, bold: bool = False, dim: bool = False) -> None:
    if typer is None:
        print(message)
        return
    if typer is None:
        print(message)
        return
    try:
        # Skip ANSI styling when stdout is piped (GUI, file, etc.)
        if _is_tty():
            typer.echo(typer.style(message, fg=fg, bold=bold, dim=dim))
        else:
            print(message, flush=True)
    except UnicodeEncodeError:
        sanitized = (
            message.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
            .decode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore")
        )
        if _is_tty():
            typer.echo(typer.style(sanitized, fg=fg, bold=bold, dim=dim))
        else:
            print(sanitized, flush=True)


def log_info(msg: str) -> None:
    _safe_echo(f"[INFO] {msg}", fg=None if typer is None else typer.colors.CYAN)
    _safe_echo(f"[INFO] {msg}", fg=None if typer is None else typer.colors.CYAN)


def log_ok(msg: str) -> None:
    _safe_echo(f"[OK] {msg}", fg=None if typer is None else typer.colors.GREEN, bold=True)
    _safe_echo(f"[OK] {msg}", fg=None if typer is None else typer.colors.GREEN, bold=True)


def log_warn(msg: str) -> None:
    _safe_echo(f"[WARN] {msg}", fg=None if typer is None else typer.colors.YELLOW)
    _safe_echo(f"[WARN] {msg}", fg=None if typer is None else typer.colors.YELLOW)


def log_error(msg: str) -> None:
    _safe_echo(f"[ERROR] {msg}", fg=None if typer is None else typer.colors.RED, bold=True)
    _safe_echo(f"[ERROR] {msg}", fg=None if typer is None else typer.colors.RED, bold=True)


def log_step(step: str, msg: str) -> None:
<<<<<<< HEAD
    if _is_tty():
        label = typer.style(f"[{step}]", fg=typer.colors.BLUE, bold=True)
        try:
            typer.echo(f"{label} {msg}")
        except UnicodeEncodeError:
            sanitized = msg.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore").decode(
                getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore"
            )
            typer.echo(f"{label} {sanitized}")
    else:
        print(f"[{step}] {msg}", flush=True)
=======
    if typer is None:
        print(f"[{step}] {msg}")
        return
    label = typer.style(f"[{step}]", fg=typer.colors.BLUE, bold=True)
    try:
        typer.echo(f"{label} {msg}")
    except UnicodeEncodeError:
        sanitized = msg.encode(getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore").decode(
            getattr(sys.stdout, "encoding", "cp1252") or "cp1252", errors="ignore"
        )
        typer.echo(f"{label} {sanitized}")
>>>>>>> 657fc92 (funcional Dicloak)


def log_debug(msg: str) -> None:
    _safe_echo(f"[DEBUG] {msg}", dim=True)


@contextmanager
def progress_bar(description: str):
<<<<<<< HEAD
    # Skip rich animations when stdout is piped (e.g. from GUI)
    # Rich spinners/bars produce garbage in non-TTY output
    if not sys.stdout.isatty():
        log_info(description)
        yield
        return

=======
    if typer is None:
        log_info(description)
        yield
        return
>>>>>>> 657fc92 (funcional Dicloak)
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
