import json, urllib.request
port = 65103
try:
    url = f"http://127.0.0.1:{port}/json/list"
    with urllib.request.urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read())
    print(f"Puerto {port} - {len(data)} tabs:")
    for i, t in enumerate(data):
        if t.get("type") == "page":
            print(f"  [{i+1}] {t.get('title','?')[:60]}")
            print(f"      URL: {t.get('url','?')[:120]}")
except Exception as e:
    print(f"Error: {e}")
