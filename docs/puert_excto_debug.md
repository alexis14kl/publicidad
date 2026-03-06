# Puerto Exacto de Debug en DiCloak

Guia rapida para obtener el puerto **real** de depuracion (CDP) en DiCloak.

## 1) Puerto de la app DiCloak (Electron)

Este archivo siempre te dice el puerto de debug de la app:

`C:\Users\NyGsoft\AppData\Roaming\DICloak\DevToolsActivePort`

### Comando

```powershell
Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\DevToolsActivePort"
```

La **linea 1** es el puerto.  
Ejemplo actual: `9333`

### Verificar

```powershell
curl.exe http://127.0.0.1:9333/json/version
```

---

## 2) Puerto exacto del perfil (ginsbrowser)

En esta version, el puerto del perfil es dinamico (no fijo en 9225).  
El dato correcto queda en:

`C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json`

### Comando (leer todo)

```powershell
Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json"
```

Ese JSON trae:
- `debugPort`
- `webSocketUrl`
- `pid`
- `serialNumber`

Ejemplo real detectado:
- `envId`: `1999581736218873857`
- `debugPort`: `53890`

### Sacar solo el puerto

```powershell
$j = Get-Content "C:\Users\NyGsoft\AppData\Roaming\DICloak\cdp_debug_info.json" | ConvertFrom-Json
$envId = "1999581736218873857"   # cambia si quieres otro perfil
$port = $j.$envId.debugPort
$port
```

### Verificar ese puerto

```powershell
curl.exe http://127.0.0.1:53890/json/version
curl.exe http://127.0.0.1:53890/json/list
```

---

## 3) Fallback si no aparece en JSON

Si `cdp_debug_info.json` esta vacio o viejo:

1. Abre el perfil desde DiCloak.
2. Busca puertos en escucha del proceso `ginsbrowser.exe`.

```powershell
$gps = Get-Process ginsbrowser -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $gps -contains $_.OwningProcess } |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

3. Prueba el puerto candidato:

```powershell
curl.exe http://127.0.0.1:<PUERTO>/json/version
```

Si responde con `Browser`, ese es el puerto exacto.

---

## 4) Resumen corto

- **App DiCloak**: `DevToolsActivePort` (normalmente 9333).
- **Perfil real**: `cdp_debug_info.json` -> `debugPort` (dinamico, ej. 53890).
- **No usar 9225 como regla fija** en esta configuracion.
