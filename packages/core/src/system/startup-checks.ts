import { z } from "zod";
import { formatInstant } from "../format/date";
import { saoPauloOffsetMinutes } from "../time/civil-date";

/**
 * #26: checks shown on Início ("Status do sistema") and logged at startup, so problems on the
 * shop PC (wrong time zone, clock set back, folders that cannot be written) are visible.
 */
export const STARTUP_CHECK_IDS = [
  "timeZone",
  "clock",
  "port",
  "dataFolder",
  "oneDriveFolder",
] as const;
export const STARTUP_CHECK_STATUSES = ["ok", "warning", "error"] as const;

export const startupCheckSchema = z.object({
  id: z.enum(STARTUP_CHECK_IDS),
  status: z.enum(STARTUP_CHECK_STATUSES),
  /** pt-BR, shown as is. */
  message: z.string().min(1),
});
export type StartupCheck = z.infer<typeof startupCheckSchema>;

/** A records' instant may be this far ahead of "now" (two PCs' clocks, rounding). */
const RECORD_TOLERANCE_MS = 5 * 60_000;
/** The build machine's clock may be a bit ahead of the shop PC's. */
const BUILD_TOLERANCE_MS = 24 * 60 * 60_000;

/** Minutes east of UTC → "UTC−03:00" (with a real minus sign, as in pt-BR typography). */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const mins = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

/**
 * #26 / RN-15: business dates are São Paulo's. The server always computes them with the
 * America/Sao_Paulo rules, but a PC on another time zone shows other times in Windows and in
 * the files it writes, so it is worth a warning. Same offset (e.g. America/Bahia) is fine.
 */
export function timeZoneCheck({
  now,
  systemTimeZone,
  systemOffsetMinutes,
}: {
  now: Date;
  /** IANA name the PC reports, e.g. "America/Sao_Paulo". */
  systemTimeZone: string;
  /** The PC's offset at `now`, minutes east of UTC (−180 for UTC−03:00). */
  systemOffsetMinutes: number;
}): StartupCheck {
  const expected = saoPauloOffsetMinutes(now);
  if (systemOffsetMinutes === expected) {
    return {
      id: "timeZone",
      status: "ok",
      message: `Fuso horário do PC: ${formatUtcOffset(expected)}, o mesmo de São Paulo.`,
    };
  }
  return {
    id: "timeZone",
    status: "warning",
    message:
      `O fuso horário do PC (${systemTimeZone}, ${formatUtcOffset(systemOffsetMinutes)}) ` +
      `não é o de São Paulo (${formatUtcOffset(expected)}). ` +
      "Ajuste em Configurações > Hora e idioma.",
  };
}

/**
 * #26: the PC clock decides "today" (RN-15) and the "no future dates" rule. Offline, we cannot
 * know the true time, but two signs show a wrong clock: records saved later than now (the clock
 * went back), or a clock earlier than the day this version was built (e.g. a dead CMOS battery).
 */
export function clockCheck({
  now,
  latestRecordedAt,
  builtAt,
}: {
  now: Date;
  /** The newest audit instant (ISO UTC), or null on an empty database. */
  latestRecordedAt: string | null;
  /** When this version was built (ISO UTC), or null when unknown (development). */
  builtAt: string | null;
}): StartupCheck {
  const nowMs = now.getTime();
  const fix = "Acerte a data e a hora do Windows.";
  if (latestRecordedAt !== null && Date.parse(latestRecordedAt) > nowMs + RECORD_TOLERANCE_MS) {
    return {
      id: "clock",
      status: "error",
      message:
        `O relógio do PC está atrasado: há registros de ${formatInstant(latestRecordedAt)}, ` +
        `depois de agora (${formatInstant(now)}). ${fix}`,
    };
  }
  if (builtAt !== null && Date.parse(builtAt) > nowMs + BUILD_TOLERANCE_MS) {
    return {
      id: "clock",
      status: "error",
      message:
        `O relógio do PC (${formatInstant(now)}) está antes da data desta versão ` +
        `(${formatInstant(builtAt)}). ${fix}`,
    };
  }
  return { id: "clock", status: "ok", message: `Relógio do PC: ${formatInstant(now)}.` };
}

/** #26 / NFR-08: the server listens on 127.0.0.1 only. */
export function portCheck(port: number): StartupCheck {
  return {
    id: "port",
    status: "ok",
    message: `Porta ${port}: em uso por este sistema, acessível só neste PC.`,
  };
}

/** What the server found when it tried to write a probe file in a folder. */
export type FolderProbe =
  | { state: "ok"; path: string }
  | { state: "not-writable"; path: string; detail: string }
  | { state: "missing"; path: string }
  /** OneDrive only: no folder set in Configurações (FR-33). */
  | { state: "not-configured" }
  /** OneDrive only: trial mode never backs up to OneDrive. */
  | { state: "trial" };

/** #26: data folder and OneDrive folder writable (pt-BR message per state). */
export function folderCheck(id: "dataFolder" | "oneDriveFolder", probe: FolderProbe): StartupCheck {
  const label = id === "dataFolder" ? "pasta de dados" : "pasta do OneDrive";
  const Label = id === "dataFolder" ? "Pasta de dados" : "Pasta do OneDrive";
  switch (probe.state) {
    case "ok":
      return { id, status: "ok", message: `${Label} gravável: ${probe.path}` };
    case "not-writable":
      return {
        id,
        status: "error",
        message: `Não é possível gravar na ${label}: ${probe.path} (${probe.detail})`,
      };
    case "missing":
      return { id, status: "error", message: `A ${label} não existe: ${probe.path}` };
    case "not-configured":
      return { id, status: "warning", message: `${Label} não configurada.` };
    case "trial":
      return { id, status: "ok", message: "Modo treino: sem backup no OneDrive." };
  }
}
