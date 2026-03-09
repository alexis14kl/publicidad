@echo off
setlocal EnableExtensions
title Instalar inicio automatico del worker local

call "%~dp0cfg\rutas.bat"

set "TASK_NAME=NoyeCodeBotPoller"
set "VBS_LAUNCHER=%ROOT_DIR%\iniciar_poller_oculto.vbs"

if not exist "%VBS_LAUNCHER%" (
  echo [ERROR] No existe el lanzador oculto: "%VBS_LAUNCHER%"
  exit /b 1
)

echo [INFO] Creando tarea programada de inicio de sesion...
schtasks /Create /F /SC ONLOGON /TN "%TASK_NAME%" /TR "wscript.exe \"%VBS_LAUNCHER%\"" /DELAY 0000:30 >nul
if errorlevel 1 (
  echo [ERROR] No se pudo crear la tarea programada.
  echo [INFO] Prueba ejecutando esta CMD como administrador si Windows bloquea la creacion.
  exit /b 1
)

echo [OK] Tarea creada: %TASK_NAME%
echo [INFO] El worker local arrancara oculto al iniciar sesion.
echo [INFO] Para probarlo ahora, cierra el worker actual y ejecuta:
echo        wscript.exe "%VBS_LAUNCHER%"
exit /b 0
