; ============================================================
; noyecodito_fb - Instalador Inno Setup
; Bot de publicidad automatizada en Facebook
; Auto-descarga Python 3.12 y Node.js 20 LTS si no estan
; ============================================================

#define MyAppName "noyecodito_fb"
#define MyAppVersion "2.0.0"
#define MyAppPublisher "NoyeCode"
#define MyAppURL "https://noyecode.com"
#define MyAppExeName "iniciar_gui.vbs"

; Ruta raiz del proyecto (relativa al .iss)
#define ProjectRoot ".."

; URLs oficiales de descarga (64-bit)
#define PythonURL "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe"
#define PythonInstaller "python-3.12.9-amd64.exe"
#define NodeURL "https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi"
#define NodeInstaller "node-v20.18.3-x64.msi"

[Setup]
AppId={{B3F7A2D1-9C4E-4F8A-B6D2-1A3E5F7C9D0B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName=C:\{#MyAppName}
DefaultGroupName={#MyAppName}
LicenseFile=LICENSE.txt
OutputDir=.
OutputBaseFilename=noyecodito_fb_setup_v2.0.0
SetupIconFile=icon\noyecodito.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableWelcomePage=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\ejecutable\icon\noyecodito.ico

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Messages]
spanish.WelcomeLabel1=Bienvenido al instalador de {#MyAppName}
spanish.WelcomeLabel2=Este asistente instalara {#MyAppName} v{#MyAppVersion} en su equipo.%n%n{#MyAppName} es un bot de publicidad automatizada con GUI, selector de empresa/servicio/formato, generacion de imagenes con IA y publicacion directa en Facebook, Instagram, TikTok y LinkedIn.%n%nSe recomienda cerrar todas las aplicaciones antes de continuar.%n%nEl instalador descargara automaticamente Python y Node.js si no estan instalados.
spanish.FinishedHeadingLabel=Instalacion completada
spanish.FinishedLabel={#MyAppName} se ha instalado correctamente en su equipo.

[Types]
Name: "full"; Description: "Instalacion completa (recomendado)"
Name: "custom"; Description: "Instalacion personalizada"; Flags: iscustom

[Components]
Name: "core"; Description: "Bot core (archivos principales)"; Types: full custom; Flags: fixed
Name: "workflows"; Description: "Workflows n8n (plantillas de automatizacion)"; Types: full custom
Name: "poller"; Description: "Job Poller (ejecucion remota via n8n)"; Types: full custom
Name: "shortcuts"; Description: "Acceso directo en escritorio"; Types: full custom

[Files]
; --- Core: scripts de entrada ---
Source: "{#ProjectRoot}\iniciar.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\iniciar_gui.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\iniciar_gui.vbs"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\.env.example"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist; Components: core
Source: "{#ProjectRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\.gitignore"; DestDir: "{app}"; Flags: ignoreversion; Components: core

; --- Core: configuracion ---
Source: "{#ProjectRoot}\cfg\*"; DestDir: "{app}\cfg"; Flags: ignoreversion recursesubdirs; Components: core

; --- Core: perfiles DiCloak ---
Source: "{#ProjectRoot}\perfil\*.js"; DestDir: "{app}\perfil"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\perfil\*.py"; DestDir: "{app}\perfil"; Flags: ignoreversion; Components: core

; --- Core: CDP ---
Source: "{#ProjectRoot}\cdp\*"; DestDir: "{app}\cdp"; Flags: ignoreversion recursesubdirs; Components: core

; --- Core: prompt ---
Source: "{#ProjectRoot}\prompt\*.py"; DestDir: "{app}\prompt"; Flags: ignoreversion; Components: core

; --- Core: server ---
Source: "{#ProjectRoot}\server\*.py"; DestDir: "{app}\server"; Flags: ignoreversion; Components: core

; --- Core: utilidades ---
Source: "{#ProjectRoot}\utils\*.py"; DestDir: "{app}\utils"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\utils\*.txt"; DestDir: "{app}\utils"; Flags: onlyifdoesntexist; Components: core

; --- Core: inicio (cleanup) ---
Source: "{#ProjectRoot}\inicio\*"; DestDir: "{app}\inicio"; Flags: ignoreversion recursesubdirs; Components: core

; --- Core: Backend (SQLite schemas) ---
Source: "{#ProjectRoot}\Backend\*.sql"; DestDir: "{app}\Backend"; Flags: ignoreversion; Components: core

; --- Core: GUI Electron ---
Source: "{#ProjectRoot}\gui\electron\*.js"; DestDir: "{app}\gui\electron"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\electron\*.py"; DestDir: "{app}\gui\electron"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\src\*"; DestDir: "{app}\gui\src"; Flags: ignoreversion recursesubdirs; Components: core
Source: "{#ProjectRoot}\gui\index.html"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\package.json"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\package-lock.json"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\vite.config.ts"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\tsconfig.json"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\gui\tsconfig.node.json"; DestDir: "{app}\gui"; Flags: ignoreversion; Components: core

; --- Core: Logos de empresas ---
Source: "{#ProjectRoot}\utils\logos\*"; DestDir: "{app}\utils\logos"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "{#ProjectRoot}\utils\*.png"; DestDir: "{app}\utils"; Flags: ignoreversion; Components: core

; --- Core: sqlite3 bundled ---
Source: "{#ProjectRoot}\bin\sqlite3.exe"; DestDir: "{app}\bin"; Flags: ignoreversion; Components: core

; --- Core: orchestrator ---
Source: "{#ProjectRoot}\orchestrator.py"; DestDir: "{app}"; Flags: ignoreversion; Components: core

; --- Core: n8n update_bot ---
Source: "{#ProjectRoot}\n8n\update_bot\*"; DestDir: "{app}\n8n\update_bot"; Flags: ignoreversion recursesubdirs; Components: workflows

; --- Core: icono e instalador ---
Source: "icon\noyecodito.ico"; DestDir: "{app}\ejecutable\icon"; Flags: ignoreversion; Components: core
Source: "LICENSE.txt"; DestDir: "{app}\ejecutable"; Flags: ignoreversion; Components: core

; --- Workflows n8n ---
Source: "{#ProjectRoot}\n8n\*.json"; DestDir: "{app}\n8n"; Flags: ignoreversion; Components: workflows
Source: "{#ProjectRoot}\n8n\*.py"; DestDir: "{app}\n8n"; Flags: ignoreversion; Components: workflows
Source: "{#ProjectRoot}\n8n\en_uso\*"; DestDir: "{app}\n8n\en_uso"; Flags: ignoreversion recursesubdirs; Components: workflows

; --- Poller ---
Source: "{#ProjectRoot}\iniciar_poller.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\iniciar_poller_background.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\iniciar_poller_oculto.ps1"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\iniciar_poller_oculto.vbs"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\instalar_inicio_poller_sesion.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\desinstalar_inicio_poller_sesion.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller

[Dirs]
Name: "{app}\logs"
Name: "{app}\img_publicitarias"
Name: "{app}\debug"
Name: "{app}\memory\profile"
Name: "{app}\Backend"
Name: "{app}\utils\logos\companies"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\ejecutable\icon\noyecodito.ico"; Comment: "Ejecutar {#MyAppName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\ejecutable\icon\noyecodito.ico"; Comment: "Ejecutar {#MyAppName}"; Components: shortcuts

[Run]
; Post-instalacion: instalar dependencias Python (solo si faltan)
Filename: "cmd.exe"; Parameters: "/c python -m pip install --upgrade pip && python -m pip install -r ""{app}\requirements.txt"""; WorkingDir: "{app}"; StatusMsg: "Instalando dependencias Python..."; Flags: runhidden waituntilterminated; Check: NeedPipInstall
; Post-instalacion: instalar dependencias Node (raiz)
Filename: "cmd.exe"; Parameters: "/c npm install"; WorkingDir: "{app}"; StatusMsg: "Instalando dependencias Node.js..."; Flags: runhidden waituntilterminated; Check: NeedNpmInstall
; Post-instalacion: instalar dependencias Node (GUI)
Filename: "cmd.exe"; Parameters: "/c npm install"; WorkingDir: "{app}\gui"; StatusMsg: "Instalando dependencias GUI Electron..."; Flags: runhidden waituntilterminated; Check: NeedGuiNpmInstall
; Post-instalacion: buildear frontend (Vite compila React/TSX a dist/)
Filename: "cmd.exe"; Parameters: "/c npm run build:frontend"; WorkingDir: "{app}\gui"; StatusMsg: "Compilando interfaz grafica..."; Flags: runhidden waituntilterminated; Check: NeedGuiBuild
; Post-instalacion: instalar Playwright browsers (solo si falta chromium)
Filename: "cmd.exe"; Parameters: "/c python -m playwright install chromium"; WorkingDir: "{app}"; StatusMsg: "Instalando navegador Playwright (Chromium)..."; Flags: runhidden waituntilterminated; Check: NeedPlaywrightInstall
; Post-instalacion: registrar worker en inicio de sesion de Windows
Filename: "cmd.exe"; Parameters: "/c ""{app}\instalar_inicio_poller_sesion.bat"""; WorkingDir: "{app}"; StatusMsg: "Registrando worker en inicio automatico..."; Flags: runhidden waituntilterminated
; Post-instalacion: iniciar worker en background ahora
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\iniciar_poller_oculto.ps1"""; WorkingDir: "{app}"; StatusMsg: "Iniciando worker en background..."; Flags: runhidden nowait
; Opcion de ejecutar al finalizar (GUI Electron sin consola)
Filename: "{app}\iniciar_gui.vbs"; WorkingDir: "{app}"; Description: "Ejecutar {#MyAppName} ahora"; Flags: nowait postinstall skipifsilent shellexec

[UninstallDelete]
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\gui\node_modules"
Type: filesandordirs; Name: "{app}\gui\dist"
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\debug"
Type: filesandordirs; Name: "{app}\memory"
Type: filesandordirs; Name: "{app}\img_publicitarias"
Type: filesandordirs; Name: "{app}\perfil\__pycache__"
Type: filesandordirs; Name: "{app}\utils\__pycache__"
Type: filesandordirs; Name: "{app}\server\__pycache__"
Type: filesandordirs; Name: "{app}\prompt\__pycache__"
Type: filesandordirs; Name: "{app}\n8n\__pycache__"

[Code]
var
  DownloadPage: TOutputProgressWizardPage;

// ---------------------------------------------------------------
//  Deteccion de Python y Node.js
// ---------------------------------------------------------------
function IsPythonInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c python --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function IsNodeInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe', '/c node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function IsDiCloakInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{pf}\DICloak\DICloak.exe')) or
            FileExists(ExpandConstant('{pf32}\DICloak\DICloak.exe')) or
            FileExists(ExpandConstant('{localappdata}\Programs\dicloak\DICloak.exe'));
end;

// ---------------------------------------------------------------
//  Descarga con PowerShell (progreso visual via WizardPage)
// ---------------------------------------------------------------
function DownloadFile(const URL, DestPath, DisplayName: String): Boolean;
var
  ResultCode: Integer;
  PSCmd: String;
begin
  Result := False;
  Log('Descargando ' + DisplayName + ' desde ' + URL);

  PSCmd := '-NoProfile -ExecutionPolicy Bypass -Command "' +
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ' +
    '$ProgressPreference = ''SilentlyContinue''; ' +
    'try { ' +
      'Invoke-WebRequest -Uri ''' + URL + ''' -OutFile ''' + DestPath + ''' -UseBasicParsing; ' +
      'if (Test-Path ''' + DestPath + ''') { exit 0 } else { exit 1 } ' +
    '} catch { Write-Host $_.Exception.Message; exit 1 }"';

  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
          PSCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := (ResultCode = 0) and FileExists(DestPath);
  end;

  if Result then
    Log(DisplayName + ' descargado correctamente: ' + DestPath)
  else
    Log('ERROR descargando ' + DisplayName);
end;

// ---------------------------------------------------------------
//  Instalacion silenciosa de Python
// ---------------------------------------------------------------
function InstallPython(const InstallerPath: String): Boolean;
var
  ResultCode: Integer;
  Params: String;
begin
  Result := False;
  Log('Instalando Python desde ' + InstallerPath);

  // InstallAllUsers=1 → para todos los usuarios
  // PrependPath=1 → agrega al PATH del sistema
  // Include_pip=1 → incluye pip
  // /quiet → instalacion silenciosa
  Params := '/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_test=0';

  if Exec(InstallerPath, Params, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := (ResultCode = 0);
  end;

  if Result then
    Log('Python instalado correctamente')
  else
    Log('ERROR instalando Python, codigo: ' + IntToStr(ResultCode));
end;

// ---------------------------------------------------------------
//  Instalacion silenciosa de Node.js (MSI)
// ---------------------------------------------------------------
function InstallNode(const InstallerPath: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := False;
  Log('Instalando Node.js desde ' + InstallerPath);

  // msiexec /i ... /qn → instalacion silenciosa MSI
  if Exec('msiexec.exe', '/i "' + InstallerPath + '" /qn /norestart',
          '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := (ResultCode = 0);
  end;

  if Result then
    Log('Node.js instalado correctamente')
  else
    Log('ERROR instalando Node.js, codigo: ' + IntToStr(ResultCode));
end;

// ---------------------------------------------------------------
//  Refrescar PATH del sistema en la sesion actual
// ---------------------------------------------------------------
procedure RefreshEnvironment;
var
  ResultCode: Integer;
begin
  Exec('cmd.exe', '/c setx NOYECODITO_REFRESH 1 >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ---------------------------------------------------------------
//  Flujo principal: descargar e instalar dependencias
// ---------------------------------------------------------------
procedure InstallDependencies;
var
  TempDir: String;
  PythonPath, NodePath: String;
  NeedPython, NeedNode: Boolean;
begin
  NeedPython := not IsPythonInstalled;
  NeedNode := not IsNodeInstalled;

  if (not NeedPython) and (not NeedNode) then
  begin
    Log('Python y Node.js ya estan instalados. Omitiendo descarga.');
    Exit;
  end;

  TempDir := ExpandConstant('{tmp}');
  PythonPath := TempDir + '\{#PythonInstaller}';
  NodePath := TempDir + '\{#NodeInstaller}';

  // --- Descargar Python ---
  if NeedPython then
  begin
    DownloadPage.SetText('Descargando Python 3.12...', 'Esto puede tardar unos minutos segun su conexion a internet.');
    DownloadPage.SetProgress(0, 100);
    DownloadPage.Show;
    try
      if not DownloadFile('{#PythonURL}', PythonPath, 'Python 3.12') then
      begin
        MsgBox('No se pudo descargar Python 3.12.' + #13#10 +
               'Verifique su conexion a internet e intentelo de nuevo.' + #13#10#13#10 +
               'Puede instalarlo manualmente desde: https://python.org', mbError, MB_OK);
      end;
    finally
      DownloadPage.Hide;
    end;
  end;

  // --- Descargar Node.js ---
  if NeedNode then
  begin
    DownloadPage.SetText('Descargando Node.js 20 LTS...', 'Esto puede tardar unos minutos segun su conexion a internet.');
    DownloadPage.SetProgress(30, 100);
    DownloadPage.Show;
    try
      if not DownloadFile('{#NodeURL}', NodePath, 'Node.js 20 LTS') then
      begin
        MsgBox('No se pudo descargar Node.js 20 LTS.' + #13#10 +
               'Verifique su conexion a internet e intentelo de nuevo.' + #13#10#13#10 +
               'Puede instalarlo manualmente desde: https://nodejs.org', mbError, MB_OK);
      end;
    finally
      DownloadPage.Hide;
    end;
  end;

  // --- Instalar Python ---
  if NeedPython and FileExists(PythonPath) then
  begin
    DownloadPage.SetText('Instalando Python 3.12...', 'Instalacion silenciosa en progreso. Por favor espere.');
    DownloadPage.SetProgress(50, 100);
    DownloadPage.Show;
    try
      if not InstallPython(PythonPath) then
        MsgBox('La instalacion de Python no se completo correctamente.' + #13#10 +
               'Puede instalarlo manualmente desde: https://python.org' + #13#10 +
               'Marque "Add Python to PATH" durante la instalacion.', mbError, MB_OK);
    finally
      DownloadPage.Hide;
    end;
    DeleteFile(PythonPath);
  end;

  // --- Instalar Node.js ---
  if NeedNode and FileExists(NodePath) then
  begin
    DownloadPage.SetText('Instalando Node.js 20 LTS...', 'Instalacion silenciosa en progreso. Por favor espere.');
    DownloadPage.SetProgress(75, 100);
    DownloadPage.Show;
    try
      if not InstallNode(NodePath) then
        MsgBox('La instalacion de Node.js no se completo correctamente.' + #13#10 +
               'Puede instalarlo manualmente desde: https://nodejs.org', mbError, MB_OK);
    finally
      DownloadPage.Hide;
    end;
    DeleteFile(NodePath);
  end;

  // Refrescar PATH para que [Run] encuentre python/node
  if NeedPython or NeedNode then
    RefreshEnvironment;

  DownloadPage.SetProgress(100, 100);
end;

// ---------------------------------------------------------------
//  Checks: saltar dependencias ya instaladas en actualizaciones
// ---------------------------------------------------------------
function NeedPipInstall: Boolean;
var
  ResultCode: Integer;
begin
  // Si playwright ya esta instalado como modulo Python, pip ya corrio
  Result := not (Exec('cmd.exe', '/c python -c "import playwright"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0));
  if not Result then
    Log('pip: dependencias Python ya instaladas, omitiendo.')
  else
    Log('pip: se necesita instalar dependencias Python.');
end;

function NeedNpmInstall: Boolean;
begin
  // Si node_modules/playwright existe, npm install ya corrio
  Result := not DirExists(ExpandConstant('{app}\node_modules\playwright'));
  if not Result then
    Log('npm: node_modules ya existe, omitiendo.')
  else
    Log('npm: se necesita ejecutar npm install.');
end;

function NeedGuiNpmInstall: Boolean;
begin
  Result := not DirExists(ExpandConstant('{app}\gui\node_modules\electron'));
  if not Result then
    Log('gui npm: node_modules ya existe, omitiendo.')
  else
    Log('gui npm: se necesita ejecutar npm install en gui/.');
end;

function NeedGuiBuild: Boolean;
begin
  Result := not FileExists(ExpandConstant('{app}\gui\dist\index.html'));
  if not Result then
    Log('gui build: dist/ ya existe, omitiendo.')
  else
    Log('gui build: se necesita compilar el frontend.');
end;

function NeedPlaywrightInstall: Boolean;
var
  ResultCode: Integer;
begin
  // Verificar si chromium de Playwright ya esta descargado
  Result := not (Exec('cmd.exe', '/c python -m playwright install --dry-run chromium 2>nul | findstr "is already installed"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0));
  if not Result then
    Log('playwright: Chromium ya instalado, omitiendo.')
  else
    Log('playwright: se necesita instalar Chromium.');
end;

// ---------------------------------------------------------------
//  Eventos del wizard
// ---------------------------------------------------------------
procedure InitializeWizard;
begin
  DownloadPage := CreateOutputProgressPage(
    'Instalando dependencias',
    'Descargando e instalando componentes necesarios...'
  );
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    if not IsDiCloakInstalled then
      MsgBox('AVISO: DiCloak no esta instalado.' + #13#10#13#10 +
             'Se busco en:' + #13#10 +
             '  - C:\Program Files\DICloak\' + #13#10 +
             '  - C:\Program Files (x86)\DICloak\' + #13#10 +
             '  - %LocalAppData%\Programs\dicloak\' + #13#10#13#10 +
             'Instale DiCloak antes de ejecutar el bot.', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    InstallDependencies;
  end;
end;
