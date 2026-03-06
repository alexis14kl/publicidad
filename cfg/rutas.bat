@echo off
rem =============================================
rem  Rutas centralizadas del proyecto
rem  Todas relativas a ROOT_DIR (raiz del proyecto)
rem =============================================

set "ROOT_DIR=%~dp0.."
set "CFG_DIR=%ROOT_DIR%\cfg"
set "INICIO_DIR=%ROOT_DIR%\inicio"
set "PERFIL_DIR=%ROOT_DIR%\perfil"
set "CDP_DIR=%ROOT_DIR%\cdp"
set "PROMPT_DIR=%ROOT_DIR%\prompt"
set "SERVER_DIR=%ROOT_DIR%\server"
set "UTILS_DIR=%ROOT_DIR%\utils"
set "DEBUG_DIR=%ROOT_DIR%\debug"
set "DOCS_DIR=%ROOT_DIR%\docs"

rem --- Scripts ---
set "KILLER_PS1=%INICIO_DIR%\cerrar_dicloak_avanzado.ps1"
set "SCRIPT_PATH=%PERFIL_DIR%\abrir_perfil_dicloak.js"
set "FORCE_OPEN_JS=%PERFIL_DIR%\force_open_profile_cdp.js"
set "FORCE_CDP_PS1=%CDP_DIR%\forzar_cdp_perfil_dicloak.ps1"
set "FORCE_CDP_LAUNCHER_BAT=%CDP_DIR%\forzar_cdp_post_apertura.bat"
set "GET_DEBUG_PORT_PS1=%CDP_DIR%\obtener_puerto_perfil_cdp.ps1"
set "PROMPT_AUTOMATION_PY=%PROMPT_DIR%\page_pronmt.py"

rem --- Datos ---
set "PROMPT_FILE=%UTILS_DIR%\prontm.txt"

rem --- Ejecutables ---
set "DICLOAK_EXE=C:\Program Files\DICloak\DICloak.exe"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
