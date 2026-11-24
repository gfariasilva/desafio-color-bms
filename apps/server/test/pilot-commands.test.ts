import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dayCashClosingResponseSchema } from "@color-bms/core";
import { buildApp } from "../src/app";
import { openDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import {
  goLive,
  install,
  installOrUpdate,
  start,
  stop,
  uninstall,
  update,
  type PilotContext,
  type WindowsOps,
} from "../src/pilot/commands";
import { compareVersions, installLayout, readMode, SUPPORT_FILES } from "../src/pilot/layout";

let tempDir: string;
let calls: string[];
let printed: string[];
let answers: string[];
let healthResult: { ok: true; version: string } | { ok: false; reason: string };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "color-bms-pilot-"));
  calls = [];
  printed = [];
  answers = [];
  healthResult = { ok: true, version: "0.2.0" };
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** A package as extracted from color-bms-<version>.zip on the USB stick. */
function makePackage(name: string, version: string): string {
  const dir = path.join(tempDir, name);
  fs.mkdirSync(path.join(dir, "app", "server", "dist", "pilot"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app", "node"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app", "server", "package.json"),
    JSON.stringify({ name: "@color-bms/server", version, type: "module" }),
  );
  fs.writeFileSync(path.join(dir, "app", "server", "dist", "main.js"), `// ${version}`);
  fs.writeFileSync(path.join(dir, "app", "node", "node.exe"), "node");
  for (const file of [...SUPPORT_FILES, "instalar.cmd", "atualizar.cmd"]) {
    fs.writeFileSync(path.join(dir, file), `${file} ${version}\r\n`);
  }
  return dir;
}

const fakeWindows: WindowsOps = {
  currentUser: () => "LOJA\\dono",
  registerTask: (xml) => void calls.push(`registerTask ${xml.includes("launcher.js")}`),
  runTask: () => void calls.push("runTask"),
  endTask: () => void calls.push("endTask"),
  stopProcesses: (nodeExe) => void calls.push(`stopProcesses ${nodeExe}`),
  createShortcut: (url) => {
    calls.push(`createShortcut ${url}`);
    return "C:\\Users\\dono\\Desktop\\Sistema Color.lnk";
  },
  openBrowser: (url) => void calls.push(`openBrowser ${url}`),
  deleteTask: () => void calls.push("deleteTask"),
  removeShortcuts: () => {
    calls.push("removeShortcuts");
    return ["C:\\Users\\dono\\Desktop\\Sistema Color.lnk"];
  },
};

const root = () => path.join(tempDir, "LocalAppData", "ColorBMS");

function context(packageDir: string, overrides: Partial<PilotContext> = {}): PilotContext {
  return {
    layout: installLayout(root(), "win32"),
    packageDir,
    windows: fakeWindows,
    waitForHealth: async ({ version }) => {
      calls.push(`waitForHealth ${version ?? "any"}`);
      return healthResult;
    },
    waitForStop: async () => {
      calls.push("waitForStop");
      return true;
    },
    prompt: async (question) => {
      calls.push(`prompt ${question}`);
      return answers.shift() ?? "";
    },
    print: (line) => void printed.push(line),
    now: () => new Date("2026-11-18T22:03:00.000Z"),
    silent: false,
    env: {},
    ...overrides,
  };
}

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");

describe("#26: instalar.cmd", () => {
  it("#26: copies the app, starts in trial mode, registers the logon task and the shortcut", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    const code = await install(context(usb));

    expect(code).toBe(0);
    const layout = installLayout(root(), "win32");
    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.2.0");
    expect(fs.existsSync(layout.trialDataDir)).toBe(true);
    expect(fs.existsSync(layout.realDataDir)).toBe(false);
    expect(readMode(layout)).toBe("treino");
    for (const file of SUPPORT_FILES) expect(fs.existsSync(path.join(root(), file))).toBe(true);
    // instalar/atualizar run only from the USB stick.
    expect(fs.existsSync(path.join(root(), "atualizar.cmd"))).toBe(false);
    expect(calls).toEqual([
      "registerTask true",
      "createShortcut http://127.0.0.1:3210/",
      "runTask",
      "waitForHealth 0.2.0",
      "openBrowser http://127.0.0.1:3210/",
    ]);
    expect(printed.join("\n")).toContain("Instalação concluída (versão 0.2.0, modo treino)");
  });

  it("#26: refuses to install over an existing installation (use atualizar.cmd)", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    await install(context(usb, { silent: true }));
    calls = [];
    printed = [];

    expect(await install(context(usb))).toBe(1);
    expect(calls).toEqual([]);
    expect(printed.join("\n")).toContain("atualizar.cmd");
  });

  it("#26: silent mode (CI) opens no browser", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    expect(await install(context(usb, { silent: true }))).toBe(0);
    expect(calls.some((call) => call.startsWith("openBrowser"))).toBe(false);
  });

  it("#26: a server that does not answer is reported with the log folder", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    healthResult = { ok: false, reason: "sem resposta em 90 s" };
    expect(await install(context(usb))).toBe(1);
    const text = printed.join("\n");
    expect(text).toContain("sem resposta em 90 s");
    expect(text).toContain(path.join(root(), "data-treino", "logs"));
  });
});

