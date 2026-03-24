import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 54089

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    for ctx in browser.contexts:
        for pg in ctx.pages:
            if "754d4d6d" in (pg.url or ""):
                pg.bring_to_front()
                pg.wait_for_timeout(2000)
                print(f"URL: {pg.url[:100]}")

                # Screenshot del body text completo
                body = pg.evaluate("() => (document.body.innerText || '').slice(0, 2000)")
                print(f"\n=== BODY TEXT ===\n{body}")

                # Videos
                videos = pg.evaluate("""() => {
                    return Array.from(document.querySelectorAll('video')).map(v => ({
                        src: v.src || v.currentSrc || '',
                        poster: v.poster || '',
                        w: v.videoWidth,
                        h: v.videoHeight,
                        duration: v.duration,
                        ready: v.readyState,
                    }));
                }""")
                print(f"\n=== VIDEOS: {len(videos)} ===")
                for v in videos:
                    print(f"  src: {v['src'][:120]}")
                    print(f"  size: {v['w']}x{v['h']} dur: {v['duration']} ready: {v['ready']}")

                # Download buttons
                btns = pg.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button'))
                        .filter(b => b.offsetParent !== null)
                        .map(b => (b.innerText||'').trim().replace(/\\n/g,' | ').slice(0,60));
                }""")
                print(f"\n=== BOTONES ({len(btns)}) ===")
                for b in btns:
                    print(f"  {b}")

                break

    browser.close()
