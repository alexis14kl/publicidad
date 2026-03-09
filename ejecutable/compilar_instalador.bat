@echo off
title Compilar instalador noyecodito_fb
echo ============================================
echo   Compilador de instalador - noyecodito_fb
echo ============================================
echo.

rem --- Buscar Inno Setup ---
set "ISCC="

rem Ruta por defecto Inno Setup 6
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
)

if "%ISCC%"=="" (
    echo [ERROR] Inno Setup 6 no encontrado.
    echo.
    echo Descargalo gratis desde: https://jrsoftware.org/isdl.php
    echo Instala Inno Setup 6 y vuelve a ejecutar este script.
    echo.
    pause
    exit /b 1
)

echo [OK] Inno Setup encontrado: %ISCC%
echo.

rem --- Verificar icono ---
if not exist "%~dp0icon\noyecodito.ico" (
    echo [AVISO] No existe icon\noyecodito.ico
    echo         Genera un icono .ico y colocalo en:
    echo         %~dp0icon\noyecodito.ico
    echo.
    echo         Puedes usar https://convertio.co/es/png-ico/
    echo         para convertir un PNG a ICO.
    echo.
    echo         Continuando sin icono personalizado...
    echo.

    rem Crear .iss temporal sin referencia al icono
    powershell -NoProfile -Command "(Get-Content '%~dp0noyecodito_fb.iss') -replace 'SetupIconFile=icon\\noyecodito.ico', ';SetupIconFile=icon\\noyecodito.ico' -replace 'IconFilename: \"{app}\\ejecutable\\icon\\noyecodito.ico\";', ';IconFilename: \"{app}\\ejecutable\\icon\\noyecodito.ico\";' | Set-Content '%~dp0noyecodito_fb_temp.iss' -Encoding UTF8"
    "%ISCC%" "%~dp0noyecodito_fb_temp.iss"
    del "%~dp0noyecodito_fb_temp.iss" >nul 2>&1
) else (
    echo [OK] Icono encontrado: icon\noyecodito.ico
    echo.
    "%ISCC%" "%~dp0noyecodito_fb.iss"
)

echo.
if %ERRORLEVEL% EQU 0 (
    echo ============================================
    echo   COMPILACION EXITOSA
    echo ============================================
    echo.
    echo   Instalador generado: noyecodito_fb_setup.exe
    echo   Ubicacion: %~dp0
    echo.
) else (
    echo ============================================
    echo   ERROR EN LA COMPILACION
    echo ============================================
    echo   Revisa los errores arriba.
    echo.
)

pause
