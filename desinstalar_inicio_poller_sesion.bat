@echo off
setlocal EnableExtensions
title Desinstalar inicio automatico del worker local

set "TASK_NAME=NoyeCodeBotPoller"

echo [INFO] Eliminando tarea programada...
schtasks /Delete /F /TN "%TASK_NAME%" >nul
if errorlevel 1 (
  echo [WARN] La tarea "%TASK_NAME%" no existe o no se pudo eliminar.
  exit /b 1
)

echo [OK] Tarea eliminada: %TASK_NAME%
exit /b 0
