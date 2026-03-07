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
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from perfil.account_rotation import (  # noqa: E402
    clear_account_exhausted,
    mark_account_exhausted,
    switch_to_next_available_account,
)

PROMPT_FILE = PROJECT_ROOT / "utils" / "prontm.txt"
CHANGE_COUNT_SCRIPT = PROJECT_ROOT / "perfil" / "change_count.py"
CDP_DEBUG_INFO = Path(os.getenv("APPDATA", "")) / "DICloak" / "cdp_debug_info.json"
DEFAULT_PORT = 9225
PROMPT_LOCK_FILE = PROJECT_ROOT / ".prompt_last_send.json"
PROMPT_DEDUP_WINDOW_SEC = 90
NO_IMAGE_TOKENS_MARKER = "Sin tokens para imgs."
PROMPT_STATUS_SUCCESS = "success"
PROMPT_STATUS_NO_IMAGE_TOKENS = "no_image_tokens"
MAX_ACCOUNT_ROTATION_ATTEMPTS = 20


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


def trigger_change_count(reason: str = "no_image_tokens") -> None:
    if not CHANGE_COUNT_SCRIPT.exists():
        print(f"[WARN] No existe script de cambio de cuenta: {CHANGE_COUNT_SCRIPT}")
        return

    result = subprocess.run(
        [sys.executable, str(CHANGE_COUNT_SCRIPT), "--reason", reason],
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())

    if result.returncode != 0:
        print(f"[WARN] change_count.py termino con codigo {result.returncode}")


