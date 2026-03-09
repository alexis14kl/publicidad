#!/usr/bin/env bash
set -euo pipefail

HOME_DIR="${HOME:-}"
declare -a CANDIDATES=(
  "${DICLOAK_CDP_INFO_PATH:-}"
  "$HOME_DIR/Library/Application Support/DICloak/cdp_debug_info.json"
  "$HOME_DIR/Library/Application Support/dicloak/cdp_debug_info.json"
  "$HOME_DIR/.config/DICloak/cdp_debug_info.json"
)

FOUND=""
for f in "${CANDIDATES[@]}"; do
  [ -n "$f" ] || continue
  if [ -f "$f" ]; then
    FOUND="$f"
    break
  fi
done

if [ -z "$FOUND" ]; then
  echo "[ERROR] No se encontro cdp_debug_info.json en rutas conocidas de macOS."
  exit 1
fi

echo "[OK] cdp_debug_info.json: $FOUND"
PORT="$(python3 - "$FOUND" <<'PY'
import json,sys
p=sys.argv[1]
try:
    data=json.load(open(p,'r',encoding='utf-8'))
except Exception:
    print("")
    raise SystemExit(0)
rows=[]
for env_id,val in (data or {}).items():
    if not isinstance(val,dict):
        continue
    port=val.get("debugPort")
    ts=val.get("timestamp",0)
    if isinstance(port,int) and 1 <= port <= 65535:
        rows.append((ts,port,env_id))
rows.sort(reverse=True)
print(rows[0][1] if rows else "")
PY
)"

if [ -n "$PORT" ]; then
  echo "[OK] Puerto CDP perfil (ultimo timestamp): $PORT"
  echo "CDP_URL=http://127.0.0.1:$PORT"
else
  echo "[WARN] No se pudo inferir debugPort desde el JSON."
fi
