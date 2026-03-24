import json, urllib.request
for port in [9222, 9223, 9224]:
    try:
        url = f"http://127.0.0.1:{port}/json/version"
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read())
            print(f"Puerto {port} OK: {data.get('Browser','?')}")
            # List pages
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as r2:
                pages = json.loads(r2.read())
                for p in pages:
                    if p.get("type") == "page":
                        print(f"  {p.get('title','?')[:50]} -> {p.get('url','?')[:80]}")
            break
    except Exception as e:
        print(f"Puerto {port}: {e}")
