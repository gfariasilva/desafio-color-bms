import { describe, expect, it } from "vitest";
import { buildTaskXml, encodeTaskXml } from "../src/pilot/task-xml";

const options = {
  userId: "LOJA-PC\\Dono & Filho",
  conhostExe: "C:\\Windows\\System32\\conhost.exe",
  nodeExe: "C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app\\node\\node.exe",
  launcherJs:
    "C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app\\server\\dist\\pilot\\launcher.js",
  workingDir: "C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app",
};

describe("#26 / FR-34: Task Scheduler task that starts the system at logon", () => {
  const xml = buildTaskXml(options);

  it("FR-34: starts at the owner's logon, with the owner's own (interactive) account", () => {
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<UserId>LOJA-PC\\Dono &amp; Filho</UserId>");
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("FR-34: runs in the background, without a window (conhost --headless)", () => {
    expect(xml).toContain("<Command>C:\\Windows\\System32\\conhost.exe</Command>");
    expect(xml).toContain(
      '<Arguments>--headless "C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app\\node\\node.exe" ' +
        '"C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app\\server\\dist\\pilot\\launcher.js"</Arguments>',
    );
    expect(xml).toContain(
      "<WorkingDirectory>C:\\Users\\Dono Silva\\AppData\\Local\\ColorBMS\\app</WorkingDirectory>",
    );
    expect(xml).toContain("<Hidden>true</Hidden>");
  });

  it("#26: never stopped by Windows, one instance only, restarted if it fails to start", () => {
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toMatch(/<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>\d+<\/Count>/);
  });

  it("#26: schtasks /XML needs UTF-16 LE with a byte-order mark", () => {
    const bytes = encodeTaskXml(xml);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(bytes.subarray(2).toString("utf16le")).toBe(xml);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });
});
