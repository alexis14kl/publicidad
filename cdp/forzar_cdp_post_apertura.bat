@echo off
setlocal EnableExtensions
title Forzar CDP Perfil (Post Apertura)

rem --- Cargar rutas centralizadas ---
call "%~dp0..\cfg\rutas.bat"

set "CDP_INFO_JSON=%APPDATA%\DICloak\cdp_debug_info.json"

set "HAS_DEBUG_PORT=0"
set "CHECK_DEBUG_CMD=$path='%CDP_INFO_JSON%'; $ok=$false; try { if(Test-Path $path){ $j=Get-Content $path -Raw | ConvertFrom-Json; foreach($p in $j.PSObject.Properties){ if($p.Value.debugPort){ $ok=$true; break } } } } catch {}; if($ok){exit 0}else{exit 1}"

echo [INFO] Launcher post-apertura iniciado.
echo [INFO] Esperando 10 segundos antes de forzar CDP del perfil...
timeout /t 10 /nobreak >nul

if not exist "%FORCE_CDP_PS1%" (
  echo [ERROR] No existe script: "%FORCE_CDP_PS1%"
  echo [INFO] No se puede ejecutar forzado CDP.
  endlocal
  exit /b 1
)

echo [INFO] Ejecutando:
echo [INFO] powershell -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow

if errorlevel 1 (
  echo [WARN] El forzado CDP devolvio error.
) else (
  echo [OK] Forzado CDP ejecutado.
)

echo [INFO] Verificando si ya existe debugPort en cdp_debug_info.json...
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "%CHECK_DEBUG_CMD%"
if not errorlevel 1 (
  set "HAS_DEBUG_PORT=1"
)

if "%HAS_DEBUG_PORT%"=="0" (
  echo [WARN] No se detecto debugPort tras primer intento. Reforce en 10 segundos...
  timeout /t 10 /nobreak >nul
  echo [INFO] Reforce: powershell -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
  "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%FORCE_CDP_PS1%" -PreferredPort 9225 -TimeoutSec 30 -OpenDebugWindow
  if errorlevel 1 (
    echo [WARN] Reforce devolvio error.
  ) else (
    echo [OK] Reforce ejecutado.
  )
)

if exist "%PROMPT_AUTOMATION_PY%" (
  echo [INFO] Ejecutando automatizacion de pegado de prompt por CDP...
  call :RUN_PYTHON_SCRIPT "%PROMPT_AUTOMATION_PY%"
  if errorlevel 1 (
    echo [WARN] No se pudo ejecutar page_pronmt.py correctamente.
  ) else (
    echo [OK] promnt pegado con exito
    if exist "%DOWNLOAD_GENERATED_IMAGE_PY%" (
      echo [INFO] Esperando y descargando imagen generada...
      call :RUN_PYTHON_SCRIPT "%DOWNLOAD_GENERATED_IMAGE_PY%" 9225
      if errorlevel 1 (
        echo [WARN] No se pudo descargar la imagen generada.
      ) else (
        echo [OK] imagen descargada con exito
      )
    ) else (
      echo [WARN] No existe script de descarga: "%DOWNLOAD_GENERATED_IMAGE_PY%"
    )
  )
) else (
  echo [WARN] No existe script de automatizacion: "%PROMPT_AUTOMATION_PY%"
)

echo [INFO] Proceso completado. Cerrando esta consola...
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
