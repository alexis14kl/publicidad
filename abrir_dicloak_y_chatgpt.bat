@echo off
setlocal EnableExtensions
title DICloak + Auto abrir perfil ChatGPT

set "DICLOAK_EXE=C:\Program Files\DICloak\DICloak.exe"
set "PROFILE_NAME=#1 Chat Gpt PRO"
set "PROFILE_DEBUG_PORT_HINT="
set "RUN_MODE="
set "OPENAPI_PORT_HINT="
set "OPENAPI_SECRET_HINT="
set "SCRIPT_PATH=%~dp0abrir_perfil_dicloak.js"
set "FORCE_OPEN_JS=%~dp0force_open_profile_cdp.js"
set "KILLER_PS1=%~dp0cerrar_dicloak_avanzado.ps1"
set "GET_DEBUG_PORT_PS1=%~dp0obtener_puerto_perfil_cdp.ps1"
set "FORCE_CDP_PS1=%~dp0forzar_cdp_perfil_dicloak.ps1"
set "CDP_URL=http://127.0.0.1:9333"
if not "%~1"=="" set "PROFILE_NAME=%~1"
if not "%~2"=="" set "PROFILE_DEBUG_PORT_HINT=%~2"
if not "%~3"=="" set "RUN_MODE=%~3"
if not "%~4"=="" set "OPENAPI_PORT_HINT=%~4"
if not "%~5"=="" set "OPENAPI_SECRET_HINT=%~5"

if not exist "%DICLOAK_EXE%" (
  echo [ERROR] No existe DICloak en: "%DICLOAK_EXE%"
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

if not exist "%KILLER_PS1%" (
  echo [ERROR] No existe script de limpieza: "%KILLER_PS1%"
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [1/7] Taskkill directo (forzado)...
taskkill /F /IM DICloak.exe >nul 2>nul
taskkill /F /IM ginsbrowser.exe >nul 2>nul
taskkill /F /IM chrome.exe >nul 2>nul
timeout /t 1 /nobreak >nul

echo [2/7] Limpieza avanzada de servicios/procesos DICloak...
powershell -NoProfile -ExecutionPolicy Bypass -File "%KILLER_PS1%" -Port 9333 -TimeoutSec 60
if errorlevel 1 (
  echo [ERROR] No se pudo cerrar completamente DICloak.
  echo Ejecuta la CMD como Administrador y vuelve a intentar.
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [3/7] Iniciando DICloak en modo debug (9333)...
start "" "%DICLOAK_EXE%" --remote-debugging-port=9333 --remote-allow-origins=*

echo [4/7] Esperando CDP en puerto 9333...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ok=$false;" ^
  "1..90 | ForEach-Object {" ^
  "  try {" ^
  "    $r=Invoke-WebRequest -UseBasicParsing '%CDP_URL%/json/version' -TimeoutSec 2;" ^
  "    if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300 -and $r.Content -match 'webSocketDebuggerUrl'){ $ok=$true; break }" ^
  "  } catch {}" ^
  "  Start-Sleep -Seconds 1" ^
  "};" ^
  "if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  echo [WARN] CDP no respondio en %CDP_URL%. Intentando puerto real desde DevToolsActivePort...
  set "ACTIVE_PORT="
  if exist "%APPDATA%\DICloak\DevToolsActivePort" (
    for /f "usebackq delims=" %%A in ("%APPDATA%\DICloak\DevToolsActivePort") do (
      if not defined ACTIVE_PORT set "ACTIVE_PORT=%%A"
    )
  )
  if defined ACTIVE_PORT (
    set "CDP_URL=http://127.0.0.1:%ACTIVE_PORT%"
    echo [INFO] Puerto detectado: %ACTIVE_PORT%
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ok=$false;" ^
      "1..45 | ForEach-Object {" ^
      "  try {" ^
      "    $r=Invoke-WebRequest -UseBasicParsing '%CDP_URL%/json/version' -TimeoutSec 2;" ^
      "    if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300 -and $r.Content -match 'webSocketDebuggerUrl'){ $ok=$true; break }" ^
      "  } catch {}" ^
      "  Start-Sleep -Seconds 1" ^
      "};" ^
      "if($ok){exit 0}else{exit 1}"
    if errorlevel 1 (
      echo [ERROR] CDP tampoco respondio en %CDP_URL%.
      if /I not "%NO_PAUSE%"=="1" pause
      exit /b 1
    )
  ) else (
    echo [ERROR] No se encontro DevToolsActivePort para detectar puerto real.
    if /I not "%NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

echo [5/7] Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta disponible en PATH.
  echo Instala Node o ejecuta manualmente:
  echo node "%SCRIPT_PATH%" "%PROFILE_NAME%" "%CDP_URL%"
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo [6/9] Abriendo perfil: %PROFILE_NAME%
node "%SCRIPT_PATH%" "%PROFILE_NAME%" "%CDP_URL%" "%PROFILE_DEBUG_PORT_HINT%" "%OPENAPI_PORT_HINT%" "%RUN_MODE%" "%OPENAPI_SECRET_HINT%"
if not errorlevel 1 (
  rem OK flujo principal
) else (
  echo [WARN] Flujo principal fallo. Intentando apertura forzada por CDP...
  if not exist "%FORCE_OPEN_JS%" (
    echo [ERROR] No existe fallback CDP: "%FORCE_OPEN_JS%"
    goto :FAIL_OPEN_PROFILE
  )
  node "%FORCE_OPEN_JS%" "%PROFILE_NAME%" "%CDP_URL%"
  if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo abrir el perfil automaticamente.
    echo Revisa los PNG de debug creados en: %~dp0
    goto :FAIL_OPEN_PROFILE
  )
)

if exist "%FORCE_CDP_PS1%" (
  echo [7/9] Forzando CDP real de perfil y actualizando cdp_debug_info.json...
  set "FORCE_CDP_OUT=%TEMP%\\dicloak_force_cdp_%RANDOM%.log"
  powershell -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 90 -OpenDebugWindow > "%FORCE_CDP_OUT%" 2>&1
  set "FORCE_CDP_RC=%ERRORLEVEL%"
  for /f "usebackq delims=" %%L in ("%FORCE_CDP_OUT%") do echo [DEBUG] %%L
  del /q "%FORCE_CDP_OUT%" >nul 2>nul
  if not "%FORCE_CDP_RC%"=="0" (
    echo [WARN] No se pudo forzar CDP real automaticamente (RC=%FORCE_CDP_RC%).
  )
) else (
  echo [WARN] No existe "%FORCE_CDP_PS1%". Omitiendo forzado CDP real.
)

if exist "%GET_DEBUG_PORT_PS1%" (
  echo [8/9] Detectando puerto real de perfil y abriendo /json...
  for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%GET_DEBUG_PORT_PS1%" -TimeoutSec 120 -OpenInProfile`) do (
    echo [DEBUG] %%L
  )
) else (
  echo [WARN] No existe "%GET_DEBUG_PORT_PS1%". Omitiendo apertura de /json en perfil real.
)

echo [9/9] [OK] Perfil abierto: %PROFILE_NAME%
if /I not "%NO_PAUSE%"=="1" pause
endlocal
exit /b 0

:FAIL_OPEN_PROFILE
if /I not "%NO_PAUSE%"=="1" pause
endlocal
exit /b 1
