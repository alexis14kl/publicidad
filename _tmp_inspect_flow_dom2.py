"""Inspect Flow page - deeper DOM analysis for new project flow."""
import sys
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

    # 1. Find "Nuevo proyecto" button and any add/create buttons
    print("=== BOTONES DE CREAR/NUEVO ===")
    elements = flow_page.evaluate("""() => {
        const results = [];
        document.querySelectorAll('button, [role="button"], a').forEach(el => {
            const text = (el.innerText || el.textContent || '').trim();
            const aria = el.getAttribute('aria-label') || '';
            const combined = (text + ' ' + aria).toLowerCase();
            if (combined.includes('nuevo') || combined.includes('new') ||
                combined.includes('crear') || combined.includes('create') ||
                combined.includes('add') || combined.includes('plus') ||
                combined.includes('add_2') || combined.includes('+')) {
                results.push({
                    tag: el.tagName,
                    text: text.slice(0, 100),
                    aria: aria,
                    class: (el.className || '').slice(0, 120),
                    visible: el.offsetParent !== null,
                    rect: el.getBoundingClientRect(),
                    disabled: el.disabled || false,
                });
            }
        });
        return results;
    }""")
    for el in elements:
        vis = "VISIBLE" if el['visible'] else "HIDDEN"
        print(f"  [{vis}] <{el['tag']}> text='{el['text']}' aria='{el['aria']}'")
        print(f"    class: {el['class']}")
        print(f"    rect: x={el['rect']['x']:.0f} y={el['rect']['y']:.0f} w={el['rect']['width']:.0f} h={el['rect']['height']:.0f}")
        print()

    # 2. Find the FAB / floating action button (common pattern for "new")
    print("\n=== FAB / FLOATING BUTTONS ===")
    fabs = flow_page.evaluate("""() => {
        const results = [];
        document.querySelectorAll('button, [role="button"]').forEach(el => {
            const style = window.getComputedStyle(el);
            const pos = style.position;
            const zIndex = parseInt(style.zIndex) || 0;
            if ((pos === 'fixed' || pos === 'absolute' || pos === 'sticky') && zIndex > 10) {
                results.push({
                    tag: el.tagName,
                    text: (el.innerText || '').trim().slice(0, 80),
                    class: (el.className || '').slice(0, 120),
                    position: pos,
                    zIndex: zIndex,
                    rect: el.getBoundingClientRect(),
                    visible: el.offsetParent !== null,
                });
            }
        });
        return results;
    }""")
    for el in fabs:
        vis = "VISIBLE" if el['visible'] else "HIDDEN"
        print(f"  [{vis}] <{el['tag']}> text='{el['text']}' z={el['zIndex']} pos={el['position']}")
        print(f"    class: {el['class']}")
        print(f"    rect: x={el['rect']['x']:.0f} y={el['rect']['y']:.0f} w={el['rect']['width']:.0f} h={el['rect']['height']:.0f}")
        print()

    # 3. Get full page structure (main areas)
    print("\n=== ESTRUCTURA PRINCIPAL ===")
    structure = flow_page.evaluate("""() => {
        const results = [];
        // Look for main content areas with text
        document.querySelectorAll('h1, h2, h3, [class*="title"], [class*="header"], [class*="project"]').forEach(el => {
            const text = (el.innerText || '').trim().slice(0, 100);
            if (text && text.length > 2) {
                results.push({
                    tag: el.tagName,
                    text: text,
                    class: (el.className || '').slice(0, 120),
                });
            }
        });
        return results;
    }""")
    for el in structure:
        print(f"  <{el['tag']}> '{el['text']}'")
        if el.get('class'):
            print(f"    class: {el['class']}")
        print()

    # 4. Check for scrollable project list
    print("\n=== PROYECTOS VISIBLES ===")
    projects = flow_page.evaluate("""() => {
        const results = [];
        // Look for project cards/items
        document.querySelectorAll('[class*="project"], [class*="card"], [class*="item"]').forEach(el => {
            const text = (el.innerText || '').trim().slice(0, 150);
            if (text && el.children.length > 0) {
                results.push({
                    tag: el.tagName,
                    text: text.replace(/\\n/g, ' | ').slice(0, 150),
                    class: (el.className || '').slice(0, 120),
                    children: el.children.length,
                });
            }
        });
        return results.slice(0, 10); // Max 10
    }""")
    for el in projects:
        print(f"  <{el['tag']}> [{el['children']} children]")
        print(f"    text: {el['text']}")
        print(f"    class: {el['class']}")
        print()

    browser.close()
