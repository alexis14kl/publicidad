"""
Preflight checks — verifica dependencias del sistema antes de iniciar el bot.

Uso desde Python:
    from cfg.preflight import run_preflight
    ok, report = run_preflight()
    if not ok:
        print(report)
        sys.exit(1)

Uso desde CLI:
    python -m cfg.preflight          # texto plano
    python -m cfg.preflight --json   # salida JSON (para la GUI)
"""
from __future__ import annotations

import importlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Requisitos
# ---------------------------------------------------------------------------
PYTHON_MIN = (3, 10)

NODE_MIN = (18, 0)

PIP_PACKAGES: list[dict[str, str]] = [
    {"name": "playwright",    "import": "playwright",    "min": "1.58"},
    {"name": "typer",         "import": "typer",         "min": "0.24"},
    {"name": "rich",          "import": "rich",          "min": "14.0"},
    {"name": "colorama",      "import": "colorama",      "min": "0.4.6"},
    {"name": "python-dotenv", "import": "dotenv",        "min": "1.0"},
    {"name": "Pillow",        "import": "PIL",           "min": "11.0"},
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_version(v: str) -> tuple[int, ...]:
    """'3.10.4' → (3, 10, 4)"""
    parts: list[int] = []
    for p in v.split("."):
        digits = "".join(c for c in p if c.isdigit())
        if digits:
            parts.append(int(digits))
    return tuple(parts) if parts else (0,)


def _version_gte(current: tuple[int, ...], minimum: tuple[int, ...]) -> bool:
    for c, m in zip(current, minimum):
        if c > m:
            return True
        if c < m:
            return False
    return len(current) >= len(minimum)


def _get_pkg_version(import_name: str) -> str | None:
    """Try to get the installed version of a package."""
    try:
        mod = importlib.import_module(import_name)
        for attr in ("__version__", "VERSION", "version"):
            v = getattr(mod, attr, None)
            if v and isinstance(v, str):
                return v
        # Fallback: importlib.metadata
        import importlib.metadata as meta
        # Map import name → distribution name
        dist_name = import_name.replace("PIL", "Pillow").replace("dotenv", "python-dotenv")
        return meta.version(dist_name)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def check_python() -> dict[str, Any]:
    v = sys.version_info
    current = f"{v.major}.{v.minor}.{v.micro}"
    ok = _version_gte((v.major, v.minor), PYTHON_MIN)
    return {
        "name": "Python",
        "required": f">= {PYTHON_MIN[0]}.{PYTHON_MIN[1]}",
        "current": current,
        "ok": ok,
        "fix": f"Instala Python {PYTHON_MIN[0]}.{PYTHON_MIN[1]}+ desde https://python.org" if not ok else None,
    }


def check_node() -> dict[str, Any]:
    node = shutil.which("node")
    if not node and sys.platform == "darwin":
        for candidate in ("/usr/local/bin/node", "/opt/homebrew/bin/node"):
            if os.path.exists(candidate):
                node = candidate
                break
    if not node:
        return {
            "name": "Node.js",
            "required": f">= {NODE_MIN[0]}.{NODE_MIN[1]}",
            "current": None,
            "ok": False,
            "fix": f"Instala Node.js {NODE_MIN[0]}+ desde https://nodejs.org",
        }
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=10)
        raw = out.stdout.strip().lstrip("v")
        parsed = _parse_version(raw)
        ok = _version_gte(parsed, NODE_MIN)
        return {
            "name": "Node.js",
            "required": f">= {NODE_MIN[0]}.{NODE_MIN[1]}",
            "current": raw,
            "ok": ok,
            "fix": f"Actualiza Node.js a {NODE_MIN[0]}+ desde https://nodejs.org" if not ok else None,
        }
    except Exception:
        return {
            "name": "Node.js",
            "required": f">= {NODE_MIN[0]}.{NODE_MIN[1]}",
            "current": "error",
            "ok": False,
            "fix": f"Instala Node.js {NODE_MIN[0]}+ desde https://nodejs.org",
        }


def check_node_playwright() -> dict[str, Any]:
    """Check if the Node.js Playwright dependency is resolvable."""
    node = shutil.which("node")
    if not node and sys.platform == "darwin":
        for candidate in ("/usr/local/bin/node", "/opt/homebrew/bin/node"):
            if os.path.exists(candidate):
                node = candidate
                break

    if not node:
        return {
            "name": "Playwright (Node.js)",
            "required": ">= 1.58",
            "current": None,
            "ok": False,
            "fix": "Instala Node.js primero (luego ejecuta: npm install)",
        }

    try:
        script = (
            "try{"
            "const v=require('playwright/package.json').version;"
            "console.log(v);"
            "}catch(e){process.exit(1)}"
        )
        out = subprocess.run(
            [node, "-e", script],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=12,
        )
        version = (out.stdout or "").strip() or None
        ok = out.returncode == 0
        return {
            "name": "Playwright (Node.js)",
            "required": ">= 1.58",
            "current": version if ok else None,
            "ok": ok,
            "fix": "npm install" if not ok else None,
        }
    except Exception:
        return {
            "name": "Playwright (Node.js)",
            "required": ">= 1.58",
            "current": None,
            "ok": False,
            "fix": "npm install",
        }


