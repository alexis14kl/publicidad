"""Check the new project page that bot created."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 50283

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    # Find the 335620d3 project (the one bot created)
    for ctx in browser.contexts:
        for page in ctx.pages:
            url = page.url or ""
            if "335620d3" in url:
                page.bring_to_front()
                page.wait_for_timeout(2000)
                print(f"Proyecto bot: {url[:100]}")

                # Count elements
                count = page.evaluate("() => document.querySelectorAll('*').length")
                print(f"Elements: {count}")

                # Check contenteditable
                ces = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
                        tag: el.tagName,
                        text: (el.innerText || '').trim().slice(0, 200),
                        class: (el.className || '').slice(0, 80),
                        visible: el.offsetParent !== null,
                    }));
                }""")
                print(f"\nContenteditables: {len(ces)}")
                for ce in ces:
                    vis = "VIS" if ce['visible'] else "HID"
                    print(f"  [{vis}] <{ce['tag']}> text='{ce['text'][:100]}'")
                    print(f"    class: {ce['class']}")

                # Check buttons
                buttons = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button')).map(b => ({
                        text: (b.innerText || '').trim().slice(0, 60),
                        visible: b.offsetParent !== null,
                    })).filter(b => b.visible);
                }""")
                print(f"\nBotones visibles: {len(buttons)}")
                for b in buttons:
                    print(f"  '{b['text']}'")

                # Check page body text
                body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 500) : 'NO BODY'")
                print(f"\nBody text:\n{body[:500]}")

    browser.close()
