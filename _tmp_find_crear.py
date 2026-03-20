"""Find ALL buttons on the working project page."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 65103

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    # List all pages
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "labs.google/fx" in url and "accounts" not in url:
                # Check if page has content (not crashed)
                has_buttons = page.evaluate("() => document.querySelectorAll('button').length")
                print(f"  [{has_buttons} btns] {url[:100]}")

    # Use the one with most buttons (working one)
    best_page = None
    best_count = 0
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "/project/" in url:
                count = page.evaluate("() => document.querySelectorAll('button').length")
                if count > best_count:
                    best_count = count
                    best_page = page

    if not best_page or best_count == 0:
        print("No hay proyecto funcional. Navegando a Flow para crear uno...")
        # Use any Flow page and navigate to list
        for ctx in browser.contexts:
            for page in ctx.pages:
                if "labs.google/fx" in (page.url or "") and "accounts" not in (page.url or ""):
                    page.bring_to_front()
                    page.goto("https://labs.google/fx/es/tools/flow", wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(3000)

                    # Click Nuevo proyecto
                    page.evaluate("""() => {
                        const btn = Array.from(document.querySelectorAll('button'))
                            .find(b => (b.innerText||'').includes('Nuevo proyecto'));
                        if (btn) btn.click();
                    }""")
                    page.wait_for_timeout(4000)

                    best_page = page
                    print(f"Nuevo proyecto creado: {page.url[:100]}")
                    break
            if best_page:
                break

    if not best_page:
        print("ERROR: No se pudo obtener una pagina funcional")
        browser.close()
        sys.exit(1)

    best_page.bring_to_front()
    best_page.wait_for_timeout(2000)
    print(f"\nUsando: {best_page.url[:100]}")

    buttons = best_page.evaluate("""() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
            text: (b.innerText || '').trim().replace(/\\n/g, ' | '),
            visible: b.offsetParent !== null,
            disabled: b.disabled,
        }));
    }""")

    print(f"\n=== {len(buttons)} botones ===\n")
    for i, b in enumerate(buttons):
        vis = "VIS" if b['visible'] else "HID"
        dis = " DIS" if b['disabled'] else ""
        print(f"[{i+1}] [{vis}{dis}] '{b['text'][:80]}'")

    browser.close()
