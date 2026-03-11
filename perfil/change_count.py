import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from perfil.profile_memory import (  # noqa: E402
    get_active_profiles,
    mark_profile_expired,
)
from utils.logger import log_info, log_warn  # noqa: E402

IS_MAC = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"

INITIAL_PROFILE = "Chat Gpt PRO"
DEFAULT_TARGET_PROFILE = "Chat Gpt Plus"
FALLBACK_PROFILES = ["Chat Gpt Plus", "Chat Gpt PRO"]
DEFAULT_MAIN_CDP_URL = "http://127.0.0.1:9333"
DEFAULT_PROFILE_CDP_PORT = 9225
DEFAULT_PROFILE_WARMUP_SEC = 20
OPEN_PROFILE_JS = PROJECT_ROOT / "perfil" / "abrir_perfil_dicloak.js"
PROFILE_DISCOVERY_TIMEOUT_MS = 45000

if IS_WINDOWS:
    FORCE_CDP_SCRIPT = PROJECT_ROOT / "cdp" / "forzar_cdp_perfil_dicloak.ps1"
    PS_EXE = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
else:
    FORCE_CDP_SCRIPT = PROJECT_ROOT / "run_mac" / "cdp" / "forzar_cdp_perfil.sh"
    PS_EXE = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cambia al perfil fallback cuando el perfil actual pierde sesion o deja de ser viable."
    )
    parser.add_argument(
        "--reason",
        default="manual",
        help="Motivo del cambio de cuenta. Ejemplo: session_expired",
    )
    parser.add_argument(
        "--target-profile",
        default=DEFAULT_TARGET_PROFILE,
        help="Nombre o fragmento del perfil fallback en DiCloak.",
    )
    parser.add_argument(
        "--preferred-port",
        type=int,
        default=DEFAULT_PROFILE_CDP_PORT,
        help="Puerto CDP preferido para el perfil fallback.",
    )
    parser.add_argument(
        "--warmup-sec",
        type=int,
        default=DEFAULT_PROFILE_WARMUP_SEC,
        help="Segundos de espera para estabilizar la sesion del perfil fallback.",
    )
    parser.add_argument(
        "--close-only",
        action="store_true",
        help="Solo cierra el perfil actual para validar el primer paso del cambio de sesion.",
    )
    return parser.parse_args()