def run_prompt_paste(cdp_port: int) -> str:
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

    const getPageSignals = async (targetPage) => {
      try {
        return await targetPage.evaluate(() => {
          const editor = document.querySelector('div#prompt-textarea[contenteditable="true"], #prompt-textarea[contenteditable="true"]');
          const style = editor ? window.getComputedStyle(editor) : null;
          const rect = editor ? editor.getBoundingClientRect() : null;
          return {
            readyState: document.readyState || '',
            visibilityState: document.visibilityState || '',
            hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : false,
            composerReady: !!(
              editor &&
              rect &&
              rect.width > 50 &&
              rect.height > 20 &&
              style &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            ),
          };
        });
      } catch {
        return {
          readyState: '',
          visibilityState: '',
          hasFocus: false,
          composerReady: false,
        };
      }
    };

    const waitForSessionWindowsStable = async (timeoutMs = 45000, settleMs = 4000, pollMs = 500, requireSingleChat = false) => {
      const deadline = Date.now() + timeoutMs;
      let lastSignature = '';
      let stableSince = 0;

      while (Date.now() < deadline) {
        const pages = context.pages().filter(p => !p.isClosed());
        const chatPages = pages.filter(p => isChatPage(p.url()));
        const debugPages = pages.filter(p => isDebugPage(p.url()));

        const chatSignals = [];
        for (const chatPage of chatPages) {
          const signals = await getPageSignals(chatPage);
          chatSignals.push({
            url: chatPage.url() || '',
            readyState: signals.readyState || '',
            visibilityState: signals.visibilityState || '',
            hasFocus: !!signals.hasFocus,
            composerReady: !!signals.composerReady,
          });
        }

        const signature = JSON.stringify({
          chatCount: chatPages.length,
          debugCount: debugPages.length,
          chatSignals,
        });

        const hasReadyChatPage = chatSignals.some((item) => item.composerReady);
        const hasDebugPage = debugPages.length > 0;
        const singleChatCondition = !requireSingleChat || chatPages.length === 1;

        if (signature === lastSignature && hasReadyChatPage && hasDebugPage && singleChatCondition) {
          if (!stableSince) {
            stableSince = Date.now();
          }
          if ((Date.now() - stableSince) >= settleMs) {
            console.log(`SESSION_WINDOWS_READY: chats=${chatPages.length} debug=${debugPages.length}`);
            return true;
          }
        } else {
          lastSignature = signature;
          stableSince = 0;
        }

        await page.waitForTimeout(pollMs);
      }
      return false;
    };

    const ensureSingleChatAndDebugPage = async (preferredPage) => {
      let keepPage = preferredPage || await pickBestChatPage();
      if (!keepPage) {
        keepPage = await context.newPage();
        await keepPage.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
      }

      let debugPage = context.pages().find(p => isDebugPage(p.url()));
      if (!debugPage) {
        debugPage = await context.newPage();
      }

      await debugPage.goto(debugUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

      const pages = context.pages().filter(p => !p.isClosed());
      for (const candidate of pages) {
        if (candidate === keepPage || candidate === debugPage) continue;
        const candidateUrl = candidate.url() || '';
        if (
          isChatPage(candidateUrl) ||
          isDebugPage(candidateUrl) ||
          candidateUrl === 'about:blank' ||
          !candidateUrl
        ) {
          await candidate.close({ runBeforeUnload: false }).catch(() => {});
        }
      }

      await keepPage.bringToFront().catch(() => {});
      await debugPage.bringToFront().catch(() => {});
      await keepPage.bringToFront().catch(() => {});
      return { keepPage, debugPage };
    };

    const pickBestChatPage = async () => {
      const chatPages = context.pages().filter(p => isChatPage(p.url()));
      if (!chatPages.length) return null;
      const ranked = [];
      for (const candidate of chatPages) {
        const url = candidate.url() || '';
        const signals = await getPageSignals(candidate);
        let score = 0;
        if (/^https:\/\/chatgpt\.com\/c\//i.test(url)) score += 30;
        else if (/^https:\/\/chatgpt\.com\/$/i.test(url)) score += 20;
        else score += 10;
        if (signals.composerReady) score += 50;
        if (signals.visibilityState === 'visible') score += 10;
        if (signals.hasFocus) score += 10;
        if (signals.readyState === 'complete') score += 5;
        ranked.push({ page: candidate, score });
      }
      ranked.sort((a, b) => b.score - a.score);
      return ranked[0]?.page || chatPages[chatPages.length - 1];
    };

    let page = await pickBestChatPage();
    if (!page) {
      page = await context.newPage();
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    }

    await page.bringToFront();

    let sessionPages = await ensureSingleChatAndDebugPage(page);
    page = sessionPages.keepPage;

    await waitForSessionWindowsStable(45000, 4000, 500, true);

    const stabilizedPage = await pickBestChatPage();
    if (stabilizedPage) {
      page = stabilizedPage;
    }
    sessionPages = await ensureSingleChatAndDebugPage(page);
    page = sessionPages.keepPage;
    await page.bringToFront();

    const selectors = [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'textarea[placeholder*="Pregunta"]',
      'textarea[placeholder*="Message"]',
      'textarea[data-testid="prompt-textarea"]'
    ];

    const normalizeText = (value) =>
      String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const composerReadyInPage = async () => {
      return await page.evaluate(() => {
        const editor = document.querySelector('div#prompt-textarea[contenteditable="true"], #prompt-textarea[contenteditable="true"]');
        const form = document.querySelector('form[data-type="unified-composer"], form.group\\/composer');
        if (!editor || !form) return false;
        const editorRect = editor.getBoundingClientRect();
        const style = window.getComputedStyle(editor);
        return (
          editorRect.width > 50 &&
          editorRect.height > 20 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      }).catch(() => false);
    };

    const waitForComposerReady = async (timeoutMs = 30000) => {
      await page.waitForFunction(() => {
        const editor = document.querySelector('div#prompt-textarea[contenteditable="true"], #prompt-textarea[contenteditable="true"]');
        const form = document.querySelector('form[data-type="unified-composer"], form.group\\/composer');
        if (!editor || !form) return false;
        const editorRect = editor.getBoundingClientRect();
        const style = window.getComputedStyle(editor);
        return (
          editorRect.width > 50 &&
          editorRect.height > 20 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      }, { timeout: timeoutMs });
    };

    const disableAdvancedResearchMode = async () => {
      const candidates = [
        page.getByRole('button', { name: /Investigaci[oó]n avanzada, pulsa para quitar/i }).first(),
        page.getByRole('button', { name: /Advanced research, click to remove/i }).first(),
      ];

      for (const candidate of candidates) {
        const visible = await candidate.isVisible().catch(() => false);
        if (!visible) continue;
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await candidate.click({ timeout: 5000 });
        } catch {
          const handle = await candidate.elementHandle();
          if (handle) {
            await page.evaluate((el) => el.click(), handle);
          } else {
            continue;
          }
        }
        await page.waitForTimeout(600);
        console.log('ADVANCED_RESEARCH_OFF');
        return true;
      }
      return false;
    };

    const findVisiblePromptInput = async (timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        for (const sel of selectors) {
          const loc = page.locator(sel);
          const count = await loc.count();
          for (let i = 0; i < count; i++) {
            const candidate = loc.nth(i);
            const visible = await candidate.isVisible().catch(() => false);
            if (visible) {
              return candidate;
            }
          }
        }
        await page.waitForTimeout(250);
      }
      return null;
    };

    try {
      await waitForComposerReady();
    } catch {
      const fallbackPage = [...context.pages()]
        .filter(p => isChatPage(p.url()) && p !== page)
        .reverse()
        .find(p => /^https:\/\/chatgpt\.com\/(c\/|$)/i.test(p.url()));
      if (fallbackPage) {
        page = fallbackPage;
        await page.bringToFront();
      } else {
        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
      }
      await waitForComposerReady(45000);
    }
    await disableAdvancedResearchMode();

    const target = await findVisiblePromptInput();
    if (!target) throw new Error('No se encontro input visible de prompt');

    const getPromptSurfaceText = async () => {
      const handle = await target.elementHandle();
      if (!handle) return '';
      return await page.evaluate((el) => {
        if (!el) return '';
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          return el.value || '';
        }
        return el.innerText || el.textContent || '';
      }, handle);
    };

    const focusPromptSurface = async () => {
      const handle = await target.elementHandle();
      if (!handle) throw new Error('No se pudo resolver el editor de prompt');
      await page.evaluate((el) => {
        el.focus();
        if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement)) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }, handle);
    };

    const clearPromptSurface = async () => {
      const handle = await target.elementHandle();
      if (!handle) throw new Error('No se pudo resolver el editor de prompt');

      await page.evaluate((el) => {
        el.focus();
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }, handle);
      await page.keyboard.press('Backspace');
    };

    const waitForPromptRegistered = async (expectedPrompt, timeoutMs = 20000) => {
      const expectedSample = normalizeText(expectedPrompt).slice(0, 120);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const currentText = normalizeText(await getPromptSurfaceText());
        if (currentText && currentText.includes(expectedSample)) {
          return true;
        }
        await page.waitForTimeout(200);
      }
      return false;
    };

    const promptExistsAsUserTurn = async (expectedPrompt) => {
      const expectedSample = normalizeText(expectedPrompt).slice(0, 120);
      if (!expectedSample) return false;
      return await page.evaluate((sample) => {
        const headings = Array.from(document.querySelectorAll('article h5'));
        const userTurns = headings
          .filter((h) => /tu dijiste/i.test(h.innerText || ''))
          .map((h) => h.closest('article'))
          .filter(Boolean);
        const lastTurn = userTurns[userTurns.length - 1];
        if (!lastTurn) return false;
        const text = String(lastTurn.innerText || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\\s]/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
        return text.includes(sample);
      }, expectedSample).catch(() => false);
    };

    const waitForSendButtonReady = async (timeoutMs = 12000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const btn = page.locator('button[data-testid="send-button"]').first();
        const visible = await btn.isVisible().catch(() => false);
        const enabled = await btn.isEnabled().catch(() => false);
        if (visible && enabled) {
          return btn;
        }
        await page.waitForTimeout(200);
      }
      return null;
    };

    const waitForSubmissionStart = async (timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const currentText = normalizeText(await getPromptSurfaceText());
        if (!currentText) {
          return true;
        }
        const stopSignals = [
          page.getByRole('button', { name: /detener|stop/i }),
          page.locator('button[data-testid="stop-button"]').first(),
        ];
        for (const signal of stopSignals) {
          if (await signal.first().isVisible().catch(() => false)) {
            return true;
          }
        }
        await page.waitForTimeout(250);
      }
      return false;
    };

    const injectPrompt = async () => {
      await focusPromptSurface();
      await clearPromptSurface();
      await focusPromptSurface();
      await page.keyboard.insertText(prompt);
    };

    await injectPrompt();

    let promptRegistered = await waitForPromptRegistered(prompt);
    if (!promptRegistered) {
      await page.waitForTimeout(1500);
      await injectPrompt();
      promptRegistered = await waitForPromptRegistered(prompt, 25000);
    }
    if (!promptRegistered) {
      throw new Error('ChatGPT no registro el prompt en el editor visible');
    }

    const sendBtn = await waitForSendButtonReady();
    let submitted = false;
    if (sendBtn) {
      await sendBtn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await sendBtn.click({ timeout: 5000 });
      } catch {
        const handle = await sendBtn.elementHandle();
        if (handle) {
          await page.evaluate((el) => el.click(), handle);
        }
      }
      submitted = await waitForSubmissionStart();
    }

    if (!submitted) {
      await focusPromptSurface().catch(() => {});
      await page.keyboard.press('Enter');
      submitted = await waitForSubmissionStart();
    }

    if (!submitted) {
      submitted = await promptExistsAsUserTurn(prompt);
    }

    if (!submitted) {
      throw new Error('No se confirmo el envio del prompt');
    }

    const noImageTokenPhrases = [
      'has alcanzado tu limite de creacion de imagenes',
      'el limite se restablece',
      'youve hit the team plan limit for image generations requests',
      'you can create more images when the limit resets',
      'no pude invocar la herramienta de generacion de imagenes',
      'cannot generate more images',
      'image generation limit'
    ];

    const detectNoImageTokensAlert = async () => {
      const domSignals = [
        page.getByRole('heading', { name: /Has alcanzado tu límite de creación de imágenes/i }),
        page.getByRole('button', { name: /notificar al administrador/i }),
        page.getByText(/You've hit the team plan limit for image generations requests/i),
        page.getByText(/No pude invocar la herramienta de generación de imágenes/i),
      ];
      for (const signal of domSignals) {
        const visible = await signal.first().isVisible().catch(() => false);
        if (visible) {
          return true;
        }
      }

      const bodyText = normalizeText(await page.evaluate(() => document.body?.innerText || ''));
      if (noImageTokenPhrases.some((phrase) => bodyText.includes(phrase))) {
        return true;
      }
      return false;
    };

    const waitForNoImageTokensAlert = async (timeoutMs = 90000, pollMs = 1000) => {
      const deadline = Date.now() + timeoutMs;
      let idleCycles = 0;
      while (Date.now() < deadline) {
        if (await detectNoImageTokensAlert()) {
          return true;
        }

        const generatingSignals = [
          page.getByRole('button', { name: /Creando imagen/i }),
          page.getByRole('progressbar'),
          page.getByText(/Creando imagen/i),
          page.locator('button[data-testid="stop-button"]').first(),
        ];

        let generating = false;
        for (const signal of generatingSignals) {
          const visible = await signal.first().isVisible().catch(() => false);
          if (visible) {
            generating = true;
            break;
          }
        }

        if (generating) {
          idleCycles = 0;
        } else {
          idleCycles += 1;
          if (idleCycles >= 5) {
            return false;
          }
        }

        await page.waitForTimeout(pollMs);
      }
      return false;
    };

    const clickProfileMenu = async () => {
      const selectors = [
        '[data-testid="accounts-profile-button"][aria-label="Abrir el menú de perfil"]',
        '[data-testid="accounts-profile-button"][aria-label="Abrir el menu de perfil"]',
      ];

      for (const selector of selectors) {
        const loc = page.locator(selector).last();
        const count = await loc.count().catch(() => 0);
        if (!count) continue;
        const visible = await loc.isVisible().catch(() => false);
        if (!visible) continue;
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await loc.click({ timeout: 5000 });
        } catch {
          const handle = await loc.elementHandle();
          if (handle) {
            await page.evaluate((el) => el.click(), handle);
          } else {
            continue;
          }
        }
        return true;
      }

      const labelLoc = page.getByLabel(/Abrir el men[uú] de perfil/i).last();
      const labelVisible = await labelLoc.isVisible().catch(() => false);
      if (labelVisible) {
        await labelLoc.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await labelLoc.click({ timeout: 5000 });
        } catch {
          const handle = await labelLoc.elementHandle();
          if (handle) {
            await page.evaluate((el) => el.click(), handle);
          } else {
            return false;
          }
        }
        return true;
      }
      return false;
    };

    if (await waitForNoImageTokensAlert()) {
      if (await clickProfileMenu()) {
        console.log('PERFIL_CLICK_OK');
      } else {
        console.log('PERFIL_CLICK_WARN');
      }
      console.log('Sin tokens para imgs.');
    }

    const finalSessionPages = await ensureSingleChatAndDebugPage(page);
    page = finalSessionPages.keepPage;
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

    if NO_IMAGE_TOKENS_MARKER in result.stdout:
        return PROMPT_STATUS_NO_IMAGE_TOKENS
    return PROMPT_STATUS_SUCCESS