describe("#26: atualizar.cmd", () => {
  async function installOld() {
    const old = makePackage("color-bms-0.1.0", "0.1.0");
    healthResult = { ok: true, version: "0.1.0" };
    await install(context(old, { silent: true }));
    const layout = installLayout(root(), "win32");
    fs.writeFileSync(path.join(layout.trialDataDir, "color.db"), "trial data");
    calls = [];
    printed = [];
    healthResult = { ok: true, version: "0.2.0" };
    return layout;
  }

  it("#26: stops, replaces app\\ only, keeps the data and the previous app, starts the new version", async () => {
    const layout = await installOld();
    const usb = makePackage("color-bms-0.2.0", "0.2.0");

    expect(await update(context(usb))).toBe(0);

    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.2.0");
    expect(read(layout.previousAppDir, "server", "dist", "main.js")).toBe("// 0.1.0");
    expect(read(layout.trialDataDir, "color.db")).toBe("trial data");
    expect(read(root(), "parar.cmd")).toBe("parar.cmd 0.2.0\r\n");
    expect(calls).toEqual([
      "endTask",
      `stopProcesses ${layout.nodeExe}`,
      "waitForStop",
      "registerTask true",
      "runTask",
      "waitForHealth 0.2.0",
      "openBrowser http://127.0.0.1:3210/",
    ]);
    // #25: the server backs up the database before migrating, on this start.
    expect(printed.join("\n")).toContain("Atualizado: versão 0.1.0 → 0.2.0.");
  });

  it("#26: a copy that fails leaves the installed app untouched and running", async () => {
    const layout = await installOld();
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    // A source the copy cannot read: a broken package (e.g. the USB stick was pulled).
    fs.rmSync(path.join(usb, "app"), { recursive: true, force: true });

    expect(await update(context(usb))).toBe(1);

    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.1.0");
    expect(fs.existsSync(layout.newAppDir)).toBe(false);
    expect(calls).toEqual([]); // never stopped
    expect(printed.join("\n")).toContain("Nada foi alterado");
  });

  it("#26: a second update replaces the older app.anterior", async () => {
    const layout = await installOld();
    await update(context(makePackage("color-bms-0.2.0", "0.2.0"), { silent: true }));
    healthResult = { ok: true, version: "0.3.0" };
    await update(context(makePackage("color-bms-0.3.0", "0.3.0"), { silent: true }));
    expect(read(layout.previousAppDir, "server", "dist", "main.js")).toBe("// 0.2.0");
  });

  it("#26: refuses when the system is not installed", async () => {
    expect(await update(context(makePackage("color-bms-0.2.0", "0.2.0")))).toBe(1);
    expect(printed.join("\n")).toContain("instalar.cmd");
  });

  it("#26: refuses to run from the installed folder itself", async () => {
    await installOld();
    expect(await update(context(root()))).toBe(1);
    expect(calls).toEqual([]);
  });

  it("#26: a new version that does not start says how to go back", async () => {
    await installOld();
    healthResult = { ok: false, reason: "versão 0.1.0 respondeu, esperada 0.2.0" };
    expect(await update(context(makePackage("color-bms-0.2.0", "0.2.0")))).toBe(1);
    expect(printed.join("\n")).toContain("app.anterior");
  });
});

describe("#26: iniciar.cmd / parar.cmd", () => {
  it("#26: parar stops the task and every process of the installed node.exe", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    await install(context(usb, { silent: true }));
    calls = [];
    expect(await stop(context(root()))).toBe(0);
    expect(calls).toEqual([
      "endTask",
      `stopProcesses ${installLayout(root(), "win32").nodeExe}`,
      "waitForStop",
    ]);
  });

  it("#26: iniciar runs the task, waits for the server and opens the app", async () => {
    const usb = makePackage("color-bms-0.2.0", "0.2.0");
    await install(context(usb, { silent: true }));
    calls = [];
    expect(await start(context(root()))).toBe(0);
    expect(calls).toEqual(["runTask", "waitForHealth any", "openBrowser http://127.0.0.1:3210/"]);
  });
});

