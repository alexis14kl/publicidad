"""Check the NEW project specifically."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 64870

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    for ctx in browser.contexts:
        for pg in ctx.pages:
            if "78e359d5" in (pg.url or ""):
                pg.bring_to_front()
                pg.wait_for_timeout(1000)
                print(f"Proyecto nuevo: {pg.url[:100]}")

                ce = pg.evaluate("""() => {
                    const el = document.querySelector('[contenteditable="true"]');
                    return el ? (el.innerText || '').trim().slice(0, 300) : 'NO HAY CE';
                }""")
                print(f"CE contenido: {ce[:200]}")

                buttons = pg.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button'))
                        .filter(b => b.offsetParent !== null)
                        .map(b => (b.innerText||'').trim().replace(/\\n/g,' | ').slice(0,60));
                }""")
                print(f"Botones visibles: {buttons}")
                break

    browser.close()