def process_prompt_with_account_rotation(cdp_port: int) -> None:
    last_switched_account_id = ""
    last_switched_account_label = ""

    for _ in range(MAX_ACCOUNT_ROTATION_ATTEMPTS):
        status = run_prompt_paste(cdp_port)
        if status == PROMPT_STATUS_SUCCESS:
            if last_switched_account_id:
                clear_account_exhausted(cdp_port, last_switched_account_id)
            return

        if status != PROMPT_STATUS_NO_IMAGE_TOKENS:
            raise RuntimeError(f"Estado inesperado de pegado de prompt: {status}")

        if last_switched_account_id:
            mark_account_exhausted(cdp_port, last_switched_account_id, last_switched_account_label)
            print(f"[INFO] Cuenta agotada marcada temporalmente: {last_switched_account_label or last_switched_account_id}")

        switch_result = switch_to_next_available_account(cdp_port)
        print(f"[INFO] Cuentas disponibles para rotacion: {switch_result.available_count}")

        if not switch_result.switched:
            trigger_change_count("no_viable_account")
            raise RuntimeError("No se encontro una cuenta disponible que pueda seguir intentando")

        last_switched_account_id = switch_result.selected_account_id
        last_switched_account_label = switch_result.selected_account_label
        print(f"[INFO] Cambiando a cuenta: {last_switched_account_label or last_switched_account_id}")
        time.sleep(5)

    trigger_change_count("rotation_attempts_exhausted")
    raise RuntimeError("Se agotaron los intentos de rotacion de cuenta")


def main() -> int:
    try:
        prompt = read_prompt()
        if should_skip_duplicate(prompt):
            print("PROMPT_DUPLICADO_RECIENTE_OMITIDO")
            print("promnt pegado con exito")
            return 0
        cdp_port = resolve_cdp_port()
        process_prompt_with_account_rotation(cdp_port)
        mark_prompt_sent(prompt)
        print("promnt pegado con exito")
        return 0
    except Exception as e:
        print(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
