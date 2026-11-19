import type { FastifyInstance } from "fastify";
import {
  folderTestRequestSchema,
  sameFolderPath,
  settingsInputSchema,
  type FolderTestResponse,
  type SettingsResponse,
} from "@color-bms/core";
import type { Clock } from "../../clock";
import { parseOr400 } from "../../http/route-helpers";
import { testFolderWrite } from "./folder-test";
import type { SettingsStore } from "./settings.repository";

/** Code of a save refused because the new OneDrive folder failed the write test. */
export const FOLDER_TEST_FAILED_CODE = "folder_test_failed";

/** FR-33: Configurações (OneDrive folder with "Testar", alert thresholds). */
export function registerSettingsRoutes(
  app: FastifyInstance,
  store: SettingsStore,
  clock: Clock,
  /** The OneDrive folder changed: back up and retry the exports there (FR-31, FR-30). */
  onFolderChanged: () => Promise<void>,
): void {
  app.get("/api/settings", async (): Promise<SettingsResponse> => store.read());

  app.put("/api/settings", async (request, reply) => {
    const input = parseOr400(settingsInputSchema, request.body, reply);
    if (!input) return reply;

    const current = store.read();
    const folderChanges =
      current.oneDriveFolderSource === "settings" &&
      !sameFolderPath(input.oneDriveFolder, current.oneDriveFolder);
    // A new folder must pass "Testar" before it is saved: a wrong path would silently stop the
    // backups (spec §7.4). Clearing the folder is always allowed.
    if (folderChanges && input.oneDriveFolder !== null) {
      const test = testFolderWrite(input.oneDriveFolder);
      if (!test.ok) {
        return reply.code(422).send({ error: test.message, code: FOLDER_TEST_FAILED_CODE });
      }
    }

    const changed = store.save(input, clock());
    // FR-31 / FR-30: the new folder applies at once: today's backup if it has none yet, and
    // the pending exports. Never throws.
    if (changed.includes("oneDriveFolder")) void onFolderChanged();
    return store.read();
  });

  app.post("/api/settings/onedrive-folder/test", async (request, reply) => {
    const input = parseOr400(folderTestRequestSchema, request.body, reply);
    if (!input) return reply;
    return testFolderWrite(input.folder) satisfies FolderTestResponse;
  });
}
