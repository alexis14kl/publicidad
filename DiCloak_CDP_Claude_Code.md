# Conexion a DiCloak desde Claude Code via CDP (Actualizado)

Guia real y validada para controlar DiCloak/ginsbrowser por CDP.

Estado de esta guia: 2026-03-06.

---

## Arquitectura real

```text
Claude Code
   |
   |-- CDP App (DiCloak Electron): puerto dinamico guardado en DevToolsActivePort
   |
   |-- CDP Perfil (ginsbrowser): puerto dinamico por perfil guardado en cdp_debug_info.json
```

### Nota importante

- El enfoque de `9225` fijo no es confiable en esta configuracion.
- El puerto correcto del perfil se obtiene desde `cdp_debug_info.json`.

---

## Archivos clave

- `C:\Users\NyGsoft\AppData\Roaming\DICloak\DevToolsActivePort`
  - Puerto CDP de la app DiCloak (Electron), por ejemplo `9333`.
- `C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json`
  - Mapa `envId -> debugPort/webSocketUrl/pid/timestamp` del perfil.

---

## Paso 1: Abrir DiCloak con CDP habilitado

```powershell
# Cierra DiCloak
taskkill /F /IM DICloak.exe 2>$null

# Abre con debug
Start-Process "C:\Users\NyGsoft\AppData\Local\Programs\dicloak\DICloak.exe" -ArgumentList "--remote-debugging-port=9333","--remote-allow-origins=*"
```

---

## Paso 2: Confirmar puerto de la app DiCloak

```powershell
Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\DevToolsActivePort"
```

La linea 1 es el puerto de la app.

Verifica:

```powershell
curl.exe http://127.0.0.1:9333/json/version
```

Si responde JSON con `webSocketDebuggerUrl`, la app ya esta lista.

---

## Paso 3: Abrir el perfil en DiCloak

Abre tu perfil desde la UI de DiCloak (ejemplo: `#1 Chat Gpt PRO`).

---

## Paso 4: Obtener el puerto exacto del perfil

### Opcion A: por envId

```powershell
$j = Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json" | ConvertFrom-Json
$envId = "1999581736218873857"   # cambia por tu envId
$port = $j.$envId.debugPort
$ws   = $j.$envId.webSocketUrl
"PORT=$port"
"WS=$ws"
```

### Opcion B: ultimo perfil abierto (por timestamp)

```powershell
$j = Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json" | ConvertFrom-Json
$entries = $j.PSObject.Properties | ForEach-Object {
  [pscustomobject]@{
    envId      = $_.Name
    debugPort  = $_.Value.debugPort
    ws         = $_.Value.webSocketUrl
    pid        = $_.Value.pid
    timestamp  = $_.Value.timestamp
  }
}
$last = $entries | Sort-Object timestamp -Descending | Select-Object -First 1
$last
```

---

## Paso 5: Verificar CDP del perfil

Si el puerto resulto `53890`, prueba:

```powershell
curl.exe http://127.0.0.1:53890/json/version
curl.exe http://127.0.0.1:53890/json/list
```

Debe responder `Browser`, `webSocketDebuggerUrl` y la lista de pestanas.

---

## Paso 6: Usarlo desde automatizacion

### Playwright (Node.js)

```js
const { chromium } = require('playwright');

(async () => {
  const port = 53890; // puerto obtenido desde cdp_debug_info.json
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://chatgpt.com');
})();
```

---

## Troubleshooting

### 1) `cdp_debug_info.json` vacio o sin tu envId

- Asegurate de que el perfil este realmente abierto.
- Espera 2-5 segundos y vuelve a leer el JSON.
- Cierra y abre el perfil otra vez.

### 2) El puerto existe en JSON pero no responde

- El proceso pudo cerrarse y el JSON quedo viejo.
- Reabre el perfil y vuelve a leer `debugPort`.

### 3) Hay varios perfiles abiertos

- Cada perfil puede tener su propio puerto dinamico.
- Siempre usa el `envId` correcto en el JSON.

### 4) Sobre IFEO/9225 fijo

- Es un metodo legacy y requiere admin.
- En esta configuracion no es necesario para encontrar el puerto real.

---

## Resumen rapido

```powershell
# 1) Puerto de la app
Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\DevToolsActivePort"

# 2) Puerto real del perfil
Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json"

# 3) Verificacion del perfil (ejemplo)
curl.exe http://127.0.0.1:53890/json/version
curl.exe http://127.0.0.1:53890/json/list
```
