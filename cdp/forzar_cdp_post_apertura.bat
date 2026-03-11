@echo off
setlocal EnableExtensions
title Forzar CDP Perfil (Post Apertura)

rem --- Cargar rutas centralizadas ---
call "%~dp0..\cfg\rutas.bat"

rem --- MODO DESARROLLO: poner DEV_MODE=1 para que no cierre perfil ni consola ---
if not defined DEV_MODE set "DEV_MODE=0"

set "CDP_INFO_JSON=%APPDATA%\DICloak\cdp_debug_info.json"

set "HAS_DEBUG_PORT=0"
set "CHECK_DEBUG_CMD=$path='%CDP_INFO_JSON%'; $ok=$false; try { if(Test-Path $path){ $j=Get-Content $path -Raw | ConvertFrom-Json; foreach($p in $j.PSObject.Properties){ if($p.Value.debugPort){ $ok=$true; break } } } } catch {}; if($ok){exit 0}else{exit 1}"

%LOG% info "Launcher post-apertura iniciado."
python "%RUN_WITH_PROGRESS_PY%" "Esperando 10s antes de forzar CDP del perfil..." timeout /t 10 /nobreak

if not exist "%FORCE_CDP_PS1%" (
  %LOG% error "No existe script: %FORCE_CDP_PS1%"
  %LOG% info "No se puede ejecutar forzado CDP."
  endlocal
  exit /b 1
)

%LOG% info "Ejecutando forzado CDP..."
%LOG% debug "powershell -NoProfile -ExecutionPolicy Bypass -File %FORCE_CDP_PS1% -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow"
python "%RUN_WITH_PROGRESS_PY%" "Forzando CDP del perfil..." "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow

if errorlevel 1 (
  %LOG% warn "El forzado CDP devolvio error."
) else (
  %LOG% ok "Forzado CDP ejecutado."
)

%LOG% info "Verificando si ya existe debugPort en cdp_debug_info.json..."
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "%CHECK_DEBUG_CMD%"
if not errorlevel 1 (
  set "HAS_DEBUG_PORT=1"
)

if "%HAS_DEBUG_PORT%"=="0" (
  %LOG% warn "No se detecto debugPort tras primer intento. Reforce en 10 segundos..."
  python "%RUN_WITH_PROGRESS_PY%" "Esperando 10s antes de reforzar CDP..." timeout /t 10 /nobreak
  python "%RUN_WITH_PROGRESS_PY%" "Reforzando CDP del perfil..." "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
  if errorlevel 1 (
    %LOG% warn "Reforce devolvio error."
  ) else (
    %LOG% ok "Reforce ejecutado."
  )
)

if exist "%PROMPT_AUTOMATION_PY%" (
  %LOG% info "Ejecutando automatizacion de pegado de prompt por CDP..."
  python "%RUN_WITH_PROGRESS_PY%" "Pegando prompt en ChatGPT..." python "%PROMPT_AUTOMATION_PY%"
  if errorlevel 1 (
    %LOG% warn "No se pudo ejecutar page_pronmt.py correctamente."
  ) else (
    %LOG% ok "promnt pegado con exito"
    if exist "%DOWNLOAD_GENERATED_IMAGE_PY%" (
      python "%RUN_WITH_PROGRESS_PY%" "Esperando y descargando imagen generada..." python "%DOWNLOAD_GENERATED_IMAGE_PY%" 9225
      if errorlevel 1 (
        %LOG% warn "No se pudo descargar la imagen generada."
      ) else (
        %LOG% ok "imagen descargada con exito"
        if exist "%PUBLIC_IMG_PY%" (
          python "%RUN_WITH_PROGRESS_PY%" "Enviando imagen a n8n para publicacion..." python "%PUBLIC_IMG_PY%"
          if errorlevel 1 (
            %LOG% warn "No se pudo enviar la imagen local a n8n."
          ) else (
            %LOG% ok "imagen enviada a n8n con exito"
            goto :CLEANUP_AND_EXIT
          )
        ) else (
          %LOG% warn "No existe script de publicacion local a n8n: %PUBLIC_IMG_PY%"
        )
      )
    ) else (
      %LOG% warn "No existe script de descarga: %DOWNLOAD_GENERATED_IMAGE_PY%"
    )
  )
) else (
  %LOG% warn "No existe script de automatizacion: %PROMPT_AUTOMATION_PY%"
)

%LOG% ok "Proceso completado. Cerrando esta consola..."
endlocal
exit /b 0

