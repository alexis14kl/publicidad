# Proceso Completo: Apertura de Perfil DiCloak con Depuracion Correcta (CDP)

Este documento deja el flujo **estable** para abrir el perfil `#1 Chat Gpt PRO` y obtener CDP real del perfil.

## Objetivo

- Abrir DiCloak en modo debug de app.
- Abrir el perfil correcto.
- Obtener/forzar puerto CDP del perfil.
- Validar que `cdp_debug_info.json` tenga `debugPort`.

---

## Problema 1

### Sintoma

- DiCloak abre, el perfil parece abrir, pero `cdp_debug_info.json` queda en `{}`.
- No aparece puerto de depuracion real del perfil.

### Causa

- El navegador del perfil (`ginsbrowser.exe`) se abre **sin** `--remote-debugging-port`.
- El puerto `9333` corresponde a la app DiCloak (Electron), no siempre al perfil.

### Solucion

1. Abrir DiCloak en debug de app.
2. Abrir perfil.
3. Forzar CDP del perfil relanzando `ginsbrowser` con `--remote-debugging-port`.
4. Escribir/verificar `cdp_debug_info.json`.

---

## Problema 2

### Sintoma

- Error de UI al abrir perfil automatico (`checkbox_click_failed` o no da click en `Abrir perfil`).

### Causa

- La tabla cambia de estado/render y el selector UI falla intermitente.

### Solucion

- Usar fallback de apertura por CDP:
  - `force_open_profile_cdp.js`
- Luego forzar CDP real:
  - `forzar_cdp_perfil_dicloak.ps1`

---

## Archivos del flujo

- `abrir_dicloak_y_chatgpt.bat`
- `abrir_perfil_dicloak.js`
- `force_open_profile_cdp.js`
- `forzar_cdp_perfil_dicloak.ps1`
- `obtener_puerto_perfil_cdp.ps1`

---

## Flujo recomendado (paso a paso)

## Paso 1: ejecutar flujo principal

```bat
c:\Users\NyGsoft\Desktop\publicidad\abrir_dicloak_y_chatgpt.bat
```

Este flujo:
- cierra procesos residuales,
- levanta DiCloak en `9333`,
- intenta abrir perfil,
- usa fallback si falla UI,
- intenta detectar/abrir debug del perfil.

## Paso 2: forzar CDP real del perfil (si JSON sigue vacio)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "c:\Users\NyGsoft\Desktop\publicidad\forzar_cdp_perfil_dicloak.ps1" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
```

Salida esperada (ejemplo):

```text
DEBUG_PORT=9225
CDP_JSON_PATH=C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json
```

## Paso 3: validar JSON

```powershell
Get-Content "$env:APPDATA\DICloak\cdp_debug_info.json" -Raw
```

Debe contener algo como:

```json
{
  "1999581736218873857": {
    "debugPort": 9225,
    "webSocketUrl": "ws://127.0.0.1:9225/devtools/browser/....",
    "pid": 7452,
    "serialNumber": "41",
    "envId": "1999581736218873857"
  }
}
```

## Paso 4: validar endpoint CDP

```powershell
curl.exe http://127.0.0.1:9225/json/version
curl.exe http://127.0.0.1:9225/json/list
```

Si responde, el CDP real del perfil esta activo.

---

## Verificacion rapida de estado

## Ver si ginsbrowser tiene debug activo

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq 'ginsbrowser.exe' } |
  ForEach-Object {
    $has = [regex]::IsMatch([string]$_.CommandLine,'--remote-debugging-port(?:=|\s+)\d+','IgnoreCase')
    "PID=$($_.ProcessId) HAS_DEBUG=$has"
  }
```

Si sale `HAS_DEBUG=False` en todos, no hay CDP real de perfil.

---

## Checklist final

- `9333` responde: app DiCloak OK.
- Perfil abierto.
- `ginsbrowser` con `--remote-debugging-port`.
- `cdp_debug_info.json` con `debugPort`.
- `http://127.0.0.1:<debugPort>/json/version` responde.

---

## Comando unico recomendado (operativo)

Si quieres resolver rapido en una sola accion cuando falle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "c:\Users\NyGsoft\Desktop\publicidad\forzar_cdp_perfil_dicloak.ps1" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
```

Con eso fuerzas el CDP real y abres `http://127.0.0.1:9225/json` en el navegador del perfil.
