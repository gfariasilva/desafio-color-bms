import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  BACKUP_UPLOAD_MAX_BYTES,
  restoreRequestSchema,
  type BackupListResponse,
  type BackupStatusResponse,
  type BackupUploadResponse,
  type RestoreResponse,
  type RestoreResult,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import { parseOr400, sendError } from "../../http/route-helpers";
import { readBackupStatus } from "./backup.service";
import type { RestoreService } from "./restore.service";

export interface BackupRoutesOptions {
  /** The OneDrive folder the export queue writes to (null: not configured, or trial mode). */
  oneDriveFolder: () => string | null;
  /** FR-32: the restore service; without it only the status is served. */
  restore: RestoreService | null;
  /** FR-32: the result of the restore done at this start, if any. */
  lastRestore: RestoreResult | null;
  /** FR-32: called once a restore is staged: main.ts restarts the server. */
  onRestartRequested: () => void;
  now: Clock;
}

/** FR-32: how long the result of a restore is shown after the restart. */
const RESTORE_RESULT_MS = 60 * 60_000;

/**
 * FR-31 / FR-32:
 * - GET /api/backup/status: the newest backup and the last restore (Início, backup page);
 * - GET /api/backup/files: the backups that can be restored;
 * - PUT /api/backup/upload?name=…: a backup file chosen in the browser (new PC);
 * - POST /api/backup/restore: confirm + reason; answers 202 and the server restarts.
 */
export function registerBackupRoutes(
  app: FastifyInstance,
  { oneDriveFolder, restore, lastRestore, onRestartRequested, now }: BackupRoutesOptions,
): void {
  // FR-32: a new id at every start, so the UI knows when a restart is over.
  const startId = randomUUID();
  app.get("/api/backup/status", async (): Promise<BackupStatusResponse> =>
    readBackupStatus(
      oneDriveFolder(),
      // An old result would look like something just happened: shown for an hour only.
      lastRestore && now().getTime() - Date.parse(lastRestore.at) < RESTORE_RESULT_MS
        ? lastRestore
        : null,
      startId,
    ),
  );
  if (!restore) return;

  app.get("/api/backup/files", async (): Promise<BackupListResponse> => restore.list());

  // The raw file, as sent by the browser (no multipart library needed).
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: BACKUP_UPLOAD_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  app.put<{ Querystring: { name?: string } }>(
    "/api/backup/upload",
    { bodyLimit: BACKUP_UPLOAD_MAX_BYTES },
    async (request, reply): Promise<BackupUploadResponse | undefined> => {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return reply.code(400).send({ error: "Escolha o arquivo de backup." });
      }
      try {
        return restore.saveUpload(request.body, request.query.name ?? "backup.db");
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post("/api/backup/restore", async (request, reply) => {
    const input = parseOr400(restoreRequestSchema, request.body, reply);
    if (!input) return reply;
    try {
      const staged = restore.stage(input);
      request.log.info(`Restore of ${staged.name} staged; restarting.`);
    } catch (error) {
      return sendError(reply, error);
    }
    // After the answer is sent: the restart closes the server (main.ts). Also when the browser
    // went away before the answer ("close" without "finish"): the restore is staged anyway.
    let restarting = false;
    const restart = () => {
      if (restarting) return;
      restarting = true;
      onRestartRequested();
    };
    reply.raw.once("finish", restart);
    reply.raw.once("close", restart);
    const answer: RestoreResponse = { restarting: true, startId };
    return reply.code(202).send(answer);
  });
}