describe("#26: go-live reset (iniciar-uso-real.cmd)", () => {
  async function installed() {
    await install(context(makePackage("color-bms-0.2.0", "0.2.0"), { silent: true }));
    const layout = installLayout(root(), "win32");
    fs.writeFileSync(path.join(layout.trialDataDir, "color.db"), "trial data");
    calls = [];
    printed = [];
    return layout;
  }

  it("#26: archives the trial folder, configures OneDrive and switches to the real folder", async () => {
    const layout = await installed();
    const oneDrive = path.join(tempDir, "OneDrive - Pessoal", "Color");
    fs.mkdirSync(oneDrive, { recursive: true });
    answers = ["SIM", oneDrive];

    expect(await goLive(context(root()))).toBe(0);

    const archived = path.join(layout.archiveDir, "data-treino-2026-11-18_1903");
    expect(read(archived, "color.db")).toBe("trial data");
    expect(fs.existsSync(layout.trialDataDir)).toBe(false);
    expect(readMode(layout)).toBe("real");
    // JSON.stringify escapes Windows backslashes correctly (CLAUDE.md warns about this).
    expect(JSON.parse(read(layout.realDataDir, "config.json"))).toEqual({
      oneDriveFolder: oneDrive,
    });
    expect(calls.filter((call) => !call.startsWith("prompt"))).toEqual([
      "endTask",
      `stopProcesses ${layout.nodeExe}`,
      "waitForStop",
      "runTask",
      "waitForHealth any",
      "openBrowser http://127.0.0.1:3210/",
    ]);
  });

  it("#26: does nothing unless the owner types SIM", async () => {
    const layout = await installed();
    answers = ["sim?"];
    expect(await goLive(context(root()))).toBe(1);
    expect(readMode(layout)).toBe("treino");
    expect(fs.existsSync(layout.trialDataDir)).toBe(true);
    expect(calls.filter((call) => !call.startsWith("prompt"))).toEqual([]);
  });

  it("#26: never runs twice (real data is never archived)", async () => {
    const layout = await installed();
    answers = ["SIM", ""];
    await goLive(context(root()));
    calls = [];
    printed = [];
    answers = ["SIM", ""];
    expect(await goLive(context(root()))).toBe(1);
    expect(printed.join("\n")).toContain("já está em uso real");
    expect(readMode(layout)).toBe("real");
  });

  it("#26: refuses when the real folder already has a database", async () => {
    const layout = await installed();
    fs.mkdirSync(layout.realDataDir, { recursive: true });
    fs.writeFileSync(path.join(layout.realDataDir, "color.db"), "real data");
    answers = ["SIM"];
    expect(await goLive(context(root()))).toBe(1);
    expect(read(layout.realDataDir, "color.db")).toBe("real data");
  });

  it("#26: suggests %OneDrive%\\Color and asks again for a folder that does not exist", async () => {
    const layout = await installed();
    const oneDrive = path.join(tempDir, "OneDrive");
    fs.mkdirSync(path.join(oneDrive, "Color"), { recursive: true });
    answers = ["SIM", path.join(tempDir, "nope"), ""];

    expect(await goLive(context(root(), { env: { OneDrive: oneDrive } }))).toBe(0);

    const prompts = calls.filter((call) => call.startsWith("prompt"));
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain(`[${path.join(oneDrive, "Color")}]`);
    expect(printed.join("\n")).toContain("não existe");
    expect(JSON.parse(read(layout.realDataDir, "config.json"))).toEqual({
      oneDriveFolder: path.join(oneDrive, "Color"),
    });
  });

  it("#26: without a OneDrive folder it still goes live, and warns there is no backup", async () => {
    const layout = await installed();
    answers = ["SIM", ""];
    expect(await goLive(context(root()))).toBe(0);
    expect(fs.existsSync(path.join(layout.realDataDir, "config.json"))).toBe(false);
    expect(printed.join("\n")).toContain("sem backup");
  });

  it("#26 / FR-08: after the reset the database is empty and the first closing has no opening cash", async () => {
    const layout = await installed();
    answers = ["SIM", ""];
    await goLive(context(root()));

    // What the server does on its first start in the real folder: create and migrate (seeds).
    const connection = openDatabase(path.join(layout.realDataDir, "color.db"));
    try {
      runMigrations(connection.db);
      const app = await buildApp({
        connection,
        now: () => new Date("2026-12-01T13:00:00.000Z"),
      });
      const response = await app.inject({
        method: "GET",
        url: "/api/days/2026-12-01/cash-closing",
      });
      await app.close();
      expect(response.statusCode).toBe(200);
      const view = dayCashClosingResponseSchema.parse(response.json());
      expect(view.suggestedOpeningCashCents).toBeNull();
      const sales = connection.sqlite.prepare("select count(*) as n from sales").get();
      expect(sales).toEqual({ n: 0 });
      const tabs = connection.sqlite.prepare("select count(*) as n from sale_categories").get() as {
        n: number;
      };
      expect(tabs.n).toBeGreaterThan(0); // RN-12 seeds only
    } finally {
      connection.sqlite.close();
    }
  });
});

