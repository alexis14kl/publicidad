"""Check current state: what did the bot do?"""
import sys, json, urllib.request
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 64870

# First list all tabs
with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as resp:
    tabs = json.loads(resp.read())
print("=== TABS ===")
for t in tabs:
    if t.get("type") == "page":
        print(f"  {t.get('title','?')[:50]} -> {t.get('url','?')[:80]}")

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    # Find project page
    project_page = None
    for ctx in browser.contexts:
        for pg in ctx.pages:
            url = pg.url or ""
            if "/project/" in url:
                count = pg.evaluate("() => document.querySelectorAll('button').length")
                if count > 0:
                    project_page = pg
                    print(f"\nProyecto activo: {url[:100]} ({count} buttons)")

    if not project_page:
        print("No hay proyecto activo")
        browser.close()
        sys.exit(1)

    project_page.bring_to_front()
    project_page.wait_for_timeout(1000)

    # Check contenteditable
    ce = project_page.evaluate("""() => {
        const el = document.querySelector('[contenteditable="true"]');
        return el ? (el.innerText || '').trim().slice(0, 200) : 'NO HAY';
    }""")
    print(f"\nPrompt en CE: {ce[:200]}")

    # Find the arrow_forward Crear button specifically
    crear_info = project_page.evaluate("""() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const results = [];
        for (const b of buttons) {
            const text = (b.innerText || '').trim();
            const lower = text.toLowerCase();
            if (lower.includes('crear') || lower.includes('create') || lower.includes('arrow_forward')) {
                const rect = b.getBoundingClientRect();
                results.push({
                    text: text.replace(/\\n/g, ' | ').slice(0, 60),
                    visible: b.offsetParent !== null,
                    disabled: b.disabled,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    class: (b.className || '').slice(0, 80),
                });
            }
        }
        return results;
    }""")

    print(f"\n=== Botones 'Crear' encontrados: {len(crear_info)} ===")
    for b in crear_info:
        vis = "VIS" if b['visible'] else "HID"
        dis = " DISABLED" if b['disabled'] else ""
        print(f"  [{vis}{dis}] '{b['text']}' pos:({b['x']},{b['y']}) size:{b['w']}x{b['h']}")

    # Check if video is generating (loading indicators)
    loading = project_page.evaluate("""() => {
        const body = document.body.innerText || '';
        const indicators = {
            generando: body.includes('Generando') || body.includes('Generating'),
            procesando: body.includes('Procesando') || body.includes('Processing'),
            cargando: body.includes('Cargando') || body.includes('Loading'),
            error: body.includes('Application error'),
            cola: body.includes('cola') || body.includes('queue'),
        };
        return indicators;
    }""")
    print(f"\nEstado: {loading}")

    browser.close()
