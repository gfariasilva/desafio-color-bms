import { describe, expect, it } from "vitest";
import { saoPauloOffsetMinutes } from "../time/civil-date";
import {
  clockCheck,
  folderCheck,
  formatUtcOffset,
  portCheck,
  startupCheckSchema,
  timeZoneCheck,
} from "./startup-checks";

const NOW = new Date("2026-11-18T22:03:00.000Z"); // 19:03 in São Paulo

describe("#26: PC time zone vs São Paulo (RN-15)", () => {
  it("São Paulo is UTC−03:00 (no daylight saving time since 2019)", () => {
    expect(saoPauloOffsetMinutes(NOW)).toBe(-180);
    expect(saoPauloOffsetMinutes(new Date("2026-01-15T12:00:00.000Z"))).toBe(-180);
  });

  it("formats offsets as UTC±hh:mm", () => {
    expect(formatUtcOffset(-180)).toBe("UTC−03:00");
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
    expect(formatUtcOffset(330)).toBe("UTC+05:30");
  });

  it("#26: ok when the PC is on São Paulo time", () => {
    const check = timeZoneCheck({
      now: NOW,
      systemTimeZone: "America/Sao_Paulo",
      systemOffsetMinutes: -180,
    });
    expect(check).toEqual({
      id: "timeZone",
      status: "ok",
      message: "Fuso horário do PC: UTC−03:00, o mesmo de São Paulo.",
    });
  });

  it("#26: ok for another zone with the same offset (e.g. America/Bahia)", () => {
    const check = timeZoneCheck({
      now: NOW,
      systemTimeZone: "America/Bahia",
      systemOffsetMinutes: -180,
    });
    expect(check.status).toBe("ok");
  });

  it("#26: warns when the PC is on another time zone (dates would shift near midnight)", () => {
    const check = timeZoneCheck({ now: NOW, systemTimeZone: "UTC", systemOffsetMinutes: 0 });
    expect(check.status).toBe("warning");
    expect(check.message).toBe(
      "O fuso horário do PC (UTC, UTC+00:00) não é o de São Paulo (UTC−03:00). " +
        "Ajuste em Configurações > Hora e idioma.",
    );
  });
});

describe("#26: PC clock plausibility", () => {
  it("#26: ok shows the PC's date and time in São Paulo", () => {
    expect(clockCheck({ now: NOW, latestRecordedAt: null, builtAt: null })).toEqual({
      id: "clock",
      status: "ok",
      message: "Relógio do PC: 18/11/2026 19:03.",
    });
  });

  it("#26: ok when the latest record is a few minutes ahead (tolerance 5 min)", () => {
    const check = clockCheck({
      now: NOW,
      latestRecordedAt: "2026-11-18T22:07:59.000Z",
      builtAt: "2026-11-18T10:00:00.000Z",
    });
    expect(check.status).toBe("ok");
  });

  it("#26: error when there are records later than now (the clock went back)", () => {
    const check = clockCheck({
      now: NOW,
      latestRecordedAt: "2026-11-19T12:00:00.000Z",
      builtAt: null,
    });
    expect(check.status).toBe("error");
    expect(check.message).toBe(
      "O relógio do PC está atrasado: há registros de 19/11/2026 09:00, depois de agora " +
        "(18/11/2026 19:03). Acerte a data e a hora do Windows.",
    );
  });

  it("#26: error when the clock is before this version was built (e.g. a dead CMOS battery)", () => {
    const check = clockCheck({
      now: new Date("2001-06-01T12:00:00.000Z"),
      latestRecordedAt: null,
      builtAt: "2026-11-18T10:00:00.000Z",
    });
    expect(check.status).toBe("error");
    expect(check.message).toBe(
      "O relógio do PC (01/06/2001 09:00) está antes da data desta versão (18/11/2026 07:00). " +
        "Acerte a data e a hora do Windows.",
    );
  });

  it("#26: a build less than a day 'in the future' is tolerated", () => {
    const check = clockCheck({
      now: NOW,
      latestRecordedAt: null,
      builtAt: "2026-11-19T12:00:00.000Z",
    });
    expect(check.status).toBe("ok");
  });
});

describe("#26: port and folders", () => {
  it("#26: the port check names the port and says it is local only (NFR-08)", () => {
    expect(portCheck(3210)).toEqual({
      id: "port",
      status: "ok",
      message: "Porta 3210: em uso por este sistema, acessível só neste PC.",
    });
  });

  it("#26: data folder writable / not writable", () => {
    expect(folderCheck("dataFolder", { state: "ok", path: "C:\\ColorBMS\\data" })).toEqual({
      id: "dataFolder",
      status: "ok",
      message: "Pasta de dados gravável: C:\\ColorBMS\\data",
    });
    expect(
      folderCheck("dataFolder", {
        state: "not-writable",
        path: "C:\\ColorBMS\\data",
        detail: "EACCES",
      }),
    ).toEqual({
      id: "dataFolder",
      status: "error",
      message: "Não é possível gravar na pasta de dados: C:\\ColorBMS\\data (EACCES)",
    });
  });

  it("#26: OneDrive folder states", () => {
    expect(folderCheck("oneDriveFolder", { state: "trial" })).toEqual({
      id: "oneDriveFolder",
      status: "ok",
      message: "Modo treino: sem backup no OneDrive.",
    });
    expect(folderCheck("oneDriveFolder", { state: "not-configured" })).toEqual({
      id: "oneDriveFolder",
      status: "warning",
      message: "Pasta do OneDrive não configurada.",
    });
    expect(
      folderCheck("oneDriveFolder", { state: "missing", path: "D:\\OneDrive\\Color" }),
    ).toEqual({
      id: "oneDriveFolder",
      status: "error",
      message: "A pasta do OneDrive não existe: D:\\OneDrive\\Color",
    });
    expect(
      folderCheck("oneDriveFolder", { state: "ok", path: "D:\\OneDrive\\Color" }).message,
    ).toBe("Pasta do OneDrive gravável: D:\\OneDrive\\Color");
    expect(
      folderCheck("oneDriveFolder", {
        state: "not-writable",
        path: "D:\\OneDrive\\Color",
        detail: "EPERM",
      }).message,
    ).toBe("Não é possível gravar na pasta do OneDrive: D:\\OneDrive\\Color (EPERM)");
  });

  it("every check matches the shared schema", () => {
    expect(() => startupCheckSchema.parse(portCheck(3210))).not.toThrow();
    expect(() => startupCheckSchema.parse({ id: "x", status: "ok", message: "" })).toThrow();
  });
});
