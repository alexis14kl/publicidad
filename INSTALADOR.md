# Instalador noyecodito_fb v1.4.0

## Que es

Instalador profesional para Windows creado con **Inno Setup 6**. Genera un `.exe` que instala el bot en cualquier PC con un asistente paso a paso.

## Requisitos para compilar el instalador

- Windows 10/11 (64-bit)
- [Inno Setup 6](https://jrsoftware.org/isdl.php) instalado
- El proyecto completo en la PC donde se compila

## Como compilar

1. Abrir la carpeta `ejecutable/`
2. Ejecutar `compilar_instalador.bat`
3. Se genera `noyecodito_fb_setup_v1.4.0.exe` en la misma carpeta
4. Compartir solo el `.exe` al usuario final

## Que hace el instalador

### Paso 1: Bienvenida y licencia

Muestra terminos de uso y pide aceptacion.

### Paso 2: Checklist de componentes

| Componente | Descripcion | Obligatorio |
|---|---|---|
| Bot core | Archivos principales (scripts, config, perfiles) | Si |
| Workflows n8n | Plantillas JSON de automatizacion | No |
| Job Poller | Worker para ejecucion remota via n8n | No |
| Acceso directo | Icono en escritorio | No |

### Paso 3: Deteccion inteligente de dependencias

El instalador verifica automaticamente:

| Dependencia | Como detecta | Si falta |
|---|---|---|
| Python 3.12 | `python --version` | Descarga e instala silenciosamente desde python.org |
| Node.js 20 LTS | `node --version` | Descarga e instala silenciosamente desde nodejs.org |
| DiCloak | Busca en Program Files y LocalAppData | Muestra aviso (no bloquea) |

### Paso 4: Copia de archivos

Instala en `C:\noyecodito_fb` por defecto. Crea la estructura:

```
C:\noyecodito_fb\
  iniciar.bat          # Orquestador principal
  package.json
  requirements.txt
  .gitignore
  cfg/                 # Configuracion centralizada
  perfil/              # Scripts de perfiles DiCloak
  cdp/                 # Scripts CDP (forzado de puertos)
  prompt/              # Generacion de prompts e imagenes
  server/              # Worker y bot runner
  utils/               # Utilidades y logger
  inicio/              # Cleanup de procesos
  n8n/                 # Workflows de n8n
  ejecutable/          # Icono y licencia
  logs/                # Logs del worker (se crea vacio)
  img_publicitarias/   # Imagenes generadas (se crea vacio)
  debug/               # Screenshots de debug (se crea vacio)
  memory/profile/      # Memoria de perfiles (se crea vacio)
```

### Paso 5: Instalacion de dependencias (inteligente)

**En instalacion nueva:** ejecuta todo.
**En actualizacion:** salta lo que ya existe.

| Dependencia | Como verifica si ya existe | Accion si existe |
|---|---|---|
| pip packages | `python -c "import playwright"` | Salta |
| node_modules | Busca carpeta `node_modules/playwright` | Salta |
| Playwright Chromium | `playwright install --dry-run` | Salta |

Esto hace que las actualizaciones sean rapidas (solo copia archivos nuevos).

### Paso 6: Worker automatico

1. Registra el worker en el inicio de sesion de Windows (tarea programada)
2. Inicia el worker en background inmediatamente
3. El worker queda escuchando n8n cada 15 segundos

### Paso 7: Listo

Opcion de ejecutar el bot inmediatamente al finalizar.

## Como actualizar

1. Compilar el nuevo `.exe` con `compilar_instalador.bat`
2. Ejecutar el `.exe` en la PC destino
3. El instalador detecta la instalacion anterior y solo actualiza archivos
4. Las dependencias se saltan si ya estan instaladas
5. El worker se re-registra y reinicia

## Desinstalacion

- Panel de control > Programas > noyecodito_fb > Desinstalar
- O desde el menu Inicio > noyecodito_fb > Desinstalar
- Limpia: node_modules, logs, debug, memory, img_publicitarias y __pycache__

## Archivos del instalador

```
ejecutable/
  noyecodito_fb.iss            # Script Inno Setup (configuracion completa)
  compilar_instalador.bat      # Script para compilar el .exe
  LICENSE.txt                  # Terminos y condiciones
  icon/noyecodito.ico          # Icono de la aplicacion
  noyecodito_fb_setup_v1.4.0.exe  # Instalador generado (compartir este)
```

## Notas importantes

- **Solo compartir el `.exe`**, no el proyecto completo
- El instalador requiere permisos de administrador (instala Python/Node globalmente)
- DiCloak debe instalarse por separado desde [dicloak.com](https://www.dicloak.com/)
- Las credenciales de n8n se configuran en los scripts `.bat` del poller
