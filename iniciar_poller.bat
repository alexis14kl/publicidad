@echo off
setlocal EnableExtensions
title Worker local n8n -> bot publicitario

call "%~dp0cfg\rutas.bat"

if not exist "%JOB_POLLER_PY%" (
  echo [ERROR] No existe el worker local: "%JOB_POLLER_PY%"
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python no esta disponible en PATH.
  if /I not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

if "%N8N_BASE_URL%"=="" set "N8N_BASE_URL=https://n8n-dev.noyecode.com"
if "%N8N_LOGIN_EMAIL%"=="" set "N8N_LOGIN_EMAIL=andersonbarbosadev@outlook.com"
if "%N8N_LOGIN_PASSWORD%"=="" set "N8N_LOGIN_PASSWORD=t5x]oIs{7=ISZ}sS"
if "%N8N_BOT_QUEUE_MODE%"=="" set "N8N_BOT_QUEUE_MODE=datatable"
if "%N8N_BOT_EXECUTION_WORKFLOW_ID%"=="" set "N8N_BOT_EXECUTION_WORKFLOW_ID=eW5SRNY5r4zfRjIqTw9eP"
if "%N8N_BOT_POLL_INTERVAL%"=="" set "N8N_BOT_POLL_INTERVAL=5"
if "%N8N_BOT_TIMEOUT%"=="" set "N8N_BOT_TIMEOUT=60"
if "%N8N_BOT_RUN_TIMEOUT%"=="" set "N8N_BOT_RUN_TIMEOUT=7200"
if "%N8N_BOT_WORKER_ID%"=="" set "N8N_BOT_WORKER_ID=%COMPUTERNAME%"

%LOG% step "1/3" "Configurando worker local..."
%LOG% info "queue_mode=%N8N_BOT_QUEUE_MODE%"
%LOG% info "n8n_base_url=%N8N_BASE_URL%"
%LOG% info "execution_workflow_id=%N8N_BOT_EXECUTION_WORKFLOW_ID%"
%LOG% info "poll_interval=%N8N_BOT_POLL_INTERVAL%s"
%LOG% info "worker_id=%N8N_BOT_WORKER_ID%"

%LOG% step "2/3" "Conectando con n8n y arrancando polling..."
python "%RUN_WITH_PROGRESS_PY%" "Iniciando worker local..." python "%JOB_POLLER_PY%" %*
set "EXIT_CODE=%ERRORLEVEL%"

%LOG% step "3/3" "Worker detenido."
if "%EXIT_CODE%"=="0" (
  %LOG% ok "Worker finalizado sin error."
) else (
  %LOG% error "El worker termino con codigo %EXIT_CODE%."
)

if /I not "%NO_PAUSE%"=="1" pause
endlocal
exit /b %EXIT_CODE%
