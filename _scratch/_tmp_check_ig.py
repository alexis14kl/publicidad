import subprocess, json
BIN = r"C:\Users\NyGsoft\Desktop\publicidad\bin\sqlite3.exe"

# Check all platforms for NoyeCode
for platform in ['facebook', 'instagram', 'linkedin', 'tiktok']:
    DB = rf"C:\Users\NyGsoft\Desktop\publicidad\Backend\{platform}.sqlite3"
    SQL = f"SELECT e.nombre, f.* FROM {platform}_form f JOIN empresas e ON e.id = f.empresa_id WHERE e.nombre = 'NoyeCode';"
    r = subprocess.run([BIN, "-json", DB, SQL], capture_output=True, text=True, timeout=5)
    if r.stdout and r.stdout.strip():
        data = json.loads(r.stdout)
        print(f"\n=== {platform.upper()} ===")
        for row in data:
            token = row.get('token', '')
            print(f"  nombre: {row.get('nombre')}")
            print(f"  token: {token[:30]}..." if len(token) > 30 else f"  token: {token}")
            print(f"  account_id: {row.get('account_id', 'N/A')}")
            print(f"  page_id: {row.get('page_id', 'N/A')}")
            print(f"  account_index: {row.get('account_index')}")
            print(f"  is_primary: {row.get('is_primary')}")
    else:
        print(f"\n=== {platform.upper()} === Sin datos")
