@echo off
setlocal EnableExtensions
title Instalar inicio automatico del worker local

call "%~dp0cfg\rutas.bat"

set "TASK_NAME=NoyeCodeBotPoller"
set "VBS_LAUNCHER=%ROOT_DIR%\iniciar_poller_oculto.vbs"
set "PS1_LAUNCHER=%ROOT_DIR%\iniciar_poller_oculto.ps1"

if not exist "%PS1_LAUNCHER%" (
  echo [ERROR] No existe el lanzador oculto: "%PS1_LAUNCHER%"
  exit /b 1
)

echo [INFO] Creando tarea programada de inicio de sesion...
schtasks /Create /F /SC ONLOGON /TN "%TASK_NAME%" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%PS1_LAUNCHER%\"" /DELAY 0000:30 >nul
if errorlevel 1 (
  echo [ERROR] No se pudo crear la tarea programada.
  echo [INFO] Prueba ejecutando esta CMD como administrador si Windows bloquea la creacion.
  exit /b 1
)

echo [OK] Tarea creada: %TASK_NAME%
echo [INFO] El worker local arrancara oculto al iniciar sesion.
echo [INFO] Para probarlo ahora, cierra el worker actual y ejecuta:
echo        powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1_LAUNCHER%"
exit /b 0