describe("#24: the Windows installer (Setup.exe runs cli.js instalador / desinstalar)", () => {
  /** What Inno Setup leaves after the uninstall: it deletes app\ and the support files. */
  function removeProgramLikeInno() {
    const layout = installLayout(root(), "win32");
    for (const dir of [layout.appDir, layout.previousAppDir, layout.newAppDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const file of SUPPORT_FILES) fs.rmSync(path.join(root(), file), { force: true });
  }

  it("FR-34 / #24: on a new PC it installs in trial mode, registers the logon task and the desktop shortcut", async () => {
    const setup = makePackage("pacote", "0.6.0");
    healthResult = { ok: true, version: "0.6.0" };

    expect(await installOrUpdate(context(setup))).toBe(0);

    const layout = installLayout(root(), "win32");
    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.6.0");
    expect(readMode(layout)).toBe("treino");
    expect(calls).toEqual([
      "registerTask true",
      "createShortcut http://127.0.0.1:3210/",
      "runTask",
      "waitForHealth 0.6.0",
      "openBrowser http://127.0.0.1:3210/",
    ]);
  });

  it("#24: over a pilot install it updates app\\ only, keeps the data and app.anterior, and waits for the new version", async () => {
    // The pilot (#26) installed 0.5.0 from the zip; trial data exists.
    healthResult = { ok: true, version: "0.5.0" };
    await install(context(makePackage("color-bms-0.5.0", "0.5.0"), { silent: true }));
    const layout = installLayout(root(), "win32");
    fs.writeFileSync(path.join(layout.trialDataDir, "color.db"), "trial data");
    calls = [];
    printed = [];
    healthResult = { ok: true, version: "0.6.0" };

    expect(await installOrUpdate(context(makePackage("pacote", "0.6.0")))).toBe(0);

    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.6.0");
    expect(read(layout.previousAppDir, "server", "dist", "main.js")).toBe("// 0.5.0");
    expect(read(layout.trialDataDir, "color.db")).toBe("trial data");
    expect(readMode(layout)).toBe("treino");
    // Same task name and shortcut as the pilot: re-registered, not duplicated.
    expect(calls).toEqual([
      "endTask",
      `stopProcesses ${layout.nodeExe}`,
      "waitForStop",
      "registerTask true",
      "runTask",
      "waitForHealth 0.6.0",
      "openBrowser http://127.0.0.1:3210/",
    ]);
    expect(printed.join("\n")).toContain("Atualizado: versão 0.5.0 → 0.6.0.");
  });

  it("#24: an older installer never replaces a newer installed version (the database may be migrated)", async () => {
    healthResult = { ok: true, version: "0.7.0" };
    await install(context(makePackage("color-bms-0.7.0", "0.7.0"), { silent: true }));
    const layout = installLayout(root(), "win32");
    calls = [];
    printed = [];

    expect(await installOrUpdate(context(makePackage("pacote", "0.6.0")))).toBe(1);

    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.7.0");
    expect(calls).toEqual([]); // never stopped
    expect(printed.join("\n")).toContain("mais nova que este instalador (0.6.0)");
  });

  it("#24: a deliberate downgrade (--permitir-versao-anterior) and a same-version reinstall are allowed", async () => {
    healthResult = { ok: true, version: "0.7.0" };
    await install(context(makePackage("color-bms-0.7.0", "0.7.0"), { silent: true }));
    const layout = installLayout(root(), "win32");

    expect(await installOrUpdate(context(makePackage("mesma", "0.7.0"), { silent: true }))).toBe(0);
    healthResult = { ok: true, version: "0.6.0" };
    expect(
      await installOrUpdate(context(makePackage("pacote", "0.6.0"), { silent: true }), {
        allowDowngrade: true,
      }),
    ).toBe(0);
    expect(read(layout.appDir, "server", "dist", "main.js")).toBe("// 0.6.0");
  });

  it("#24: versions compare as numbers (0.10.0 is newer than 0.9.0)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.6.0", "0.6.0")).toBe(0);
    expect(compareVersions("0.6.0", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("?", "0.6.0")).toBeNull();
  });

  it("#24: desinstalar stops the system, deletes the task and the shortcut, and keeps every data folder", async () => {
    await install(context(makePackage("pacote", "0.2.0"), { silent: true }));
    const layout = installLayout(root(), "win32");
    fs.writeFileSync(path.join(layout.trialDataDir, "color.db"), "trial data");
    fs.mkdirSync(layout.realDataDir, { recursive: true });
    fs.writeFileSync(path.join(layout.realDataDir, "color.db"), "real data");
    fs.mkdirSync(layout.archiveDir, { recursive: true });
    calls = [];
    printed = [];

    expect(await uninstall(context(root(), { silent: true }))).toBe(0);

    expect(calls).toEqual([
      "endTask",
      `stopProcesses ${layout.nodeExe}`,
      "waitForStop",
      "deleteTask",
      "removeShortcuts",
    ]);
    expect(read(layout.trialDataDir, "color.db")).toBe("trial data");
    expect(read(layout.realDataDir, "color.db")).toBe("real data");
    expect(fs.existsSync(layout.archiveDir)).toBe(true);
    expect(fs.existsSync(layout.settingsFile)).toBe(true);
    // app\ is Inno Setup's to delete, after this process (which runs from it) has exited.
    expect(fs.existsSync(layout.appDir)).toBe(true);
    expect(printed.join("\n")).toContain("Os dados foram mantidos");
  });

  it("#24: desinstalar still deletes the task and the shortcut when the system does not stop", async () => {
    await install(context(makePackage("pacote", "0.2.0"), { silent: true }));
    calls = [];
    printed = [];

    const code = await uninstall(
      context(root(), {
        waitForStop: async () => {
          calls.push("waitForStop");
          return false;
        },
      }),
    );

    expect(code).toBe(1);
    expect(calls.slice(-2)).toEqual(["deleteTask", "removeShortcuts"]);
  });

  it("#24: desinstalar still deletes the task when stopping fails with an error", async () => {
    await install(context(makePackage("pacote", "0.2.0"), { silent: true }));
    calls = [];
    printed = [];
    const failingStop: WindowsOps = {
      ...fakeWindows,
      stopProcesses: () => {
        throw new Error("powershell.exe falhou");
      },
    };

    expect(await uninstall(context(root(), { windows: failingStop }))).toBe(1);

    expect(calls).toEqual(["endTask", "deleteTask", "removeShortcuts"]);
    expect(printed.join("\n")).toContain("powershell.exe falhou");
  });

  it("#24: reinstalling after an uninstall keeps the real mode and the real data", async () => {
    await install(context(makePackage("pacote", "0.2.0"), { silent: true }));
    answers = ["SIM", ""];
    await goLive(context(root(), { silent: true }));
    const layout = installLayout(root(), "win32");
    fs.writeFileSync(path.join(layout.realDataDir, "color.db"), "real data");
    await uninstall(context(root(), { silent: true }));
    removeProgramLikeInno();
    calls = [];
    printed = [];
    healthResult = { ok: true, version: "0.6.0" };

    expect(await installOrUpdate(context(makePackage("pacote-novo", "0.6.0")))).toBe(0);

    expect(readMode(layout)).toBe("real");
    expect(read(layout.realDataDir, "color.db")).toBe("real data");
    expect(fs.existsSync(layout.trialDataDir)).toBe(false);
    expect(printed.join("\n")).toContain("modo real");
  });

  it("#24: without instalacao.json, an existing real data folder is never hidden behind trial mode", async () => {
    const layout = installLayout(root(), "win32");
    fs.mkdirSync(layout.realDataDir, { recursive: true });
    fs.writeFileSync(path.join(layout.realDataDir, "color.db"), "real data");

    expect(await installOrUpdate(context(makePackage("pacote", "0.2.0"), { silent: true }))).toBe(
      0,
    );

    expect(readMode(layout)).toBe("real");
    expect(JSON.parse(read(layout.settingsFile))).toEqual({ mode: "real" });
    expect(fs.existsSync(layout.trialDataDir)).toBe(false);
  });
});
