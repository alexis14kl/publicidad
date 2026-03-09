@echo off
setlocal EnableExtensions
title DICloak + Auto abrir perfil ChatGPT

rem --- Cargar rutas centralizadas ---
call "%~dp0cfg\rutas.bat"

set "PROFILE_NAME=#1 Chat Gpt PRO"
set "PROFILE_DEBUG_PORT_HINT="
set "RUN_MODE="
set "OPENAPI_PORT_HINT="
set "OPENAPI_SECRET_HINT="
set "CDP_URL=http://127.0.0.1:9333"
set "FORCE_LAUNCH_STARTED=0"
set "PROFILE_WARMUP_SEC=20"
if not "%~1"=="" set "PROFILE_NAME=%~1"

rem --- Consultar memoria de perfiles para evitar abrir uno vencido ---
for /f "usebackq delims=" %%P in (`python "%~dp0perfil\profile_memory.py" --best-profile "#1 Chat Gpt PRO" "#4 Chat Gpt Plus" "#2 Chat Gpt PRO"`) do (
    if not "%%P"=="" set "PROFILE_NAME=%%P"
)
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

%LOG% step "1/10" "Generando prompt inicial con IA de n8n..."
where python >nul 2>nul
if errorlevel 1 (
  %LOG% warn "Python no esta disponible en PATH. Se conserva el prompt actual."
) else (
  if not exist "%N8N_PROMPT_CLIENT_PY%" (
    %LOG% warn "No existe cliente n8n: %N8N_PROMPT_CLIENT_PY%. Se conserva el prompt actual."
  ) else (
    if not exist "%PROMPT_SEED_FILE%" (
      %LOG% warn "No existe brief base: %PROMPT_SEED_FILE%. Se conserva el flujo actual."
    ) else (
      python "%N8N_PROMPT_CLIENT_PY%" --idea-file "%PROMPT_SEED_FILE%" --output "%PROMPT_FILE%"
      if errorlevel 1 (
        %LOG% warn "No se pudo regenerar el prompt con n8n. Se usara el contenido actual de %PROMPT_FILE%."
      ) else (
        %LOG% ok "Prompt regenerado en %PROMPT_FILE%."
        if exist "%N8N_POST_TEXT_CLIENT_PY%" (
          python "%N8N_POST_TEXT_CLIENT_PY%" --prompt-file "%PROMPT_FILE%" --output "%POST_TEXT_FILE%"
          if errorlevel 1 (
            %LOG% warn "No se pudo regenerar el texto de publicacion con n8n. Se conserva el caption actual."
          ) else (
            %LOG% ok "Caption regenerado en %POST_TEXT_FILE%."
          )
        ) else (
          %LOG% warn "No existe cliente de caption n8n: %N8N_POST_TEXT_CLIENT_PY%."
        )
      )
    )
  )
)

%LOG% step "2/10" "Taskkill directo (forzado)..."
taskkill /F /IM DICloak.exe >nul 2>nul
taskkill /F /IM ginsbrowser.exe >nul 2>nul
taskkill /F /IM chrome.exe >nul 2>nul
timeout /t 1 /nobreak >nul

%LOG% step "3/10" "Limpieza avanzada de servicios/procesos DICloak..."
python "%RUN_WITH_PROGRESS_PY%" "Limpiando procesos DICloak..." powershell -NoProfile -ExecutionPolicy Bypass -File "%KILLER_PS1%" -Port 9333 -TimeoutSec 60
if errorlevel 1 (
  %LOG% error "No se pudo cerrar completamente DICloak."
  %LOG% info "Ejecuta la CMD como Administrador y vuelve a intentar."
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

%LOG% step "4/10" "Iniciando DICloak en modo debug (9333)..."
start "" "%DICLOAK_EXE%" --remote-debugging-port=9333 --remote-allow-origins=*

%LOG% step "5/10" "Esperando CDP en puerto 9333..."
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
  %LOG% warn "CDP no respondio en %CDP_URL%. Intentando puerto real desde DevToolsActivePort..."
  set "ACTIVE_PORT="
  if exist "%APPDATA%\DICloak\DevToolsActivePort" (
    for /f "usebackq delims=" %%A in ("%APPDATA%\DICloak\DevToolsActivePort") do (
      if not defined ACTIVE_PORT set "ACTIVE_PORT=%%A"
    )
  )
  if defined ACTIVE_PORT (
    set "CDP_URL=http://127.0.0.1:%ACTIVE_PORT%"
    %LOG% info "Puerto detectado: %ACTIVE_PORT%"
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
      %LOG% error "CDP tampoco respondio en %CDP_URL%."
      if /I not "%NO_PAUSE%"=="1" pause
      exit /b 1
    )
  ) else (
    %LOG% error "No se encontro DevToolsActivePort para detectar puerto real."
    if /I not "%NO_PAUSE%"=="1" pause
    exit /b 1
  )
)

