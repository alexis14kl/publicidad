import json, urllib.request, subprocess

TOKEN = "EAALTDIaJuDIBRIpj7r5hJexYER7YUZA7AKM3JxgcEZC2CuSpqSbtZCw5GKSMi0FuRGdjICci5p1c73ZAWnU1kAOwGYLAPEWDUlswVa9ZCSZBcFeZBkp9qi4lWHkSpdTSLzkZAlHAer4kI7scbV7QhdKFtA1eLMu1um0amfolOn3Va8z4MhaZB1ZB53ZC6AJ11SFxAYlncfnr4RCLKuEVfn8g71FBZBSkBbpq4KwGMLKdB9a1yZB8MhRyZCWlZAqhM0AUAZDZD"

# 1. Validate - is it a page token?
print("=== Validando ===")
try:
    url = f"https://graph.facebook.com/v21.0/me?fields=id,name&access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    print(f"id={data.get('id')}, name={data.get('name')}")
except Exception as e:
    print(f"Error: {e}")
    exit(1)

# 2. Check permissions
print("\n=== Permisos ===")
try:
    url = f"https://graph.facebook.com/v21.0/me/permissions?access_token={TOKEN}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    perms = [p['permission'] for p in data.get('data', []) if p.get('status') == 'granted']
    print(f"Permisos: {perms}")
    print(f"pages_manage_posts: {'SI' if 'pages_manage_posts' in perms else 'NO'}")
except Exception as e:
    print(f"Error: {e}")

# 3. Update SQLite
print("\n=== Actualizando SQLite ===")
BIN = r"C:\Users\NyGsoft\Desktop\publicidad\bin\sqlite3.exe"
DB = r"C:\Users\NyGsoft\Desktop\publicidad\Backend\facebook.sqlite3"
safe = TOKEN.replace("'", "''")
SQL = f"UPDATE facebook_form SET token = '{safe}' WHERE page_id = '115406607722279' AND is_primary = 1;"
r = subprocess.run([BIN, DB, SQL], capture_output=True, text=True, timeout=5)
print(f"SQLite: {r.stderr or 'OK'}")
