import json, urllib.request
port = 49170

# Get tab list to find the Flow page
url = f"http://127.0.0.1:{port}/json/list"
with urllib.request.urlopen(url, timeout=5) as resp:
    tabs = json.loads(resp.read())

for t in tabs:
    if t.get("type") == "page" and "labs.google" in t.get("url", ""):
        print(f"Flow tab found: {t['title']}")
        print(f"  URL: {t['url']}")
        print(f"  ID: {t['id']}")
