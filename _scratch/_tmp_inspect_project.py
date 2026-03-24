"""Inspect the project page to find the generate button."""
import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 63552

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    page = None
    for ctx in browser.contexts:
        for pg in ctx.pages:
            if "6ea8b958" in (pg.url or ""):
                page = pg
                break

    if not page:
        print("Proyecto no encontrado")
        browser.close()
        sys.exit(1)

    page.bring_to_front()
    page.wait_for_timeout(2000)
    print(f"Proyecto: {page.url[:100]}")

    # 1. ALL buttons with full details
    buttons = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('button')).map((b, i) => {
            const rect = b.getBoundingClientRect();
            return {
                index: i,
                innerText: (b.innerText || '').trim().replace(/\\n/g, ' | '),
                ariaLabel: b.getAttribute('aria-label') || '',
                class: (b.className || '').slice(0, 100),
                visible: b.offsetParent !== null,
                disabled: b.disabled,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
            };
        });
    }""")

    print(f"\n=== {len(buttons)} BOTONES ===\n")
    for b in buttons:
        vis = "VIS" if b['visible'] else "HID"
        dis = " DISABLED" if b['disabled'] else ""
        print(f"[{b['index']}] [{vis}{dis}] '{b['innerText'][:70]}'")
        if b['ariaLabel']:
            print(f"    aria: '{b['ariaLabel']}'")
        print(f"    pos: ({b['x']},{b['y']}) size: {b['w']}x{b['h']}")
        print(f"    class: {b['class'][:80]}")
        print()

    # 2. Look for arrow_forward specifically
    print("\n=== ELEMENTOS CON 'arrow_forward' o 'crear' ===\n")
    arrows = page.evaluate("""() => {
        const all = Array.from(document.querySelectorAll('*'));
        return all.filter(el => {
            const text = (el.innerText || el.textContent || '').toLowerCase();
            return (text.includes('arrow_forward') || text.includes('generar') || text.includes('generate'))
                && el.tagName !== 'BODY' && el.tagName !== 'HTML'
                && (el.innerText || '').trim().length < 60;
        }).map(el => ({
            tag: el.tagName,
            text: (el.innerText || '').trim().slice(0, 60),
            class: (el.className || '').slice(0, 80),
            visible: el.offsetParent !== null,
            clickable: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button',
        })).slice(0, 15);
    }""")
    for el in arrows:
        vis = "VIS" if el['visible'] else "HID"
        click = " CLICKABLE" if el['clickable'] else ""
        print(f"  [{vis}{click}] <{el['tag']}> '{el['text']}'")
        print(f"    class: {el['class']}")

    # 3. Check contenteditable content
    print("\n=== CONTENTEDITABLE ===")
    ce = page.evaluate("""() => {
        const el = document.querySelector('[contenteditable="true"]');
        return el ? (el.innerText || '').trim().slice(0, 300) : 'NO HAY';
    }""")
    print(f"  Contenido: {ce[:300]}")

    # 4. Bottom bar / action area
    print("\n=== ZONA INFERIOR (posible barra de accion) ===")
    bottom = page.evaluate("""() => {
        const viewH = window.innerHeight;
        const all = Array.from(document.querySelectorAll('button, [role="button"], a'));
        return all.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.y > viewH - 200 && el.offsetParent !== null;
        }).map(el => ({
            tag: el.tagName,
            text: (el.innerText || '').trim().slice(0, 60),
            x: Math.round(el.getBoundingClientRect().x),
            y: Math.round(el.getBoundingClientRect().y),
            w: Math.round(el.getBoundingClientRect().width),
            h: Math.round(el.getBoundingClientRect().height),
        }));
    }""")
    for el in bottom:
        print(f"  <{el['tag']}> '{el['text']}' pos:({el['x']},{el['y']}) size:{el['w']}x{el['h']}")

    browser.close()
