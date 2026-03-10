import json
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = PROJECT_ROOT / ".account_rotation_state.json"
STATE_TTL_SEC = 4 * 60 * 60


@dataclass
class AccountSwitchResult:
    switched: bool
    available_count: int
    selected_account_id: str = ""
    selected_account_label: str = ""
    reason: str = ""


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {"accounts": {}}

    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"accounts": {}}

    if not isinstance(data, dict):
        return {"accounts": {}}
    data.setdefault("accounts", {})
    if not isinstance(data["accounts"], dict):
        data["accounts"] = {}
    return data


def _save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _state_key(cdp_port: int) -> str:
    return f"chatgpt:{cdp_port}"


def _cleanup_expired_entries(state: dict) -> dict:
    now = time.time()
    accounts = state.get("accounts", {})
    cleaned = {}
    for key, value in accounts.items():
        if not isinstance(value, dict):
            continue
        ts = float(value.get("ts", 0) or 0)
        if ts and (now - ts) <= STATE_TTL_SEC:
            cleaned[key] = value
    state["accounts"] = cleaned
    return state


def get_exhausted_account_ids(cdp_port: int) -> set[str]:
    state = _cleanup_expired_entries(_load_state())
    _save_state(state)
    prefix = _state_key(cdp_port) + ":"
    return {key[len(prefix):] for key in state["accounts"].keys() if key.startswith(prefix)}


def mark_account_exhausted(cdp_port: int, account_id: str, account_label: str) -> None:
    if not account_id:
        return
    state = _cleanup_expired_entries(_load_state())
    state["accounts"][_state_key(cdp_port) + ":" + account_id] = {
        "label": account_label,
        "ts": time.time(),
    }
    _save_state(state)


def clear_account_exhausted(cdp_port: int, account_id: str) -> None:
    if not account_id:
        return
    state = _cleanup_expired_entries(_load_state())
    state["accounts"].pop(_state_key(cdp_port) + ":" + account_id, None)
    _save_state(state)


