const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_NAME = process.argv[2] || '#1 Chat Gpt PRO';
const CDP_URL = process.argv[3] || 'http://127.0.0.1:9333';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('No CDP context');

    let page =
      ctx.pages().find((p) => (p.url() || '').includes('/environment/envList')) || ctx.pages()[0];
    if (!page) page = await ctx.newPage();
    await page.bringToFront();

    await page.evaluate(() => {
      const href = window.location.href || '';
      if (!href.includes('/environment/envList')) {
        window.location.hash = '/environment/envList';
      }
    });
    await page.waitForTimeout(1200);

    const searchSel = [
      'input[placeholder*="Número/Nombre/Notas"]',
      'input[placeholder*="Numero/Nombre/Notas"]',
      'input[placeholder*="Name"]',
      'input[placeholder*="Nombre"]',
    ];
    for (const s of searchSel) {
      const loc = page.locator(s).first();
      if ((await loc.count()) === 0) continue;
      try {
        await loc.click({ timeout: 1200 });
        await loc.fill('');
        await loc.fill(PROFILE_NAME);
        await loc.press('Enter');
        await page.waitForTimeout(900);
        break;
      } catch (_) {
        // keep trying
      }
    }

    const found = await page.evaluate((wanted) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('.el-table__row'));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const text = norm(row.innerText || '');
        if (!text.includes(norm(wanted))) continue;

        const checkbox =
          row.querySelector('td.el-table_1_column_1 .el-checkbox__inner') ||
          row.querySelector('td.el-table_1_column_1 .el-checkbox__input') ||
          row.querySelector('td.el-table_1_column_1 input[type="checkbox"]') ||
          row.querySelector('td:first-child');
        if (checkbox) checkbox.click();

        return true;
      }
      return false;
    }, PROFILE_NAME);

    if (!found) {
      await page.screenshot({ path: path.join(process.cwd(), 'force_open_not_found.png'), fullPage: true });
      throw new Error('No se encontro la fila del perfil');
    }

    await page.waitForTimeout(500);

    let opened = await page.evaluate((wanted) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('.el-table__row'));
      for (const row of rows) {
        if (!norm(row.innerText).includes(norm(wanted))) continue;
        const candidates = Array.from(row.querySelectorAll('button,span,div,a'));
        const openBtn = candidates.find((el) => /abrir|open/i.test((el.textContent || '').trim()));
        if (openBtn) {
          openBtn.click();
          return true;
        }
      }

      const buttons = Array.from(document.querySelectorAll('button,span,div,a'));
      const target = buttons.find((el) => /abrir perfil|open profile/i.test((el.textContent || '').trim()));
      if (!target) return false;
      target.click();
      return true;
    }, PROFILE_NAME);

    if (!opened) {
      opened = await page.evaluate((wanted) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll('.el-table__row'));
        for (const row of rows) {
          if (!norm(row.innerText).includes(norm(wanted))) continue;
          const candidates = Array.from(row.querySelectorAll('button,span,div,a'));
          const openBtn = candidates.find((el) => /abrir|open/i.test((el.textContent || '').trim()));
          if (openBtn) {
            openBtn.click();
            return true;
          }
          const opCell = row.querySelector('td.el-table_1_column_13, td:last-child');
          if (opCell) {
            opCell.click();
            return true;
          }
        }
        return false;
      }, PROFILE_NAME);
    }

    if (!opened) {
      await page.screenshot({ path: path.join(process.cwd(), 'force_open_no_toolbar_button.png'), fullPage: true });
      throw new Error('No se encontro boton Abrir (toolbar ni fila)');
    }

    await sleep(6000);

    const cdpPath = path.join(process.env.APPDATA || '', 'DICloak', 'cdp_debug_info.json');
    const raw = fs.existsSync(cdpPath) ? fs.readFileSync(cdpPath, 'utf8') : '';
    console.log(`[OK] click Abrir perfil ejecutado`);
    console.log(`[INFO] cdp_debug_info.json: ${raw || '(vacio)'}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`[ERROR] ${e.message || e}`);
  process.exit(1);
});
