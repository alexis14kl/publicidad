@echo off
setlocal EnableExtensions

call "%~dp0cfg\rutas.bat"

if not exist "%JOB_POLLER_PY%" exit /b 1

where python >nul 2>nul
if errorlevel 1 exit /b 1

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%" >nul 2>nul

if "%N8N_BASE_URL%"=="" set "N8N_BASE_URL=https://n8n-dev.noyecode.com"
if "%N8N_LOGIN_EMAIL%"=="" set "N8N_LOGIN_EMAIL=andersonbarbosadev@outlook.com"
if "%N8N_LOGIN_PASSWORD%"=="" set "N8N_LOGIN_PASSWORD=t5x]oIs{7=ISZ}sS"
if "%N8N_BOT_QUEUE_MODE%"=="" set "N8N_BOT_QUEUE_MODE=executions"
if "%N8N_BOT_EXECUTION_WORKFLOW_ID%"=="" set "N8N_BOT_EXECUTION_WORKFLOW_ID=5zKqthFIw2-FhYBIkCKnu"
if "%N8N_BOT_POLL_INTERVAL%"=="" set "N8N_BOT_POLL_INTERVAL=5"
if "%N8N_BOT_TIMEOUT%"=="" set "N8N_BOT_TIMEOUT=60"
if "%N8N_BOT_RUN_TIMEOUT%"=="" set "N8N_BOT_RUN_TIMEOUT=7200"
if "%N8N_BOT_WORKER_ID%"=="" set "N8N_BOT_WORKER_ID=%COMPUTERNAME%"

set "PYTHONUTF8=1"
set "NO_PAUSE=1"

echo [%date% %time%] starting job_poller >> "%JOB_POLLER_LOG%"
python "%JOB_POLLER_PY%" >> "%JOB_POLLER_LOG%" 2>&1
echo [%date% %time%] job_poller exited with code %ERRORLEVEL% >> "%JOB_POLLER_LOG%"

endlocal
exit /b %ERRORLEVEL%
