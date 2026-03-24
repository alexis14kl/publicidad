import sys
sys.path.insert(0, r"C:\Users\NyGsoft\Desktop\publicidad")
from playwright.sync_api import sync_playwright

port = 65212

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")

    for ctx in browser.contexts:
        for pg in ctx.pages:
            if "d7b9080d" in (pg.url or ""):
                pg.bring_to_front()
                pg.wait_for_timeout(1000)
                print(f"Proyecto: {pg.url[:80]}")

                videos = pg.evaluate("""() => {
                    return Array.from(document.querySelectorAll('video')).map(v => ({
                        src: (v.src || v.currentSrc || '').slice(0, 150),
                        poster: (v.poster || '').slice(0, 100),
                        readyState: v.readyState,
                        networkState: v.networkState,
                        paused: v.paused,
                        ended: v.ended,
                        duration: v.duration,
                        videoWidth: v.videoWidth,
                        videoHeight: v.videoHeight,
                        error: v.error ? v.error.message : null,
                        preload: v.preload,
                        hasSrc: !!(v.src || v.currentSrc),
                        sourceElements: Array.from(v.querySelectorAll('source')).map(s => s.src.slice(0, 150)),
                    }));
                }""")

                print(f"\n=== {len(videos)} VIDEOS ===")
                for i, v in enumerate(videos):
                    print(f"\n[{i}] readyState={v['readyState']} networkState={v['networkState']}")
                    print(f"    src: {v['src']}")
                    print(f"    poster: {v['poster']}")
                    print(f"    size: {v['videoWidth']}x{v['videoHeight']} dur: {v['duration']}")
                    print(f"    paused: {v['paused']} ended: {v['ended']} error: {v['error']}")
                    print(f"    preload: {v['preload']} hasSrc: {v['hasSrc']}")
                    if v['sourceElements']:
                        print(f"    <source>: {v['sourceElements']}")

                # Also check for download buttons near videos
                downloads = pg.evaluate("""() => {
                    return Array.from(document.querySelectorAll('button')).filter(b => {
                        const text = (b.innerText || '').toLowerCase();
                        return text.includes('descargar') || text.includes('download');
                    }).map(b => ({
                        text: (b.innerText || '').trim().slice(0, 40),
                        visible: b.offsetParent !== null,
                    }));
                }""")
                print(f"\nBotones Descargar: {downloads}")

                # Check for blob URLs or media URLs in the page
                media = pg.evaluate("""() => {
                    const results = [];
                    document.querySelectorAll('[src*="blob:"], [src*="media"], [src*="video"], [src*="getMedia"]').forEach(el => {
                        results.push({
                            tag: el.tagName,
                            src: (el.src || el.currentSrc || '').slice(0, 200),
                        });
                    });
                    return results;
                }""")
                if media:
                    print(f"\nMedia elements: {media}")

                break

    browser.close()
