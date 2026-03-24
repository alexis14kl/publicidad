import subprocess
BIN = r"C:\Users\NyGsoft\Desktop\publicidad\bin\sqlite3.exe"
DB = r"C:\Users\NyGsoft\Desktop\publicidad\Backend\instagram.sqlite3"

NEW_TOKEN = "IGAAWqTCX6iEhBZAFlTaDNPcnhsSzdGMFV6TTZAYTmxXR1VlYnlvRS1hNV9wRDNkZAnZA5VEdDTjNTUVF6VWNJcU5CdFEwdEhIWE45c2tSNjByTkQyNGIxM3dIWXUxdHRHRDBpS1o0VWlwOGJHWnZArckxzRE5VVnZA5ZAGxsb0V3M0F3ZAwZDZD"

# Update token
SQL = f"UPDATE instagram_form SET token = '{NEW_TOKEN}' WHERE empresa_id = (SELECT id FROM empresas WHERE nombre = 'NoyeCode' LIMIT 1) AND account_index = 1;"
r = subprocess.run([BIN, DB, SQL], capture_output=True, text=True, timeout=5)
print("Update:", r.stdout or r.stderr or "OK")

# Verify
SQL2 = "SELECT e.nombre, i.token, i.account_id FROM instagram_form i JOIN empresas e ON e.id = i.empresa_id WHERE e.nombre = 'NoyeCode';"
r2 = subprocess.run([BIN, "-json", DB, SQL2], capture_output=True, text=True, timeout=5)
print("Verify:", r2.stdout)
