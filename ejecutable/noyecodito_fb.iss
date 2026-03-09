; ============================================================
; noyecodito_fb - Instalador Inno Setup
; Bot de publicidad automatizada en Facebook
; ============================================================

#define MyAppName "noyecodito_fb"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NoyeCode"
#define MyAppURL "https://noyecode.com"
#define MyAppExeName "iniciar.bat"

; Ruta raiz del proyecto (relativa al .iss)
#define ProjectRoot ".."

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
OutputBaseFilename=noyecodito_fb_setup
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
spanish.WelcomeLabel2=Este asistente instalara {#MyAppName} v{#MyAppVersion} en su equipo.%n%n{#MyAppName} es un bot de publicidad automatizada que genera imagenes con IA y las publica en Facebook.%n%nSe recomienda cerrar todas las aplicaciones antes de continuar.
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
Source: "{#ProjectRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#ProjectRoot}\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion; Components: core

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
Source: "{#ProjectRoot}\instalar_inicio_poller_sesion.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller
Source: "{#ProjectRoot}\desinstalar_inicio_poller_sesion.bat"; DestDir: "{app}"; Flags: ignoreversion; Components: poller

[Dirs]
Name: "{app}\logs"
Name: "{app}\img_publicitarias"
Name: "{app}\debug"
Name: "{app}\memory\profile"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\ejecutable\icon\noyecodito.ico"; Comment: "Ejecutar {#MyAppName}"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; IconFilename: "{app}\ejecutable\icon\noyecodito.ico"; Comment: "Ejecutar {#MyAppName}"; Components: shortcuts

[Run]
; Post-instalacion: instalar dependencias Python
Filename: "python"; Parameters: "-m pip install -r ""{app}\requirements.txt"""; WorkingDir: "{app}"; StatusMsg: "Instalando dependencias Python..."; Flags: runhidden waituntilterminated; Check: IsPythonInstalled
; Post-instalacion: instalar dependencias Node
Filename: "cmd.exe"; Parameters: "/c npm install"; WorkingDir: "{app}"; StatusMsg: "Instalando dependencias Node.js..."; Flags: runhidden waituntilterminated; Check: IsNodeInstalled
; Post-instalacion: instalar Playwright browsers
Filename: "python"; Parameters: "-m playwright install chromium"; WorkingDir: "{app}"; StatusMsg: "Instalando navegador Playwright..."; Flags: runhidden waituntilterminated; Check: IsPythonInstalled
; Opcion de ejecutar al finalizar
Filename: "{app}\iniciar.bat"; WorkingDir: "{app}"; Description: "Ejecutar {#MyAppName} ahora"; Flags: nowait postinstall skipifsilent shellexec

[UninstallDelete]
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\debug"
Type: filesandordirs; Name: "{app}\memory"
Type: filesandordirs; Name: "{app}\img_publicitarias"
Type: filesandordirs; Name: "{app}\perfil\__pycache__"
Type: filesandordirs; Name: "{app}\utils\__pycache__"
Type: filesandordirs; Name: "{app}\server\__pycache__"
Type: filesandordirs; Name: "{app}\prompt\__pycache__"

[Code]
function IsPythonInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('python', '--version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function IsNodeInstalled: Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('node', '--version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function IsDiCloakInstalled: Boolean;
begin
  Result := FileExists('C:\Program Files\DICloak\DICloak.exe');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    if not IsPythonInstalled then
      MsgBox('AVISO: Python no esta instalado o no esta en el PATH.'#13#10#13#10 +
             'Descargue Python 3.10+ desde https://python.org'#13#10 +
             'Marque "Add Python to PATH" durante la instalacion.'#13#10#13#10 +
             'Sin Python, el bot no funcionara.', mbInformation, MB_OK);

    if not IsNodeInstalled then
      MsgBox('AVISO: Node.js no esta instalado o no esta en el PATH.'#13#10#13#10 +
             'Descargue Node.js 18+ desde https://nodejs.org'#13#10#13#10 +
             'Sin Node.js, el bot no funcionara.', mbInformation, MB_OK);

    if not IsDiCloakInstalled then
      MsgBox('AVISO: DiCloak no esta instalado en la ruta esperada.'#13#10#13#10 +
             'Ruta esperada: C:\Program Files\DICloak\DICloak.exe'#13#10#13#10 +
             'Instale DiCloak antes de ejecutar el bot.', mbInformation, MB_OK);
  end;
end;
