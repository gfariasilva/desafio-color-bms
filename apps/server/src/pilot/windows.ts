import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WindowsOps } from "./commands";
import { TASK_NAME } from "./layout";
import { encodeTaskXml } from "./task-xml";

/**
 * Finds Edge (App Paths in the registry, then the usual folders). Values come in through
 * environment variables, never pasted into the script text, so paths need no quoting.
 */
const FIND_EDGE = `
$edge = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $edge -or -not (Test-Path $edge)) {
  $edge = @("$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}`;

function powershell(script: string, env: Record<string, string> = {}): string {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true },
  ).trim();
}

function schtasks(args: string[]): void {
  execFileSync("schtasks.exe", args, { stdio: "pipe", windowsHide: true });
}

/** #26: the real Windows side effects of the pilot scripts (Task Scheduler, PowerShell). */
export const windowsOps: WindowsOps = {
  currentUser() {
    const user = process.env.USERNAME ?? os.userInfo().username;
    return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${user}` : user;
  },

  registerTask(xml) {
    const file = path.join(os.tmpdir(), `color-bms-task-${process.pid}.xml`);
    fs.writeFileSync(file, encodeTaskXml(xml));
    try {
      schtasks(["/Create", "/TN", TASK_NAME, "/XML", file, "/F"]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  },

  runTask() {
    schtasks(["/Run", "/TN", TASK_NAME]);
  },

  endTask() {
    try {
      schtasks(["/End", "/TN", TASK_NAME]);
    } catch {
      // Not running, or no task yet: nothing to end.
    }
  },

  /**
   * Stops every process of *our* node.exe (matched by its full path), except this one. A
   * forced stop is safe for the data: SQLite in WAL mode with synchronous=FULL (NFR-06).
   */
  stopProcesses(nodeExe) {
    powershell(
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $env:COLOR_BMS_NODE_EXE) -and ($_.ProcessId -ne [int]$env:COLOR_BMS_SELF_PID) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      { COLOR_BMS_NODE_EXE: nodeExe, COLOR_BMS_SELF_PID: String(process.pid) },
    );
  },

  /**
   * NFR-02: a desktop shortcut that opens the app in Edge's app mode (a window without tabs or
   * address bar); without Edge, an Internet shortcut for the default browser. The Desktop is
   * asked from Windows, since OneDrive may have moved it.
   */
  createShortcut(url) {
    return powershell(
      `${FIND_EDGE}
$desktop = [Environment]::GetFolderPath('Desktop')
if ($edge) {
  $file = Join-Path $desktop 'Sistema Color.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = $edge
  $link.Arguments = "--app=$env:COLOR_BMS_URL"
  $link.Description = 'Sistema Color'
  $link.Save()
} else {
  $file = Join-Path $desktop 'Sistema Color.url'
  Set-Content -Path $file -Value "[InternetShortcut]\`r\`nURL=$env:COLOR_BMS_URL" -Encoding ASCII
}
Write-Output $file`,
      { COLOR_BMS_URL: url },
    );
  },

  openBrowser(url) {
    powershell(
      `${FIND_EDGE}
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$env:COLOR_BMS_URL" } else { Start-Process $env:COLOR_BMS_URL }`,
      { COLOR_BMS_URL: url },
    );
  },
};
