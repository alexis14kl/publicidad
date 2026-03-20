"""Click "Nuevo proyecto" on Flow page and inspect what appears."""
import sys, time
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 49170

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    flow_page = None
    for ctx in browser.contexts:
        for page in ctx.pages:
            if "labs.google/fx" in (page.url or "") and "accounts.google" not in (page.url or ""):
                flow_page = page
                break

    if not flow_page:
        print("ERROR: No se encontro la pagina de Flow")
        browser.close()
        sys.exit(1)

    flow_page.bring_to_front()
    flow_page.wait_for_timeout(1000)

    # Scroll down to reveal hidden button
    flow_page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    flow_page.wait_for_timeout(1000)

    # Try to find and click "Nuevo proyecto"
    btn = flow_page.evaluate("""() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => (b.innerText || '').includes('Nuevo proyecto'));
        if (btn) {
            // Make it visible and click it
            btn.style.display = 'block';
            btn.style.visibility = 'visible';
            btn.style.opacity = '1';
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return {
                text: btn.innerText.trim().slice(0, 80),
                class: btn.className.slice(0, 100),
                visible: btn.offsetParent !== null,
                rect: btn.getBoundingClientRect(),
            };
        }
        return null;
    }""")

    if btn:
        print(f"Boton encontrado: {btn['text']}")
        print(f"  Visible: {btn['visible']}, rect: x={btn['rect']['x']:.0f} y={btn['rect']['y']:.0f}")

        # Click it
        flow_page.wait_for_timeout(500)
        flow_page.click("button:has-text('Nuevo proyecto')", force=True)
        print("Click realizado en 'Nuevo proyecto'!")

        # Wait and inspect what appeared
        flow_page.wait_for_timeout(3000)

        print(f"\nURL despues del click: {flow_page.url}")

        # Check for new elements (modal, textarea, etc)
        new_elements = flow_page.evaluate("""() => {
            const results = [];
            // Textareas, inputs, contenteditable
            document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(el => {
                if (el.offsetParent !== null) {
                    results.push({
                        tag: el.tagName + (el.getAttribute('contenteditable') ? '[ce]' : ''),
                        placeholder: el.getAttribute('placeholder') || '',
                        aria: el.getAttribute('aria-label') || '',
                        class: (el.className || '').slice(0, 120),
                        id: el.id || '',
                    });
                }
            });
            // Visible buttons
            document.querySelectorAll('button').forEach(el => {
                const text = (el.innerText || '').trim();
                if (el.offsetParent !== null && text.length > 1 && text.length < 50) {
                    results.push({
                        tag: 'button',
                        text: text,
                        aria: el.getAttribute('aria-label') || '',
                        class: (el.className || '').slice(0, 120),
                    });
                }
            });
            return results;
        }""")

        print(f"\n=== Elementos despues del click ({len(new_elements)}) ===")
        for el in new_elements:
            print(f"  <{el['tag']}>", end='')
            if el.get('text'):
                print(f" text='{el['text']}'", end='')
            if el.get('placeholder'):
                print(f" placeholder='{el['placeholder']}'", end='')
            if el.get('aria'):
                print(f" aria='{el['aria']}'", end='')
            print(f"\n    class: {el.get('class', '')}")
    else:
        print("No se encontro el boton 'Nuevo proyecto'")

    browser.close()
