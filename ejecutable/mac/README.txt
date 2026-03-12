Build de macOS generado desde `gui`.

Contenido:
- `Bot Publicitario NoyeCode.app`: app de macOS para Apple Silicon (`arm64`)
- `Bot Publicitario NoyeCode-1.0.0-arm64.dmg`: imagen de disco generada por electron-builder

Referencia:
- La carpeta `../` contiene los instaladores de Windows (`.exe`) y sus archivos fuente.

Nota:
- El build se genero sin code signing de Apple.
- electron-builder reporto errores/reintentos con `hdiutil`, pero dejo tanto el `.app` como el `.dmg` en `gui/release` y fueron copiados aqui.
