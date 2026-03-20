import json, urllib.request, subprocess
from urllib.error import HTTPError

TOKEN = "IGAAWqTCX6iEhBZAGJmLXJLWl9xZAEFyd1hYb0Q2Q19lUXpyX3oyb3d5amxGT0RFa21wZAnJGY0dNUnJNYVVlQmJBXzBfaG5BVElldTJ0X0MwVHhQcmQzNEhUNkpER1FzS2c4YmdsWEFfRTJBdHFxdVBueFc3dklrdWxiNDVLMWdrdwZDZD"
APP_SECRET = "749e29f8214e8da77b9afc1a284c2276"

# Try exchange with old endpoint
print("=== Intento 1: ig_exchange_token ===")
try:
    url = f"https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret={APP_SECRET}&access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        print(json.loads(resp.read()))
except HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")

# Try with Facebook Graph API endpoint
print("\n=== Intento 2: fb_exchange_token via Graph API ===")
try:
    url = f"https://graph.facebook.com/v21.0/oauth/access_token?grant_type=ig_exchange_token&client_secret={APP_SECRET}&access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        print(json.loads(resp.read()))
except HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")

# Try refresh (for already long-lived tokens)
print("\n=== Intento 3: ig_refresh_token ===")
try:
    url = f"https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read())
        print(f"OK: expires_in={data.get('expires_in')} ({data.get('expires_in',0)//86400} dias)")
        long_token = data.get("access_token", "")
        if long_token:
            BIN = r"C:\Users\NyGsoft\Desktop\publicidad\bin\sqlite3.exe"
            DB = r"C:\Users\NyGsoft\Desktop\publicidad\Backend\instagram.sqlite3"
            safe = long_token.replace("'", "''")
            SQL = f"UPDATE instagram_form SET token = '{safe}' WHERE account_id = '17841440667412938' AND is_primary = 1;"
            subprocess.run([BIN, DB, SQL], capture_output=True, text=True, timeout=5)
            print(f"SQLite actualizado!")
            print(f"Token: {long_token[:40]}...")
except HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")

# Check token info
print("\n=== Debug: Token info ===")
try:
    url = f"https://graph.instagram.com/v21.0/me?fields=id,username,account_type,user_id&access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        print(json.loads(resp.read()))
except HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")