def check_pip_packages() -> list[dict[str, Any]]:
    results = []
    for pkg in PIP_PACKAGES:
        try:
            importlib.import_module(pkg["import"])
            current = _get_pkg_version(pkg["import"]) or "instalado"
            parsed_current = _parse_version(current) if current != "instalado" else (999,)
            parsed_min = _parse_version(pkg["min"])
            ok = _version_gte(parsed_current, parsed_min)
            results.append({
                "name": pkg["name"],
                "required": f">= {pkg['min']}",
                "current": current,
                "ok": ok,
                "fix": f"pip install \"{pkg['name']}>={pkg['min']}\"" if not ok else None,
            })
        except ImportError:
            results.append({
                "name": pkg["name"],
                "required": f">= {pkg['min']}",
                "current": None,
                "ok": False,
                "fix": f"pip install \"{pkg['name']}>={pkg['min']}\"",
            })
    return results


def check_playwright_browsers() -> dict[str, Any]:
    """Check if Playwright Chromium browser is installed."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            # Just check the executable path exists
            browser_path = p.chromium.executable_path
            ok = Path(browser_path).exists() if browser_path else False
        return {
            "name": "Playwright Chromium",
            "required": "instalado",
            "current": "instalado" if ok else None,
            "ok": ok,
            "fix": "playwright install chromium" if not ok else None,
        }
    except Exception:
        return {
            "name": "Playwright Chromium",
            "required": "instalado",
            "current": None,
            "ok": False,
            "fix": "playwright install chromium",
        }


def check_env_file() -> dict[str, Any]:
    """Check if .env file exists in the project root."""
    project_root = Path(__file__).resolve().parent.parent
    env_path = project_root / ".env"
    ok = env_path.exists()
    return {
        "name": "Archivo .env",
        "required": "presente",
        "current": "encontrado" if ok else None,
        "ok": ok,
        "fix": "Crea el archivo .env en la raiz del proyecto (usa .env.example como base)" if not ok else None,
    }


# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT_FLAG = PROJECT_ROOT / ".preflight_ok"


def _is_already_validated() -> bool:
    """Check if preflight already passed (flag file exists)."""
    return PREFLIGHT_FLAG.exists()


def _save_flag(results: list[dict[str, Any]]) -> None:
    """Save a flag file indicating preflight passed."""
    import platform as plat
    summary = {
        "validated_at": __import__("datetime").datetime.now().isoformat(),
        "platform": plat.system(),
        "python": sys.version,
        "checks": {r["name"]: r["current"] for r in results},
    }
    PREFLIGHT_FLAG.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")


def run_preflight(force: bool = False) -> tuple[bool, list[dict[str, Any]]]:
    """Run all preflight checks.

    If the flag file `.preflight_ok` exists and *force* is False, skip
    the checks and return immediately (already validated once).

    Returns (all_ok, results) where results is a list of check dicts.
    """
    # Always run checks. The `.preflight_ok` flag is informational only and
    # can become stale when PATH/dependencies change (common on macOS GUI).

    results: list[dict[str, Any]] = []

    # Python version
    results.append(check_python())

    # Node.js
    results.append(check_node())
    results.append(check_node_playwright())

    # Pip packages
    results.extend(check_pip_packages())

    # Playwright browsers
    results.append(check_playwright_browsers())

    # .env file
    results.append(check_env_file())

    all_ok = all(r["ok"] for r in results)

    # Save flag so next time it skips
    if all_ok:
        _save_flag(results)

    return all_ok, results


def format_report(results: list[dict[str, Any]]) -> str:
    """Format results as human-readable text."""
    lines = ["", "=== Preflight: Verificacion de Dependencias ===", ""]
    for r in results:
        icon = "[OK]" if r["ok"] else "[ERROR]"
        current = r["current"] or "NO ENCONTRADO"
        lines.append(f"  {icon}  {r['name']:<25} {current:<15} (requiere {r['required']})")
        if r.get("fix"):
            lines.append(f"         -> Fix: {r['fix']}")
    lines.append("")

    fails = [r for r in results if not r["ok"]]
    if fails:
        lines.append(f"  {len(fails)} problema(s) encontrado(s). Corrige antes de continuar.")
    else:
        lines.append("  Todas las dependencias OK.")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point: python -m cfg.preflight [--json]
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    use_json = "--json" in sys.argv
    force = "--force" in sys.argv
    all_ok, results = run_preflight(force=force)

    if use_json:
        print(json.dumps({"ok": all_ok, "checks": results}, indent=2, ensure_ascii=False))
    else:
        print(format_report(results))

    sys.exit(0 if all_ok else 1)