def _wait_for_cdp(port: int, timeout_sec: int = 45) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                if "webSocketDebuggerUrl" in body:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def _resolve_live_cdp_port(preferred_port: int) -> int:
    candidates: list[int] = []
    if preferred_port > 0:
        candidates.append(preferred_port)

    appdata = os.environ.get("APPDATA", "").strip()
    if appdata:
        info_path = Path(appdata) / "DICloak" / "cdp_debug_info.json"
        try:
            if info_path.exists():
                data = json.loads(info_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for value in data.values():
                        if not isinstance(value, dict):
                            continue
                        port = int(value.get("debugPort", 0) or 0)
                        if port > 0 and port not in candidates:
                            candidates.append(port)
        except Exception:
            pass

    for port in [9225, 9226, 9227, 9228, 9229, 9230]:
        if port not in candidates:
            candidates.append(port)

    for port in candidates:
        if _wait_for_cdp(port, timeout_sec=5):
            return port
    return 0


def _run_subprocess(command: list[str], step_name: str) -> None:
    log_info(f"step={step_name}")
    process = subprocess.Popen(
        command,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )
    if process.stdout is not None:
        for line in process.stdout:
            text = line.rstrip()
            if text:
                print(text)
    result_code = process.wait()
    if result_code != 0:
        raise RuntimeError(f"{step_name} fallo con codigo {result_code}")


def close_current_profile() -> None:
    log_info("closing_current_profile=1")
    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/F", "/IM", "ginsbrowser.exe"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    else:
        subprocess.run(
            ["pkill", "-if", "GinsBrowser"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
        )
    time.sleep(2)


def discover_chatgpt_profiles(main_cdp_url: str = DEFAULT_MAIN_CDP_URL) -> list[str]:
    js = r"""
const { chromium } = require('playwright');

(async () => {
  const cdpUrl = process.argv[1];
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('No hay contexto CDP principal');

    let page =
      context.pages().find((p) => (p.url() || '').includes('/environment/envList')) ||
      context.pages()[0];
    if (!page) {
      page = await context.newPage();
    }

    await page.bringToFront();
    await page.evaluate(() => {
      const href = window.location.href || '';
      if (!href.includes('/environment/envList')) {
        window.location.hash = '/environment/envList';
      }
    });

    const deadline = Date.now() + Number(process.argv[2] || 45000);
    while (Date.now() < deadline) {
      const ready = await page.evaluate(() => {
        const rows = document.querySelectorAll('.el-table__row').length;
        const txt = document.body?.innerText || '';
        return rows > 0 || txt.includes('Perfiles');
      }).catch(() => false);
      if (ready) break;
      await page.waitForTimeout(500);
    }

    const profiles = await page.evaluate(() => {
      const normalize = (s) =>
        String(s || '')
          .replace(/\s+/g, ' ')
          .trim();

      const rows = Array.from(document.querySelectorAll('.el-table__row'));
      const names = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td'));
        const rowText = normalize(row.innerText || '');
        if (!rowText) continue;

        let candidate = '';
        for (const cell of cells) {
          const text = normalize(cell.innerText || '');
          if (!text) continue;
          if (/^#?\d+\s+chat\s*gpt/i.test(text) || /chat\s*gpt/i.test(text) || /chatgpt/i.test(text)) {
            candidate = text.split('\n')[0].trim();
            break;
          }
        }
        if (!candidate && (/chat\s*gpt/i.test(rowText) || /chatgpt/i.test(rowText))) {
          candidate = rowText.split('\n')[0].trim();
        }
        if (candidate) names.push(candidate);
      }
      return Array.from(new Set(names));
    });

    console.log(JSON.stringify(profiles));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
"""

    try:
        result = subprocess.run(
            ["node", "-e", js, main_cdp_url, str(PROFILE_DISCOVERY_TIMEOUT_MS)],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
        if result.returncode != 0:
            return []
        raw = (result.stdout or "").strip().splitlines()
        if not raw:
            return []
        data = json.loads(raw[-1])
        if not isinstance(data, list):
            return []
        return [str(item).strip() for item in data if str(item).strip()]
    except Exception:
        return []


def build_fallback_candidates(current_profile: str = "") -> list[str]:
    candidates: list[str] = []
    for profile in FALLBACK_PROFILES + discover_chatgpt_profiles():
        profile = str(profile or "").strip()
        if not profile:
            continue
        if current_profile and profile == current_profile:
            continue
        if profile not in candidates:
            candidates.append(profile)
    return candidates


def switch_to_fallback_profile(target_profile: str, preferred_port: int, warmup_sec: int) -> None:
    if not OPEN_PROFILE_JS.exists():
        raise FileNotFoundError(f"No existe script de apertura de perfil: {OPEN_PROFILE_JS}")
    if not FORCE_CDP_SCRIPT.exists():
        raise FileNotFoundError(f"No existe script de forzado CDP: {FORCE_CDP_SCRIPT}")
    if IS_WINDOWS and (PS_EXE is None or not PS_EXE.exists()):
        raise FileNotFoundError(f"No existe PowerShell esperado en: {PS_EXE}")

    close_current_profile()

    log_info("opening_target_profile=1")
    _run_subprocess(
        ["node", str(OPEN_PROFILE_JS), target_profile, DEFAULT_MAIN_CDP_URL],
        "Apertura de perfil fallback",
    )

    log_info(f"Esperando {warmup_sec}s para hidratar sesion del perfil fallback...")
    time.sleep(max(5, warmup_sec))

    log_info("forcing_fallback_cdp=1")
    if IS_WINDOWS:
        _run_subprocess(
            [
                str(PS_EXE),
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(FORCE_CDP_SCRIPT),
                "-PreferredPort",
                str(preferred_port),
                "-TimeoutSec",
                "45",
            ],
            "Forzado CDP del perfil fallback",
        )
    else:
        _run_subprocess(
            ["bash", str(FORCE_CDP_SCRIPT), str(preferred_port), "45"],
            "Forzado CDP del perfil fallback",
        )

    live_port = _resolve_live_cdp_port(preferred_port)
    if not live_port:
        raise RuntimeError(f"El perfil fallback no expuso CDP util en el puerto {preferred_port}")
    os.environ["CDP_PROFILE_PORT"] = str(live_port)
    log_info(f"fallback_cdp_ready=1 port={live_port}")


def switch_to_any_fallback(
    profiles: list[str] | None = None,
    preferred_port: int = DEFAULT_PROFILE_CDP_PORT,
    warmup_sec: int = DEFAULT_PROFILE_WARMUP_SEC,
    current_profile: str = "",
) -> str:
    if current_profile:
        mark_profile_expired(current_profile, reason="session_expired")
        log_warn(f"Perfil actual marcado como vencido en memoria: '{current_profile}'")

    all_candidates = profiles or build_fallback_candidates(current_profile=current_profile)
    candidates = get_active_profiles(all_candidates)

    if not candidates:
        log_warn(f"No se encuentra perfil para generar la imagen. Todos vencidos: {all_candidates}")
        raise RuntimeError(
            f"No se encuentra perfil disponible para generar la imagen. "
            f"Todos los perfiles estan vencidos: {all_candidates}. "
            f"Limpia la memoria con: python perfil/profile_memory.py --clear-all"
        )

    last_error = None
    for profile in candidates:
        log_info(f"Intentando perfil fallback: {profile}")
        try:
            switch_to_fallback_profile(profile, preferred_port, warmup_sec)
            log_info(f"Perfil fallback activo: {profile}")
            return profile
        except Exception as exc:
            log_warn(f"Perfil '{profile}' fallo: {exc}")
            mark_profile_expired(profile, reason="session_expired")
            last_error = exc

    raise RuntimeError(
        f"Ningun perfil fallback disponible. Intentados: {candidates}. Ultimo error: {last_error}"
    )


def main() -> int:
    args = parse_args()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_warn(f"[{timestamp}] cambiando de cuenta")
    log_info(f"reason={args.reason}")
    log_info(f"target_profile={args.target_profile}")
    if args.close_only:
        close_current_profile()
        log_info("close_only=1")
        log_info("current_profile_closed=1")
        return 0
    try:
        switch_to_fallback_profile(args.target_profile, args.preferred_port, args.warmup_sec)
    except Exception as exc:
        log_warn(f"No se pudo cambiar al perfil fallback: {exc}")
        return 1
    log_info("fallback_profile_switched=1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