def switch_to_next_available_account(cdp_port: int) -> AccountSwitchResult:
    exhausted_ids = sorted(get_exhausted_account_ids(cdp_port))

    js = r"""
const { chromium } = require('playwright');

(async () => {
  const cdpPort = Number(process.argv[1]);
  const exhaustedIds = JSON.parse(process.argv[2] || '[]');

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('No hay contexto CDP');

    const isChatPage = (u) => /^https:\/\/chatgpt\.com\//i.test(u || '');
    const pages = context.pages().filter((p) => isChatPage(p.url()));
    let page = pages[pages.length - 1];
    if (!page) {
      page = await context.newPage();
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    }

    await page.bringToFront();

    const normalize = (value) =>
      String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokenizeMeaningful = (value) =>
      normalize(value)
        .split(' ')
        .filter(Boolean)
        .filter((token) => !['chatgpt', 'pro', 'plus', 'team', 'enterprise', 'business', 'cuenta', 'pd'].includes(token));

    const ensureProfileMenuOpen = async () => {
      let menuVisible = await page.locator('[role="menu"]').isVisible().catch(() => false);
      if (menuVisible) return true;

      const profileButton = page
        .locator('[data-testid="accounts-profile-button"]')
        .last();

      const visible = await profileButton.isVisible().catch(() => false);
      if (!visible) return false;

      await profileButton.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await profileButton.click({ timeout: 5000 });
      } catch {
        const handle = await profileButton.elementHandle();
        if (handle) {
          await page.evaluate((el) => el.click(), handle);
        }
      }

      await page.waitForFunction(() => !!document.querySelector('[role="menu"]'), { timeout: 10000 });
      return true;
    };

    const menuOpened = await ensureProfileMenuOpen();
    if (!menuOpened) {
      console.log(JSON.stringify({ switched: false, availableCount: 0, reason: 'profile_menu_not_found' }));
      return;
    }

    const info = await page.evaluate((excludedIds) => {
      const normalize = (value) =>
        String(value || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const tokenizeMeaningful = (value) =>
        normalize(value)
          .split(' ')
          .filter(Boolean)
          .filter((token) => !['chatgpt', 'pro', 'plus', 'team', 'enterprise', 'business', 'cuenta', 'pd'].includes(token));

      const profileButtons = Array.from(document.querySelectorAll('[data-testid="accounts-profile-button"]'));
      const currentProfileText = (profileButtons[profileButtons.length - 1]?.innerText || '').trim();
      const currentTokens = tokenizeMeaningful(currentProfileText);

      const items = Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((el, index) => {
        const text = (el.innerText || '').trim();
        const normalized = normalize(text);
        const textTokens = tokenizeMeaningful(text);

        // Detectar cuenta activa por multiples señales
        const ariaChecked = el.getAttribute('aria-checked') === 'true';
        const dataChecked = el.getAttribute('data-state') === 'checked';
        // ChatGPT 2025+: item activo NO tiene gap-1.5 en su class y tiene icono checkmark (.trailing svg.icon-sm)
        const noGapClass = !el.className.includes('gap-1.5');
        const hasCheckmark = el.querySelector('.trailing svg.icon-sm') !== null;
        // Fallback: tokens del perfil actual coinciden con tokens del item
        const tokenMatch = currentTokens.length > 0 && textTokens.length > 0 &&
          (textTokens.every((t) => currentTokens.includes(t)) || currentTokens.every((t) => textTokens.includes(t)));

        const looksCurrent = ariaChecked || dataChecked || (noGapClass && hasCheckmark) || tokenMatch;

        return {
          index,
          accountId: `slot:${index}|label:${normalized || 'sin_texto'}`,
          label: text,
          looksCurrent,
          excluded: false,
        };
      });

      for (const item of items) {
        if (excludedIds.includes(item.accountId)) {
          item.excluded = true;
        }
      }

      const available = items.filter((item) => !item.looksCurrent);
      const candidates = available.filter((item) => !item.excluded);

      return {
        currentProfileText,
        items,
        available,
        candidates,
      };
    }, exhaustedIds);

    console.error('[ROTATION] Cuentas totales: ' + info.items.length +
      ', disponibles (no actual): ' + info.available.length +
      ', candidatas (no agotadas): ' + info.candidates.length);

    if (!info.candidates.length) {
      console.error('[ROTATION] Sin candidatas. Items: ' + JSON.stringify(info.items.map(i => ({
        label: i.label, current: i.looksCurrent, excluded: i.excluded
      }))));
      console.log(JSON.stringify({
        switched: false,
        availableCount: info.available.length,
        reason: 'no_available_accounts',
      }));
      return;
    }

    const chosen = info.candidates[0];
    const chosenLocator = page.locator('[role="menuitemradio"]').nth(chosen.index);
    await chosenLocator.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await chosenLocator.click({ timeout: 5000 });
    } catch {
      const handle = await chosenLocator.elementHandle();
      if (!handle) throw new Error('No se pudo resolver la cuenta a seleccionar');
      await page.evaluate((el) => el.click(), handle);
    }

    console.error('[ROTATION] Click en cuenta: ' + chosen.label);

    // Esperar a que la pagina recargue tras el cambio de cuenta
    await page.waitForTimeout(3000);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    console.error('[ROTATION] Pagina recargada, navegando a chat limpio...');

    // Navegar a chat limpio (si ya estamos en chatgpt.com, usar evaluate para evitar conflicto de navegacion)
    try {
      await page.evaluate(() => { window.location.href = 'https://chatgpt.com/'; });
      await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
    } catch {
      console.error('[ROTATION] Navegacion por evaluate fallo, intentando goto...');
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }

    // Esperar a que el composer este listo
    await page.waitForFunction(() => {
      const editor = document.querySelector('#prompt-textarea[contenteditable="true"]');
      return editor && editor.offsetParent !== null;
    }, { timeout: 15000 }).catch(() => {
      console.error('[ROTATION] Composer no listo tras navegacion, continuando...');
    });
    console.error('[ROTATION] Cuenta cambiada OK: ' + chosen.label);

    console.log(JSON.stringify({
      switched: true,
      availableCount: info.available.length,
      candidateCount: info.candidates.length,
      selectedAccountId: chosen.accountId,
      selectedAccountLabel: chosen.label,
      reason: 'account_switched',
    }));
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
"""

    result = subprocess.run(
        ["node", "-e", js, str(cdp_port), json.dumps(exhausted_ids)],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    stdout = result.stdout.strip()
    if result.stderr.strip():
        print(result.stderr.strip())

    if result.returncode != 0:
        raise RuntimeError("No se pudo cambiar a la siguiente cuenta disponible")
    if not stdout:
        raise RuntimeError("La rotacion de cuentas no devolvio salida")

    try:
        payload = json.loads(stdout.splitlines()[-1])
    except Exception as exc:
        raise RuntimeError(f"Salida inesperada de rotacion de cuentas: {stdout}") from exc

    return AccountSwitchResult(
        switched=bool(payload.get("switched")),
        available_count=int(payload.get("availableCount", 0) or 0),
        selected_account_id=str(payload.get("selectedAccountId", "") or ""),
        selected_account_label=str(payload.get("selectedAccountLabel", "") or ""),
        reason=str(payload.get("reason", "") or ""),
    )


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9225
    result = switch_to_next_available_account(port)
    print(json.dumps(result.__dict__, ensure_ascii=False, indent=2))
