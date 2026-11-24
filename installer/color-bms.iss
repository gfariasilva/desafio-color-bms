; Sistema Color - Windows installer (backlog #24, FR-34, ADR 0006).
;
; Build it with `npm run package:installer` (on Windows, with Inno Setup 6): the script passes
; AppVersion, PackageDir (the folder of `npm run package:pilot`) and OutputDir.
;
; The installer only carries the package. It unpacks it to {tmp}\pacote and runs the package's
; own `cli.js instalador`, which installs or updates (keeping the data), registers the logon
; task and the desktop shortcut, and starts the system. All that logic is tested TypeScript in
; apps/server/src/pilot/ (ADR 0004); keep this file small.
;
; Kept as UTF-8 with a byte-order mark (pt-BR texts). Checked by apps/server/test/installer.test.ts.

#ifndef AppVersion
  #error Compile with npm run package:installer (AppVersion is missing)
#endif
#ifndef PackageDir
  #error Compile with npm run package:installer (PackageDir is missing)
#endif
#ifndef OutputDir
  #define OutputDir "..\dist-installer"
#endif
; The Task Scheduler task registered by cli.js (TASK_NAME in apps/server/src/pilot/layout.ts).
#define TaskName "Color BMS"

[Setup]
; Never change the AppId: Windows uses it to know that a new version updates this program.
AppId={{861FFEE5-9589-4241-AC07-7CE693AF34D6}
AppName=Sistema Color
AppVersion={#AppVersion}
AppVerName=Sistema Color {#AppVersion}
AppPublisher=Color
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Sistema Color - instalador
; ADR 0001: one user (the owner), no admin rights, the same folder as the pilot (#26).
PrivilegesRequired=lowest
DefaultDirName={localappdata}\ColorBMS
DisableDirPage=yes
DefaultGroupName=Sistema Color
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
; Files go to {tmp} and the CLI swaps app\ itself, so nothing of the running system is locked.
CloseApplications=no
RestartApplications=no
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=ColorBMS-Setup-{#AppVersion}
UninstallDisplayName=Sistema Color
SetupLogging=yes

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; The whole package, configured by cli.js instalador (see [Code]); {tmp} is deleted at the end.
Source: "{#PackageDir}\*"; DestDir: "{tmp}\pacote"; Flags: ignoreversion recursesubdirs createallsubdirs
; The support scripts next to app\ (the Start Menu entries below point to them).
Source: "{#PackageDir}\iniciar.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\parar.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\iniciar-uso-real.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PackageDir}\LEIA-ME.txt"; DestDir: "{app}"; Flags: ignoreversion

[CustomMessages]
; The installer's own pt-BR texts, all here (the CLI's messages are in apps/server/src/pilot/).
; %n is a line break, %1 the log file.
IconStart=Iniciar o Sistema Color
IconStartComment=Inicia o sistema e abre a tela inicial
IconStop=Parar o Sistema Color
IconStopComment=Para o sistema
IconGoLive=Começar o uso real
IconGoLiveComment=Guarda os dados de treino e começa o uso real (dia 1º do mês)
IconReadMe=Leia-me
IconUninstall=Desinstalar o Sistema Color
Configuring=Configurando e iniciando o sistema...
ConfigFailed=O sistema foi copiado, mas não terminou de ser configurado ou não iniciou.%n%nO registro está em:%n%1%n%nAbrir o registro agora?
FinishedFailed=A instalação NÃO terminou: o sistema não foi configurado ou não iniciou.%n%nVeja o registro em:%n%1
StopFailed=O Sistema Color não pôde ser parado, e parte do programa pode ficar na pasta %1. Os dados foram mantidos.%n%nReinicie o Windows. Depois, para reinstalar, basta rodar o instalador.

[Icons]
; The desktop shortcut (Edge in app mode) is made by cli.js, the same as the pilot's.
Name: "{group}\{cm:IconStart}"; Filename: "{app}\iniciar.cmd"; WorkingDir: "{app}"; Comment: "{cm:IconStartComment}"
Name: "{group}\{cm:IconStop}"; Filename: "{app}\parar.cmd"; WorkingDir: "{app}"; Comment: "{cm:IconStopComment}"
Name: "{group}\{cm:IconGoLive}"; Filename: "{app}\iniciar-uso-real.cmd"; WorkingDir: "{app}"; Comment: "{cm:IconGoLiveComment}"
Name: "{group}\{cm:IconReadMe}"; Filename: "{app}\LEIA-ME.txt"
Name: "{group}\{cm:IconUninstall}"; Filename: "{uninstallexe}"

[UninstallDelete]
; Only the program. Never data\, data-treino\, arquivo\ or instalacao.json (#24, ADR 0006).
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\app.anterior"
Type: filesandordirs; Name: "{app}\app.novo"
Type: files; Name: "{app}\instalador.log"

[Code]
var
  CliFailed: Boolean;

function CliLogFile: String;
begin
  Result := ExpandConstant('{app}\instalador.log');
end;

{ #24: install or update with the package's own Node (cli.js instalador).
  Setup.exe /PERMITIRVERSAOANTERIOR=1 allows a deliberate downgrade. }
function RunCliInstaller: Boolean;
var
  Params: String;
  ResultCode: Integer;
begin
  Params := '"' + ExpandConstant('{tmp}\pacote\app\server\dist\pilot\cli.js') + '" ' + 'instalador' +
    ' "--raiz=' + ExpandConstant('{app}') + '" "--registro=' + CliLogFile + '"';
  if WizardSilent then
    Params := Params + ' /silencioso';
  if ExpandConstant('{param:PERMITIRVERSAOANTERIOR|0}') = '1' then
    Params := Params + ' --permitir-versao-anterior';
  Log('cli.js ' + Params);
  Result := Exec(ExpandConstant('{tmp}\pacote\app\node\node.exe'), Params,
    ExpandConstant('{tmp}\pacote'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('cli.js exit code: ' + IntToStr(ResultCode));
  Result := Result and (ResultCode = 0);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    if not WizardSilent then
      WizardForm.StatusLabel.Caption := CustomMessage('Configuring');
    if not RunCliInstaller then
    begin
      CliFailed := True;
      if SuppressibleMsgBox(FmtMessage(CustomMessage('ConfigFailed'), [CliLogFile]),
        mbError, MB_YESNO, IDNO) = IDYES then
        ShellExec('open', CliLogFile, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    end;
  end;
end;

{ After a failure, the last page must not say that the installation succeeded. }
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and CliFailed then
    WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('FinishedFailed'), [CliLogFile]);
end;

{ A failed configuration makes Setup.exe exit with code 9, so CI (and /VERYSILENT) sees it. }
function GetCustomSetupExitCode: Integer;
begin
  if CliFailed then
    Result := 9
  else
    Result := 0;
end;

{ #24: before the files are removed. cli.js desinstalar stops the system and deletes the logon
  task and the desktop shortcut. The task is deleted again with schtasks, so that never depends
  on the program files (node.exe missing). A system that did not stop is reported. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  NodeExe, Params: String;
  ResultCode: Integer;
  Stopped: Boolean;
begin
  if CurUninstallStep <> usUninstall then
    Exit;
  NodeExe := ExpandConstant('{app}\app\node\node.exe');
  Params := '"' + ExpandConstant('{app}\app\server\dist\pilot\cli.js') + '" desinstalar /silencioso' +
    ' "--raiz=' + ExpandConstant('{app}') + '"';
  Stopped := FileExists(NodeExe) and
    Exec(NodeExe, Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and
    (ResultCode = 0);
  Log('cli.js desinstalar stopped the system: ' + IntToStr(Ord(Stopped)));
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "{#TaskName}" /F', '', SW_HIDE,
    ewWaitUntilTerminated, ResultCode);
  if not Stopped and FileExists(NodeExe) then
    SuppressibleMsgBox(FmtMessage(CustomMessage('StopFailed'), [ExpandConstant('{app}\app')]),
      mbError, MB_OK, IDOK);
end;
