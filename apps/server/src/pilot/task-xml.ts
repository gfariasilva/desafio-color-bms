/** Escapes text for an XML element (user names and paths may contain "&"). */
function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface TaskXmlOptions {
  /** `DOMAIN\user` of the owner's Windows account. */
  userId: string;
  conhostExe: string;
  nodeExe: string;
  launcherJs: string;
  workingDir: string;
}

/**
 * #26 / FR-34: the Task Scheduler task that starts the system at the owner's logon (ADR 0001,
 * ADR 0004).
 *
 * - "At log on", as the owner's own interactive account: no admin rights, no stored password,
 *   and the OneDrive folder in the user profile is reachable.
 * - `conhost.exe --headless` runs Node without any console window.
 * - No time limit, not stopped on battery, one instance only.
 * - RestartOnFailure covers a launcher that fails to start; crashes of the server itself are
 *   restarted by the launcher (supervisor.ts).
 */
export function buildTaskXml(options: TaskXmlOptions): string {
  const args = `--headless "${options.nodeExe}" "${options.launcherJs}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Sistema Color: inicia o servidor local (http://127.0.0.1:3210) ao entrar no Windows.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xml(options.userId)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(options.userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>10</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(options.conhostExe)}</Command>
      <Arguments>${xml(args).replace(/&quot;/g, '"')}</Arguments>
      <WorkingDirectory>${xml(options.workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** `schtasks /Create /XML` reads UTF-16 LE with a byte-order mark. */
export function encodeTaskXml(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}