%LOG% step "6/10" "Verificando Node.js..."
where node >nul 2>nul
if errorlevel 1 (
  %LOG% error "Node.js no esta disponible en PATH."
  %LOG% info "Instala Node o ejecuta manualmente:"
  %LOG% info "node %SCRIPT_PATH% %PROFILE_NAME% %CDP_URL%"
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

%LOG% step "7/10" "Abriendo perfil: %PROFILE_NAME%"
set "PROFILE_MAYBE_OPEN=0"
python "%RUN_WITH_PROGRESS_PY%" "Abriendo perfil en DiCloak..." node "%SCRIPT_PATH%" "%PROFILE_NAME%" "%CDP_URL%" "%PROFILE_DEBUG_PORT_HINT%" "%OPENAPI_PORT_HINT%" "%RUN_MODE%" "%OPENAPI_SECRET_HINT%"
if not errorlevel 1 (
  set "PROFILE_MAYBE_OPEN=1"
  rem OK flujo principal
) else (
  %LOG% warn "Flujo principal fallo. Intentando apertura forzada por CDP..."
  if not exist "%FORCE_OPEN_JS%" (
    %LOG% warn "No existe fallback CDP: %FORCE_OPEN_JS%"
  ) else (
    node "%FORCE_OPEN_JS%" "%PROFILE_NAME%" "%CDP_URL%"
    if not errorlevel 1 (
      set "PROFILE_MAYBE_OPEN=1"
    )
  )

  if "%PROFILE_MAYBE_OPEN%"=="0" (
    tasklist | findstr /i "ginsbrowser.exe" >nul
    if not errorlevel 1 (
      %LOG% info "Se detecto ginsbrowser activo; se continua con forzado CDP."
      set "PROFILE_MAYBE_OPEN=1"
    )
  )

  if "%PROFILE_MAYBE_OPEN%"=="0" (
    echo.
    %LOG% error "No se pudo abrir el perfil automaticamente."
    %LOG% info "Revisa los PNG de debug creados en: %DEBUG_DIR%"
    goto :FAIL_OPEN_PROFILE
  )
)

%LOG% step "7.5/10" "Esperando hidratacion de sesion del perfil..."
python "%RUN_WITH_PROGRESS_PY%" "Esperando %PROFILE_WARMUP_SEC%s para estabilizar sesion del perfil..." timeout /t %PROFILE_WARMUP_SEC% /nobreak

if exist "%FORCE_CDP_PS1%" (
  %LOG% step "8/10" "Ejecutando automatizacion clave de depuracion de perfil..."
  %LOG% info "FORCE_CDP_PS1 = %FORCE_CDP_PS1%"
  if "%FORCE_LAUNCH_STARTED%"=="0" (
    if exist "%FORCE_CDP_LAUNCHER_BAT%" (
      %LOG% info "Abriendo segunda consola con launcher: %FORCE_CDP_LAUNCHER_BAT%"
      start "Forzar CDP Perfil (10s + reforce)" "%FORCE_CDP_LAUNCHER_BAT%"
      set "FORCE_LAUNCH_STARTED=1"
    ) else (
      %LOG% warn "No existe launcher bat. Fallback a PowerShell directo..."
      %LOG% info "%PS_EXE% -NoProfile -ExecutionPolicy Bypass -File %FORCE_CDP_PS1% -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow"
      start "Forzar CDP Perfil" "%PS_EXE%" -NoExit -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
      set "FORCE_LAUNCH_STARTED=1"
    )
  ) else (
    %LOG% info "Launcher CDP ya estaba iniciado; no se relanza."
  )
  python "%RUN_WITH_PROGRESS_PY%" "Esperando debugPort en cdp_debug_info.json (hasta 45s)..." "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$path=Join-Path $env:APPDATA 'DICloak\cdp_debug_info.json'; $ok=$false; 1..45 | ForEach-Object { try { if(Test-Path $path){ $j=Get-Content $path -Raw | ConvertFrom-Json; foreach($p in $j.PSObject.Properties){ if($p.Value.debugPort){ $ok=$true; break } } } } catch {}; if($ok){ break }; Start-Sleep -Seconds 1 }; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    %LOG% warn "No se detecto debugPort dentro de la espera."
  ) else (
    %LOG% ok "debugPort detectado en cdp_debug_info.json."
  )
) else (
  %LOG% warn "No existe %FORCE_CDP_PS1%. Omitiendo forzado CDP real."
)

if exist "%GET_DEBUG_PORT_PS1%" (
  %LOG% step "9/10" "Detectando puerto real de perfil y abriendo /json..."
  for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%GET_DEBUG_PORT_PS1%" -TimeoutSec 120 -OpenInProfile`) do (
    %LOG% debug "%%L"
  )
) else (
  %LOG% warn "No existe %GET_DEBUG_PORT_PS1%. Omitiendo apertura de /json en perfil real."
)

%LOG% step "10/10" "Perfil abierto: %PROFILE_NAME%"
if /I not "%NO_PAUSE%"=="1" pause
endlocal
exit /b 0

:FAIL_OPEN_PROFILE
if /I not "%NO_PAUSE%"=="1" pause
endlocal
exit /b 1
