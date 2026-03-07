import typer


def log_info(msg: str) -> None:
    typer.echo(typer.style(f"[INFO] {msg}", fg=typer.colors.CYAN))


def log_ok(msg: str) -> None:
    typer.echo(typer.style(f"[OK] {msg}", fg=typer.colors.GREEN, bold=True))


def log_warn(msg: str) -> None:
    typer.echo(typer.style(f"[WARN] {msg}", fg=typer.colors.YELLOW))


def log_error(msg: str) -> None:
    typer.echo(typer.style(f"[ERROR] {msg}", fg=typer.colors.RED, bold=True))


def log_step(step: str, msg: str) -> None:
    label = typer.style(f"[{step}]", fg=typer.colors.BLUE, bold=True)
    typer.echo(f"{label} {msg}")


def log_debug(msg: str) -> None:
    typer.echo(typer.style(f"[DEBUG] {msg}", dim=True))
