import json, urllib.request
port = 49170
try:
    url = f"http://127.0.0.1:{port}/json/list"
    with urllib.request.urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read())
    print(f"Conectado a CDP puerto {port} - {len(data)} paginas:")
    for i, t in enumerate(data):
        if t.get("type") == "page":
            print(f"  [{i+1}] {t.get('title','?')[:70]}")
            print(f"      URL: {t.get('url','?')[:100]}")
except Exception as e:
    print(f"Error: {e}")
