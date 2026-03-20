"""Inspect Flow page DOM elements for RPA selectors."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")

from playwright.sync_api import sync_playwright

port = 49170

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    # Find the Flow page
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

    print(f"Pagina Flow encontrada: {flow_page.url}")
    flow_page.bring_to_front()
    flow_page.wait_for_timeout(2000)

    # Get all interactive elements
    elements = flow_page.evaluate("""() => {
        const results = [];

        // Buttons
        document.querySelectorAll('button').forEach(el => {
            const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
            const aria = el.getAttribute('aria-label') || '';
            const cls = el.className || '';
            if (text || aria) {
                results.push({
                    tag: 'button',
                    text: text,
                    ariaLabel: aria,
                    class: cls.slice(0, 100),
                    id: el.id || '',
                    visible: el.offsetParent !== null,
                });
            }
        });

        // Textareas and inputs
        document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(el => {
            const placeholder = el.getAttribute('placeholder') || '';
            const aria = el.getAttribute('aria-label') || '';
            results.push({
                tag: el.tagName.toLowerCase() + (el.getAttribute('contenteditable') ? '[contenteditable]' : ''),
                text: placeholder || aria,
                ariaLabel: aria,
                class: (el.className || '').slice(0, 100),
                id: el.id || '',
                visible: el.offsetParent !== null,
            });
        });

        // Links with relevant text
        document.querySelectorAll('a').forEach(el => {
            const text = (el.innerText || '').trim().slice(0, 80);
            const href = el.getAttribute('href') || '';
            if (text && (text.includes('Crear') || text.includes('Nuevo') || text.includes('New') || text.includes('Create') || text.includes('proyecto') || text.includes('project'))) {
                results.push({
                    tag: 'a',
                    text: text,
                    ariaLabel: el.getAttribute('aria-label') || '',
                    class: (el.className || '').slice(0, 100),
                    href: href.slice(0, 100),
                    visible: el.offsetParent !== null,
                });
            }
        });

        // Divs with role=button
        document.querySelectorAll('[role="button"]').forEach(el => {
            const text = (el.innerText || '').trim().slice(0, 80);
            if (text) {
                results.push({
                    tag: 'div[role=button]',
                    text: text,
                    ariaLabel: el.getAttribute('aria-label') || '',
                    class: (el.className || '').slice(0, 100),
                    visible: el.offsetParent !== null,
                });
            }
        });

        return results;
    }""")

    print(f"\n=== {len(elements)} elementos interactivos encontrados ===\n")
    for i, el in enumerate(elements):
        vis = "VISIBLE" if el.get('visible') else "hidden"
        print(f"[{i+1}] <{el['tag']}> [{vis}]")
        if el.get('text'):
            print(f"    Text: {el['text']}")
        if el.get('ariaLabel'):
            print(f"    Aria: {el['ariaLabel']}")
        if el.get('class'):
            print(f"    Class: {el['class']}")
        if el.get('id'):
            print(f"    ID: {el['id']}")
        if el.get('href'):
            print(f"    Href: {el['href']}")
        print()

    browser.close()
