import { defineConfig } from "drizzle-kit";

// `npm run db:generate -w @color-bms/server` compares src/db/schema.ts with the
// migrations already in ./migrations and writes a NEW .sql file for the difference.
// Never edit a migration that has already been applied: generate a new one.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
