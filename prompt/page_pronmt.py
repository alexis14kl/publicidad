import json
import os
import subprocess
import sys
import time
import hashlib
from pathlib import Path
from urllib.request import urlopen


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
CDP_DEBUG_INFO = Path(os.getenv("APPDATA", "")) / "DICloak" / "cdp_debug_info.json"
DEFAULT_PORT = 9225
PROMPT_LOCK_FILE = PROJECT_ROOT / ".prompt_last_send.json"
PROMPT_DEDUP_WINDOW_SEC = 90


def read_prompt() -> str:
    if not PROMPT_FILE.exists():
        raise FileNotFoundError(f"No existe {PROMPT_FILE}")
    text = PROMPT_FILE.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("prontm.txt esta vacio")
    return text


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()


def should_skip_duplicate(prompt: str) -> bool:
    if not PROMPT_LOCK_FILE.exists():
        return False
    try:
        data = json.loads(PROMPT_LOCK_FILE.read_text(encoding="utf-8"))
        last_hash = str(data.get("prompt_hash", ""))
        last_ts = float(data.get("ts", 0) or 0)
        if not last_hash or not last_ts:
            return False
        if _prompt_hash(prompt) != last_hash:
            return False
        return (time.time() - last_ts) <= PROMPT_DEDUP_WINDOW_SEC
    except Exception:
        return False


def mark_prompt_sent(prompt: str) -> None:
    payload = {"prompt_hash": _prompt_hash(prompt), "ts": time.time()}
    PROMPT_LOCK_FILE.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def is_cdp_alive(port: int) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            return "webSocketDebuggerUrl" in body
    except Exception:
        return False


def get_port_from_debug_info() -> int:
    if not CDP_DEBUG_INFO.exists():
        return 0
    try:
        raw = CDP_DEBUG_INFO.read_text(encoding="utf-8", errors="ignore").strip()
        if not raw:
            return 0
        data = json.loads(raw)
        if isinstance(data, dict):
            for value in data.values():
                if isinstance(value, dict):
                    port = int(value.get("debugPort", 0) or 0)
                    if 0 < port <= 65535:
                        return port
    except Exception:
        return 0
    return 0


def resolve_cdp_port() -> int:
    env_port = os.getenv("CDP_PROFILE_PORT", "").strip()
    if env_port.isdigit():
        p = int(env_port)
        if is_cdp_alive(p):
            return p

    p = get_port_from_debug_info()
    if p and is_cdp_alive(p):
        return p

    if is_cdp_alive(DEFAULT_PORT):
        return DEFAULT_PORT

    raise RuntimeError("No hay puerto CDP activo para el perfil")


def run_prompt_paste(cdp_port: int) -> None:
    js = r"""
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const cdpPort = Number(process.argv[1]);
  const promptPath = process.argv[2];
  const prompt = fs.readFileSync(promptPath, 'utf8').trim();
  if (!prompt) throw new Error('Prompt vacio');

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('No hay contexto CDP');

    const debugUrl = `http://127.0.0.1:${cdpPort}/json/version`;
    const isChatPage = (u) => /^https:\/\/chatgpt\.com\//i.test(u || '');
    const isDebugPage = (u) => {
      const x = (u || '').toLowerCase();
      return x.startsWith(`http://127.0.0.1:${cdpPort}/json`);
    };

    let page = context.pages().find(p => /^https:\/\/chatgpt\.com\//i.test(p.url()));
    if (!page) {
      page = await context.newPage();
    }

    await page.bringToFront();
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const selectors = [
      '#prompt-textarea',
      'div#prompt-textarea[contenteditable="true"]',
      'textarea[placeholder*="Pregunta"]',
      'textarea[placeholder*="Message"]',
      'textarea[data-testid="prompt-textarea"]'
    ];

    let target = null;
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        target = loc;
        break;
      }
    }

    if (!target) throw new Error('No se encontro input de prompt');

    await target.click({ timeout: 5000 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type(prompt, { delay: 10 });
    await page.keyboard.press('Enter');

    // Asegura una pestana de debug visible y limpia el resto.
    let debugPage = context.pages().find(p => isDebugPage(p.url()));
    if (!debugPage) {
      debugPage = await context.newPage();
      await debugPage.goto(debugUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await debugPage.bringToFront();
      await debugPage.goto(debugUrl, { waitUntil: 'domcontentloaded' });
    }

    const allPages = context.pages();
    for (const p of allPages) {
      if (p === page || p === debugPage) continue;
      const u = p.url();
      if (isChatPage(u) || isDebugPage(u) || !u || u === 'about:blank') {
        await p.close({ runBeforeUnload: false }).catch(() => {});
      } else {
        await p.close({ runBeforeUnload: false }).catch(() => {});
      }
    }

    await page.bringToFront();

    console.log('PROMPT_PEGADO_OK');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error('PROMPT_PEGADO_ERROR:' + (err?.message || err));
  process.exit(1);
});
"""

    result = subprocess.run(
        ["node", "-e", js, str(cdp_port), str(PROMPT_FILE)],
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())

    if result.returncode != 0 or "PROMPT_PEGADO_OK" not in result.stdout:
        raise RuntimeError("No se pudo pegar el prompt en ChatGPT")


def main() -> int:
    try:
        prompt = read_prompt()
        if should_skip_duplicate(prompt):
            print("PROMPT_DUPLICADO_RECIENTE_OMITIDO")
            print("promnt pegado con exito")
            return 0
        cdp_port = resolve_cdp_port()
        run_prompt_paste(cdp_port)
        mark_prompt_sent(prompt)
        print("promnt pegado con exito")
        return 0
    except Exception as e:
        print(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