:CLEANUP_AND_EXIT
rem =========================================================================
rem  CLEANUP POST-CICLO
rem  Este bloque se ejecuta tras publicar la imagen exitosamente.
rem  1) Cierra pestanas de chatgpt.com via CDP para que la proxima apertura
rem     del perfil no restaure chats viejos (evita prompt duplicado visual).
rem  2) Mata ginsbrowser.exe (navegador del perfil DICloak).
rem  3) Mata DICloak.exe (gestor de perfiles).
rem  4) Ejecuta limpieza avanzada (servicios, procesos hijo, puerto 9333).
rem  5) Cierra esta ventana de consola.
rem
rem  MODO DESARROLLO: para depurar sin que se cierre todo, comenta las
rem  lineas de taskkill y el "exit" final. Asi el perfil y la consola
rem  quedan abiertos para inspeccion manual.
rem =========================================================================

rem --- Paso 1: Cerrar pestanas de ChatGPT via CDP (evita restauracion de sesion) ---
%LOG% info "Limpiando sesion del perfil antes de cerrar..."
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "$cdp=Join-Path $env:APPDATA 'DICloak\cdp_debug_info.json';" ^
  "if (!(Test-Path $cdp)) { exit 0 };" ^
  "try {" ^
  "  $j=Get-Content $cdp -Raw | ConvertFrom-Json;" ^
  "  $port=$null;" ^
  "  foreach($p in $j.PSObject.Properties){ if($p.Value.debugPort){ $port=[int]$p.Value.debugPort; break } };" ^
  "  if (!$port) { exit 0 };" ^
  "  $tabs=(Invoke-WebRequest -UseBasicParsing -Uri \"http://127.0.0.1:$port/json/list\" -TimeoutSec 3).Content | ConvertFrom-Json;" ^
  "  foreach($t in $tabs){" ^
  "    if ($t.type -eq 'page' -and $t.url -match 'chatgpt'){" ^
  "      $ws=$t.webSocketDebuggerUrl;" ^
  "      if ($ws) {" ^
  "        try { Invoke-WebRequest -UseBasicParsing -Uri \"http://127.0.0.1:$port/json/close/$($t.id)\" -TimeoutSec 2 | Out-Null } catch {}" ^
  "      }" ^
  "    }" ^
  "  }" ^
  "} catch {};" ^
  "exit 0" >nul 2>nul

if /I "%DEV_MODE%"=="1" (
  %LOG% ok "=== MODO DESARROLLO: perfil y consola quedan abiertos ==="
  %LOG% info "Para cerrar manualmente: taskkill /F /IM ginsbrowser.exe && taskkill /F /IM DICloak.exe"
  endlocal
  exit /b 0
)

rem --- Paso 2: Matar navegador del perfil (ginsbrowser = Chromium de DICloak) ---
%LOG% info "Cerrando DiCloak, perfil y ginsbrowser para liberar memoria..."
taskkill /F /IM ginsbrowser.exe >nul 2>nul

rem --- Paso 3: Matar DICloak (gestor de perfiles antidetect) ---
taskkill /F /IM DICloak.exe >nul 2>nul

rem --- Paso 4: Limpieza avanzada (servicios, hijos, puerto 9333) ---
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%KILLER_PS1%" -Quiet

%LOG% ok "DiCloak y perfil cerrados. Worker sigue en background."

rem --- Paso 5: Cerrar esta ventana de consola ---
%LOG% ok "Proceso completado. Cerrando consola..."
endlocal
exit

:RUN_PYTHON_SCRIPT
setlocal
set "PYTHON_SCRIPT_FILE=%~1"
set "PYTHON_SCRIPT_ARG1=%~2"

where python >nul 2>nul
if not errorlevel 1 (
  if "%PYTHON_SCRIPT_ARG1%"=="" (
    python "%PYTHON_SCRIPT_FILE%"
  ) else (
    python "%PYTHON_SCRIPT_FILE%" "%PYTHON_SCRIPT_ARG1%"
  )
  if not errorlevel 1 (
    endlocal & exit /b 0
  )
)

if "%PYTHON_SCRIPT_ARG1%"=="" (
  py -3 "%PYTHON_SCRIPT_FILE%"
) else (
  py -3 "%PYTHON_SCRIPT_FILE%" "%PYTHON_SCRIPT_ARG1%"
)
set "RUN_RC=%ERRORLEVEL%"
endlocal & exit /b %RUN_RC%
