# Estructura recomendada del proyecto

Esta redistribucion mantiene intactos los scripts operativos del bot y ordena la parte que mas deuda tenia: la app de escritorio.

## Capas principales

### `gui/src`

- `pages/`
  Contenedores de nivel pantalla. `App.tsx` solo decide navegacion y layout general.
- `features/`
  Flujos con estado propio, como `home/` y `marketing/`.
- `shared/api/`
  Tipos y comandos que hablan con `window.electronAPI`.
- `shared/types/`
  Declaraciones globales del runtime del preload.
- `components/`
  Bloques visuales reutilizables.
- `hooks/`
  Hooks transversales de polling, logs y estado del bot.

### `gui/electron`

- `config/`
  Configuracion estable del runtime Electron.
- `utils/`
  Helpers reutilizables del proceso principal.
- `main.js`
  Orquestador principal. La idea es seguir extrayendo servicios desde aqui por dominios.

## Criterio de trabajo

- No mover scripts de `run_mac/`, `.bat`, `server/`, `perfil/` o `cdp/` sin una migracion completa.
- Seguir extrayendo modulos de `gui/electron/main.js` por dominio:
  `meta-ads`, `company-data`, `process-control`, `logging`, `ipc`.
- Mantener compatibilidad temporal con `gui/src/lib/*` usando reexports mientras se termina la migracion.
