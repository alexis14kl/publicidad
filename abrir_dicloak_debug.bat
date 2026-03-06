@echo off
setlocal
title DICloak Debug CMD (9333)

echo Ejecutando DiCloak en esta misma CMD...
echo.
echo Comando:
echo "C:\Program Files\DICloak\DICloak.exe" --remote-debugging-port=9333 --remote-allow-origins=*
echo.

"C:\Program Files\DICloak\DICloak.exe" --remote-debugging-port=9333 --remote-allow-origins=*

echo.
echo DICloak finalizo o se cerro.
echo Verifica CDP con:
echo curl.exe http://127.0.0.1:9333/json/version
echo.
pause

endlocal
