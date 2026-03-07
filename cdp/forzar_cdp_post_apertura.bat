@echo off
setlocal EnableExtensions
title Forzar CDP Perfil (Post Apertura)

rem --- Cargar rutas centralizadas ---
call "%~dp0..\cfg\rutas.bat"

set "CDP_INFO_JSON=%APPDATA%\DICloak\cdp_debug_info.json"

set "HAS_DEBUG_PORT=0"
set "CHECK_DEBUG_CMD=$path='%CDP_INFO_JSON%'; $ok=$false; try { if(Test-Path $path){ $j=Get-Content $path -Raw | ConvertFrom-Json; foreach($p in $j.PSObject.Properties){ if($p.Value.debugPort){ $ok=$true; break } } } } catch {}; if($ok){exit 0}else{exit 1}"

%LOG% info "Launcher post-apertura iniciado."
%LOG% info "Esperando 10 segundos antes de forzar CDP del perfil..."
timeout /t 10 /nobreak >nul

if not exist "%FORCE_CDP_PS1%" (
  %LOG% error "No existe script: %FORCE_CDP_PS1%"
  %LOG% info "No se puede ejecutar forzado CDP."
  endlocal
  exit /b 1
)

%LOG% info "Ejecutando forzado CDP..."
%LOG% debug "powershell -NoProfile -ExecutionPolicy Bypass -File %FORCE_CDP_PS1% -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow

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
  timeout /t 10 /nobreak >nul
  %LOG% info "Reforce CDP..."
  "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
  if errorlevel 1 (
    %LOG% warn "Reforce devolvio error."
  ) else (
    %LOG% ok "Reforce ejecutado."
  )
)

if exist "%PROMPT_AUTOMATION_PY%" (
  %LOG% info "Ejecutando automatizacion de pegado de prompt por CDP..."
  call :RUN_PYTHON_SCRIPT "%PROMPT_AUTOMATION_PY%"
  if errorlevel 1 (
    %LOG% warn "No se pudo ejecutar page_pronmt.py correctamente."
  ) else (
    %LOG% ok "promnt pegado con exito"
    if exist "%DOWNLOAD_GENERATED_IMAGE_PY%" (
      %LOG% info "Esperando y descargando imagen generada..."
      call :RUN_PYTHON_SCRIPT "%DOWNLOAD_GENERATED_IMAGE_PY%" 9225
      if errorlevel 1 (
        %LOG% warn "No se pudo descargar la imagen generada."
      ) else (
        %LOG% ok "imagen descargada con exito"
        if exist "%PUBLIC_IMG_PY%" (
          %LOG% info "Enviando imagen local a n8n para publicacion..."
          call :RUN_PYTHON_SCRIPT "%PUBLIC_IMG_PY%"
          if errorlevel 1 (
            %LOG% warn "No se pudo enviar la imagen local a n8n."
          ) else (
            %LOG% ok "imagen enviada a n8n con exito"
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
