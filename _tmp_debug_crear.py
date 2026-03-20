"""Check current state of project after prompt paste."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 49809

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "072265e7" in url:
                page.bring_to_front()
                page.wait_for_timeout(1000)
                print(f"Proyecto: {url[:100]}")

                # Check contenteditable content
                ce_text = page.evaluate("""() => {
                    const el = document.querySelector('[contenteditable="true"]');
                    return el ? el.innerText.trim().slice(0, 200) : 'NO HAY CE';
                }""")
                print(f"\nContenido CE: {ce_text[:200]}")

                # Get ALL buttons with raw innerText bytes
                buttons = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button')).map(b => {
                        const text = (b.innerText || '');
                        return {
                            raw: text.trim().slice(0, 80),
                            lower: text.toLowerCase().trim().slice(0, 80),
                            hasCrear: text.toLowerCase().includes('crear'),
                            hasCreate: text.toLowerCase().includes('create'),
                            visible: b.offsetParent !== null,
                            disabled: b.disabled,
                        };
                    });
                }""")

                print(f"\n=== {len(buttons)} botones ===")
                for i, b in enumerate(buttons):
                    vis = "VIS" if b['visible'] else "HID"
                    dis = " DIS" if b['disabled'] else ""
                    crear = " ***CREAR***" if b['hasCrear'] or b['hasCreate'] else ""
                    print(f"[{i+1}] [{vis}{dis}]{crear} '{b['raw'][:60]}'")

                break

    browser.close()
